// Routes d'administration : documents du RAG, réindexation, réglages, statistiques.
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadIndex, indexStatus } from "../lib/retriever.js";
import { getSettings, updateSettings, DEFAULTS, publicSettings } from "../lib/settings.js";
import { complete, listModels } from "../lib/llm.js";
import { issueToken, checkToken } from "../lib/tokens.js";
import crypto from "node:crypto";
const safeEqual = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
import { stats } from "../lib/stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = process.env.DOCS_DIR || path.join(ROOT, "docs");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const ALLOWED_EXT = new Set([".md", ".txt", ".pdf"]);
const MAX_UPLOAD = 40 * 1024 * 1024;

const router = express.Router();

/* ---------- authentification admin ---------- */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
/**
 * Repli « accès local » quand ADMIN_PASSWORD n'est pas défini : uniquement une connexion directe
 * depuis la boucle locale, sans aucun en-tête de proxy et sans trust proxy (sinon : fermé).
 */
function isLocal(req) {
  const ip = req.socket?.remoteAddress || ""; // adresse réelle du socket, jamais X-Forwarded-For
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return false;
  if (req.app.get("trust proxy")) return false; // derrière un proxy, tout vient de la boucle locale : pas de repli
  if (req.get("x-forwarded-for") || req.get("forwarded") || req.get("via") || req.get("x-real-ip")) return false;
  // Anti DNS rebinding : l'hôte demandé doit être la boucle locale
  const host = (req.get("host") || "").toLowerCase().replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return false;
  // Anti CSRF : pas de requête inter-site, et un en-tête personnalisé sur toute écriture
  const origin = req.get("origin");
  if (origin) { try { const o = new URL(origin); if (!["localhost", "127.0.0.1", "[::1]"].includes(o.hostname.toLowerCase())) return false; } catch { return false; } }
  const sfs = req.get("sec-fetch-site");
  if (sfs && !["same-origin", "same-site", "none"].includes(sfs)) return false;
  if (!["GET", "HEAD"].includes(req.method) && req.get("x-requested-with") !== "ZakatBot") return false;
  return true;
}
/** Authentification admin : en-tête X-Admin-Password, ou jeton temporaire (?t=) pour les liens et le flux SSE. */
const URL_TOKEN_ROUTES = [/^\/docs\/file\//, /^\/reindex\/stream$/];
export function adminAuth(req, res, next) {
  if (req.method === "GET" && req.query.t && URL_TOKEN_ROUTES.some((r) => r.test(req.path)) && checkToken(req.query.t, "admin-read")) return next();
  if (ADMIN_PASSWORD) {
    if (safeEqual(req.get("x-admin-password") || "", ADMIN_PASSWORD)) return next();
    return res.status(401).json({ error: "Mot de passe admin requis." });
  }
  if (isLocal(req)) return next();
  return res.status(403).json({ error: "Admin fermé : définis ADMIN_PASSWORD dans .env (obligatoire derrière un proxy ou à distance)." });
}
router.use(adminAuth);

/** Jeton temporaire (15 min) pour les liens de fichiers et le flux de réindexation. */
const tokenLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Trop de jetons demandés." } });
router.post("/token", tokenLimiter, (req, res) => res.json(issueToken("admin-read")));

/* ---------- documents ---------- */
function safeName(name) {
  const base = path.basename(String(name || "")).replace(/[^\w.\- àâäéèêëîïôöùûüç]/gi, "_").replace(/\s+/g, "-");
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext) || base.length < 3) throw new Error("Nom ou extension non autorisés (md, txt, pdf).");
  return base;
}
function resolveDoc(rel) {
  const p = path.resolve(DOCS_DIR, rel);
  if (!p.startsWith(path.resolve(DOCS_DIR) + path.sep) && p !== path.resolve(DOCS_DIR)) throw new Error("Chemin invalide");
  return p;
}

