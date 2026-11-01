// Réglages modifiables à chaud depuis l'admin, persistés dans data/settings.json.
// Ils priment sur les variables d'environnement.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const FILE = path.join(DATA_DIR, "settings.json");

const DEFAULTS = {
  reasoningEffort: process.env.REASONING_EFFORT || "low",
  judgeEffort: process.env.JUDGE_EFFORT || "medium",
  topK: Number(process.env.TOP_K || 5),
  maxTokens: Number(process.env.MAX_TOKENS || 2048),
  historyLimit: Number(process.env.HISTORY_LIMIT || 10),
  systemPrompt: process.env.SYSTEM_PROMPT || "Tu es un assistant utile et précis. Tu réponds dans la langue de l'utilisateur.",
  accessPassword: process.env.ACCESS_PASSWORD || "",
  graphMaxChunks: Number(process.env.GRAPH_MAX_CHUNKS || 150),
  judgeEnabled: (process.env.JUDGE_ENABLED || "on").toLowerCase() !== "off",
  // Aucun fournisseur préconfiguré : à renseigner dans .env (LLM_*) ou dans l'admin (Réglages → Modèle de langage)
  llmBaseUrl: (process.env.LLM_BASE_URL || process.env.REFLECTION_BASE_URL || "").replace(/\/+$/, ""),
  llmModel: process.env.LLM_MODEL || process.env.REFLECTION_MODEL || "",
  llmApiKey: process.env.LLM_API_KEY || process.env.REFLECTION_API_KEY || "",
  llmReasoning: (process.env.LLM_REASONING || "off").toLowerCase() === "on",
  defaultModes: (process.env.DEFAULT_MODES || "llm,rag,graph").split(",").map((m) => m.trim()).filter((m) => ["llm", "rag", "graph"].includes(m)),
};

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

let current = { ...DEFAULTS };

export function loadSettings() {
  try {
    if (fs.existsSync(FILE)) current = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch (err) {
    console.warn("settings.json illisible :", err.message);
  }
  return current;
}

export function getSettings() { return current; }

/** Valide et enregistre un sous-ensemble de réglages. Retourne les réglages à jour. */
export function updateSettings(patch) {
  const next = { ...current };
  if (patch.reasoningEffort !== undefined) { if (!EFFORTS.has(patch.reasoningEffort)) throw new Error("reasoningEffort invalide"); next.reasoningEffort = patch.reasoningEffort; }
  if (patch.judgeEffort !== undefined) { if (!EFFORTS.has(patch.judgeEffort)) throw new Error("judgeEffort invalide"); next.judgeEffort = patch.judgeEffort; }
  for (const [k, min, max] of [["topK", 1, 20], ["maxTokens", 128, 32000], ["historyLimit", 2, 40], ["graphMaxChunks", 10, 5000]]) {
    if (patch[k] !== undefined) { const v = Number(patch[k]); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${k} doit être entre ${min} et ${max}`); next[k] = Math.round(v); }
  }
  if (patch.systemPrompt !== undefined) { if (typeof patch.systemPrompt !== "string" || patch.systemPrompt.length > 8000) throw new Error("systemPrompt invalide"); next.systemPrompt = patch.systemPrompt; }
  if (patch.llmBaseUrl !== undefined) {
    const u = String(patch.llmBaseUrl).trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw new Error("llmBaseUrl : URL http(s) attendue");
    const newKeyGiven = typeof patch.llmApiKey === "string" && patch.llmApiKey.trim() && !patch.llmApiKey.trim().startsWith("••••");
    if (u !== current.llmBaseUrl && !newKeyGiven) next.llmApiKey = ""; // nouvelle URL sans nouvelle clé : l'ancienne clé n'est jamais réutilisée
    next.llmBaseUrl = u;
  }
  if (patch.llmModel !== undefined) { const m = String(patch.llmModel).trim(); if (m.length > 200) throw new Error("llmModel invalide"); next.llmModel = m; }
  if (patch.llmApiKey !== undefined) {
    const k = String(patch.llmApiKey).trim();
    if (k && !k.startsWith("••••")) { if (k.length > 500) throw new Error("llmApiKey invalide"); next.llmApiKey = k; }
    else if (k === "") next.llmApiKey = "";
  }
  if (patch.llmReasoning !== undefined) next.llmReasoning = [true, "true", "on", 1, "1"].includes(patch.llmReasoning);
  if (patch.judgeEnabled !== undefined) next.judgeEnabled = [true, "true", "on", 1, "1"].includes(patch.judgeEnabled);
  if (patch.defaultModes !== undefined) {
    const arr = (Array.isArray(patch.defaultModes) ? patch.defaultModes : String(patch.defaultModes).split(",")).map((m) => String(m).trim()).filter((m) => ["llm", "rag", "graph"].includes(m));
    if (arr.length === 0) throw new Error("defaultModes : au moins un moteur");
    next.defaultModes = [...new Set(arr)];
  }
  if (patch.accessPassword !== undefined) { if (typeof patch.accessPassword !== "string" || patch.accessPassword.length > 200) throw new Error("accessPassword invalide"); next.accessPassword = patch.accessPassword; }
  current = next;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return current;
}

/** Réglages sans secret (clé API masquée) pour l'affichage. */
export function publicSettings(s = current) {
  const k = s.llmApiKey || "";
  return { ...s, llmApiKey: k ? "••••" + k.slice(-4) : "", llmApiKeySet: Boolean(k), llmConfigured: Boolean(s.llmBaseUrl && s.llmModel) };
}

export { DEFAULTS };
