import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { stream, currentModel } from "./lib/llm.js";
import { loadIndex, indexStatus, buildRagContext, buildGraphRagContext, graphForViz } from "./lib/retriever.js";
import { judge } from "./lib/judge.js";
import { loadSettings, getSettings } from "./lib/settings.js";
import { stats } from "./lib/stats.js";
import adminRouter from "./routes/admin.js";
import { issueToken, checkToken } from "./lib/tokens.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { PORT = "3000" } = process.env;

loadIndex();
loadSettings();
{
  const s0 = getSettings();
  if (!s0.llmBaseUrl || !s0.llmModel) console.warn("LLM non configuré : choisis le fournisseur, le modèle et la clé dans l'admin (Réglages → Modèle de langage) ou via LLM_BASE_URL / LLM_MODEL / LLM_API_KEY dans .env.");
  else if (!s0.llmApiKey && !/localhost|127\.0\.0\.1/.test(s0.llmBaseUrl)) console.warn("Aucune clé API LLM : renseigne-la dans l'admin ou LLM_API_KEY dans .env.");
}
const S = () => getSettings(); // réglages à chaud (admin)

const MODES = {
  llm: {
    label: "LLM seul",
    system: () => S().systemPrompt,
    context: async () => ({ chunks: [], context: "", graph: null }),
  },
  rag: {
    label: "RAG",
    system: (ctx) =>
      `${S().systemPrompt}\n\nTu disposes de PASSAGES extraits d'une base documentaire. Appuie ta réponse en priorité sur ces passages et cite-les avec leur numéro entre crochets, par exemple [2]. Si les passages ne couvrent pas la question, dis-le clairement avant de répondre avec tes connaissances générales.\n\nPASSAGES\n${ctx.context || "(aucun passage trouvé)"}`,
    context: (q) => buildRagContext(q, S().topK),
  },
  graph: {
    label: "RAG + Graph RAG",
    system: (ctx) =>
      `${S().systemPrompt}\n\nTu disposes d'un GRAPHE DE CONNAISSANCES (entités et relations) et de PASSAGES extraits d'une base documentaire. Utilise le graphe pour relier les entités entre elles et raisonner sur plusieurs documents, et les passages pour les détails. Cite les passages avec leur numéro entre crochets, par exemple [2]. Si les sources ne couvrent pas la question, dis-le clairement.\n\n${ctx.context || "(aucune source trouvée)"}`,
    context: (q) => buildGraphRagContext(q, S().topK),
  },
};

const app = express();
// Derrière un reverse proxy (Caddy/Nginx) : TRUST_PROXY=1 dans .env ; sinon req.ip = adresse du socket.
app.set("trust proxy", process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false);
app.disable("x-powered-by");
// En-têtes de sécurité (sans dépendance) : CSP stricte (scripts locaux uniquement), pas d'iframe, pas de sniffing, referrer minimal
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (req.secure || req.get("x-forwarded-proto") === "https") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(express.json({ limit: "512kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html", etag: true, maxAge: "1h" }));

/** Comparaison à temps constant de deux chaînes. */
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function checkPassword(req, res, next) {
  const pwd = S().accessPassword;
  if (!pwd) return next();
  if (safeEqual(req.get("x-access-password") || "", pwd)) return next();
  res.status(401).json({ error: "Mot de passe requis ou incorrect." });
}

// Limiteur placé AVANT les contrôles de mot de passe (freine la force brute) : 60 échecs / 10 min / IP
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Trop de tentatives, réessaie dans quelques minutes." }, skipSuccessfulRequests: true });
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes, réessaie dans quelques minutes." },
});

app.get("/api/config", (req, res) => {
  res.json({
    model: currentModel(),
    llmConfigured: Boolean(S().llmBaseUrl && S().llmModel),
    effort: S().reasoningEffort,
    needsPassword: Boolean(S().accessPassword),
    defaultModes: S().defaultModes,
    judgeEnabled: S().judgeEnabled,
    modes: Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, m.label])),
    index: indexStatus(),
  });
});