router.get("/docs", (req, res) => {
  const st = indexStatus();
  const idx = st.ready ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf8")).docs || [] : [];
  const indexed = new Map(idx.map((d) => [d.source, d]));
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (ALLOWED_EXT.has(path.extname(e.name).toLowerCase())) {
        const rel = path.relative(DOCS_DIR, p).replace(/\\/g, "/");
        const s = fs.statSync(p);
        const ix = indexed.get(rel);
        out.push({ source: rel, size: s.size, mtime: s.mtime, type: path.extname(e.name).slice(1), indexed: Boolean(ix), chunks: ix?.chunks || 0, pages: ix?.pages || null, title: ix?.title || null });
      }
    }
  };
  if (fs.existsSync(DOCS_DIR)) walk(DOCS_DIR);
  const stale = out.some((d) => !d.indexed || (st.builtAt && new Date(d.mtime) > new Date(st.builtAt)));
  res.json({ docs: out.sort((a, b) => a.source.localeCompare(b.source)), index: st, stale });
});

/** Upload JSON { name, folder?, contentBase64 } ou { name, text } */
router.post("/docs", express.json({ limit: "60mb" }), (req, res) => {
  try {
    const { name, folder = "", contentBase64, text } = req.body ?? {};
    const file = safeName(name);
    const sub = String(folder || "").replace(/[^\w\-]/g, "");
    const dir = sub ? resolveDoc(sub) : DOCS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    let buf;
    if (typeof text === "string") buf = Buffer.from(text, "utf8");
    else if (typeof contentBase64 === "string") buf = Buffer.from(contentBase64, "base64");
    else return res.status(400).json({ error: "contenu manquant" });
    if (buf.length > MAX_UPLOAD) return res.status(413).json({ error: "Fichier trop volumineux (max 40 Mo)." });
    if (path.extname(file) === ".pdf" && buf.subarray(0, 5).toString() !== "%PDF-") return res.status(400).json({ error: "Ce fichier n'est pas un PDF valide." });
    const dest = path.join(dir, file);
    fs.writeFileSync(dest, buf);
    res.json({ ok: true, source: path.relative(DOCS_DIR, dest).replace(/\\/g, "/"), size: buf.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Servir un fichier de docs/ (lecture seule) : PDF affiché, md/txt en texte brut. ?download=1 force le téléchargement. */
router.get("/docs/file/*", (req, res) => {
  try {
    const p = resolveDoc(req.params[0]);
    if (!fs.existsSync(p) || !ALLOWED_EXT.has(path.extname(p).toLowerCase())) return res.status(404).json({ error: "introuvable" });
    const ext = path.extname(p).toLowerCase();
    const type = ext === ".pdf" ? "application/pdf" : ext === ".md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8";
    res.setHeader("Content-Type", req.query.raw !== undefined || ext === ".pdf" ? type : "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `${req.query.download !== undefined ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    fs.createReadStream(p).pipe(res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/docs/*", (req, res) => {
  try {
    const p = resolveDoc(req.params[0]);
    if (!fs.existsSync(p)) return res.status(404).json({ error: "introuvable" });
    fs.unlinkSync(p);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------- réindexation (processus enfant, journal en SSE) ---------- */
let job = null; // { proc, log: [], startedAt, mode, done, code }

router.get("/reindex/status", (req, res) => {
  res.json(job ? { running: !job.done, mode: job.mode, startedAt: job.startedAt, code: job.code, lines: job.log.slice(-200) } : { running: false });
});

router.post("/reindex", (req, res) => {
  if (job && !job.done) return res.status(409).json({ error: "Une réindexation est déjà en cours." });
  if (!["full", "no-graph", "graph-only"].includes(req.body?.mode)) return res.status(400).json({ error: "mode requis : full | no-graph | graph-only" });
  const mode = req.body.mode;
  const args = [path.join(ROOT, "scripts", "build-index.js")];
  if (mode === "no-graph") args.push("--no-graph");
  if (mode === "graph-only") args.push("--graph-only");
  const s = getSettings();
  const proc = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, GRAPH_MAX_CHUNKS: String(s.graphMaxChunks), GRAPH_EFFORT: process.env.GRAPH_EFFORT || "low" } });
  job = { proc, log: [], startedAt: new Date().toISOString(), mode, done: false, code: null, listeners: new Set() };
  const push = (line) => { job.log.push(line); if (job.log.length > 2000) job.log.shift(); for (const l of job.listeners) l(line); };
  const onData = (chunk) => chunk.toString().split(/\r?\n|\r/).filter((l) => l.trim()).forEach(push);
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  proc.on("close", (code) => {
    job.done = true; job.code = code;
    if (code === 0) { try { loadIndex(); push("Index rechargé dans le serveur."); } catch (e) { push("Rechargement impossible : " + e.message); } }
    push(`__END__ ${code}`);
    for (const l of job.listeners) l(null);
  });
  res.json({ ok: true, mode, startedAt: job.startedAt });
});

router.get("/reindex/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const send = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  if (!job) { send("__END__ none"); return res.end(); }
  for (const l of job.log) send(l);
  if (job.done) return res.end();
  const listener = (line) => { if (line === null) res.end(); else send(line); };
  job.listeners.add(listener);
  req.on("close", () => job?.listeners.delete(listener));
});

router.post("/reindex/cancel", (req, res) => {
  if (job && !job.done) { job.proc.kill(); return res.json({ ok: true }); }
  res.json({ ok: false });
});

router.post("/reload-index", (req, res) => { loadIndex(); res.json(indexStatus()); });

/* ---------- réglages ---------- */
router.get("/settings", (req, res) => res.json({ settings: publicSettings(), defaults: publicSettings(DEFAULTS), adminProtected: Boolean(ADMIN_PASSWORD) }));
router.put("/settings", express.json(), (req, res) => {
  try { res.json({ ok: true, settings: publicSettings(updateSettings(req.body ?? {})) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

/* ---------- LLM : test et liste des modèles (avec les valeurs du formulaire, sans les enregistrer) ---------- */
function overrideFrom(body) {
  const s = getSettings();
  const baseUrl = String(body?.llmBaseUrl || s.llmBaseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/.test(baseUrl)) throw Object.assign(new Error("URL de base invalide"), { status: 400 });
  const given = typeof body?.llmApiKey === "string" && body.llmApiKey && !body.llmApiKey.startsWith("••••") ? body.llmApiKey : "";
  // La clé enregistrée n'est jamais envoyée vers une autre URL que celle enregistrée (pas d'exfiltration via un test).
  const key = given || (baseUrl === s.llmBaseUrl ? s.llmApiKey : "");
  return { baseUrl, model: body?.llmModel || s.llmModel, apiKey: key, reasoning: body?.llmReasoning === undefined ? s.llmReasoning : [true, "true", "on"].includes(body.llmReasoning) };
}
const shortError = (err) => (err.status === 400 ? err.message : err.status ? `Fournisseur : HTTP ${err.status}` : err.message).slice(0, 200);
router.post("/llm/test", express.json(), async (req, res) => {
  const t0 = Date.now();
  try {
    const override = overrideFrom(req.body);
    const r = await complete([{ role: "user", content: "Réponds uniquement : OK" }], { effort: "low", maxTokens: 64, override });
    res.json({ ok: true, ms: Date.now() - t0, model: r.model, text: (r.text || "").slice(0, 120), usage: r.usage || null });
  } catch (err) {
    res.status(err.status === 400 ? 400 : 502).json({ ok: false, ms: Date.now() - t0, error: shortError(err) });
  }
});
router.post("/llm/models", express.json(), async (req, res) => {
  try { res.json({ models: (await listModels(overrideFrom(req.body))).slice(0, 300).map(String) }); }
  catch (err) { res.status(err.status === 400 ? 400 : 502).json({ error: shortError(err) }); }
});

/* ---------- statistiques ---------- */
router.get("/stats", (req, res) => res.json({ ...stats.snapshot(), index: indexStatus(), uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576) }));

export default router;