/** Fichiers de la base documentaire (lecture seule), pour les liens de sources dans les réponses. */
const DOCS_DIR = process.env.DOCS_DIR || path.join(__dirname, "docs");
/** Jeton temporaire pour les liens de fichiers (évite le mot de passe d'accès dans les URL). */
app.post("/api/doc-token", limiter, authLimiter, checkPassword, (req, res) => res.json(issueToken("docs")));
function docsAuth(req, res, next) {
  if (req.query.t && checkToken(req.query.t, "docs")) return next();
  return checkPassword(req, res, next);
}
app.get("/api/docs/file/*", limiter, authLimiter, docsAuth, (req, res) => {
  const rel = req.params[0] || "";
  const p = path.resolve(DOCS_DIR, rel);
  const ext = path.extname(p).toLowerCase();
  if (!p.startsWith(path.resolve(DOCS_DIR) + path.sep) || ![".md", ".txt", ".pdf"].includes(ext) || !fs.existsSync(p)) return res.status(404).json({ error: "introuvable" });
  res.setHeader("Content-Type", ext === ".pdf" ? "application/pdf" : "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  fs.createReadStream(p).pipe(res);
});

app.get("/api/graph", authLimiter, checkPassword, (req, res) => {
  res.json(graphForViz({ maxEntities: Math.min(Number(req.query.max) || 120, 400) }));
});

/** Message d'erreur montrable au public : jamais le corps de la réponse du fournisseur. */
function publicError(err) {
  if (err.status === 401) return "Clé API refusée par le fournisseur LLM.";
  if (err.status === 429) return "Quota du fournisseur LLM dépassé, réessaie plus tard.";
  if (err.status === 503) return "LLM non configuré : voir l'administration.";
  if (err.status) return `Erreur du fournisseur LLM (HTTP ${err.status}).`;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(err.message || "")) return "Fournisseur LLM injoignable.";
  return "Erreur interne pendant la génération.";
}

const MAX_QUESTION = 2000;   // caractères par question
const MAX_ANSWER = 20000;    // caractères par réponse soumise au juge

function sanitizeHistory(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20000), reasoning: typeof m.reasoning === "string" ? m.reasoning.slice(0, 60000) : "" }))
    .slice(-S().historyLimit);
}

/**
 * Beam exige le `reasoning_content` de chaque message assistant antérieur.
 * Si on l'a, on le renvoie ; sinon les échanges précédents sont résumés dans le prompt système
 * et seule la dernière question est envoyée comme message utilisateur.
 */
function buildMessages(systemPrompt, history) {
  if (!S().llmReasoning) {
    return [{ role: "system", content: systemPrompt }, ...history.map((m) => ({ role: m.role, content: m.content }))];
  }
  const allHaveReasoning = history.every((m) => m.role !== "assistant" || m.reasoning);
  if (allHaveReasoning) {
    return [
      { role: "system", content: systemPrompt },
      ...history.map((m) => (m.role === "assistant" ? { role: "assistant", content: m.content, reasoning_content: m.reasoning } : { role: "user", content: m.content })),
    ];
  }
  const prior = history.slice(0, -1);
  const transcript = prior.map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.content}`).join("\n\n");
  return [
    { role: "system", content: `${systemPrompt}\n\nHISTORIQUE DE LA CONVERSATION (pour contexte)\n${transcript}` },
    { role: "user", content: history[history.length - 1].content },
  ];
}

/** POST /api/chat/:mode  { messages:[...] }  → flux SSE */
app.post("/api/chat/:mode", authLimiter, checkPassword, limiter, async (req, res) => {
  const mode = MODES[req.params.mode];
  if (!mode) return res.status(404).json({ error: "mode inconnu" });

  const history = sanitizeHistory(req.body?.messages);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return res.status(400).json({ error: "Le dernier message doit venir de l'utilisateur." });
  }
  if (history[history.length - 1].content.length > MAX_QUESTION) return res.status(413).json({ error: `Question trop longue (max ${MAX_QUESTION} caractères).` });
  const question = history[history.length - 1].content;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const abort = new AbortController();
  req.on("close", () => abort.abort());
  const t0 = Date.now();

  try {
    const ctx = await mode.context(question);
    send({
      type: "context",
      ms: Date.now() - t0,
      sources: ctx.chunks.map((c, i) => ({ n: i + 1, id: c.id, source: c.source, title: c.title, preview: c.content.slice(0, 220) })),
      graph: ctx.graph,
    });

    const messages = buildMessages(mode.system(ctx), history);
    let firstToken = null, usageSeen = null;
    await stream(messages, {
      effort: S().reasoningEffort,
      maxTokens: S().maxTokens,
      signal: abort.signal,
      onDelta: (text) => {
        if (firstToken === null) { firstToken = Date.now() - t0; send({ type: "first", ms: firstToken }); }
        send({ type: "text", text });
      },
      onReasoning: (text) => send({ type: "reasoning", text }),
      onUsage: (usage) => { usageSeen = usage; send({ type: "usage", usage }); },
    });
    stats.record(req.params.mode, { usage: usageSeen, ms: Date.now() - t0, question });
    send({ type: "done", ms: Date.now() - t0 });
  } catch (err) {
    stats.record(req.params.mode, { error: true, ms: Date.now() - t0 });
    if (!abort.signal.aborted) {
      console.error(`[${req.params.mode}]`, err.message);
      send({ type: "error", error: publicError(err) });
    }
  } finally {
    res.end();
  }
});

/** POST /api/judge { question, answers:{llm,rag,graph} } → JSON */
app.post("/api/judge", authLimiter, checkPassword, limiter, async (req, res) => {
  if (!S().judgeEnabled) return res.status(403).json({ error: "Le juge LLM est désactivé dans l'administration." });
  const { question, answers: rawAnswers } = req.body ?? {};
  if (typeof question !== "string" || !rawAnswers || typeof rawAnswers !== "object") return res.status(400).json({ error: "question et answers requis" });
  if (question.length > MAX_QUESTION) return res.status(413).json({ error: `Question trop longue (max ${MAX_QUESTION} caractères).` });
  const answers = {};
  for (const m of ["llm", "rag", "graph"]) if (typeof rawAnswers[m] === "string") answers[m] = rawAnswers[m].slice(0, MAX_ANSWER);
  try {
    const t0 = Date.now();
    const ctx = await buildGraphRagContext(question, S().topK);
    const result = await judge({ question, answers, context: ctx.context, effort: S().judgeEffort });
    stats.record("judge", { usage: result.usage, ms: Date.now() - t0 });
    res.json(result);
  } catch (err) {
    stats.record("judge", { error: true });
    console.error("[judge]", err.message);
    res.status(502).json({ error: publicError(err) });
  }
});

/* ---------- administration ---------- */
app.use("/api/admin", authLimiter, adminRouter);
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/health", (req, res) => res.json({ ok: true, model: currentModel(), index: indexStatus() }));

app.listen(Number(PORT), () => {
  const st = indexStatus();
  console.log(`ZakatBot prêt sur http://localhost:${PORT} — modèle ${currentModel() || "(non configuré)"}, effort ${S().reasoningEffort} — admin : http://localhost:${PORT}/admin`);
  console.log(st.ready ? `Index : ${st.chunks} chunks, ${st.sources} docs, vecteurs=${st.vectors}, graphe=${st.graph ? `${st.graph.nodes} nœuds / ${st.graph.edges} arêtes` : "non"}` : "Index absent : lance `npm run index` après avoir mis des documents dans docs/.");
});
