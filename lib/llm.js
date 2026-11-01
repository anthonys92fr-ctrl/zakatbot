// Client minimal pour toute API compatible OpenAI (aucun fournisseur préconfiguré).
// Le fournisseur, le modèle et la clé viennent des réglages (admin) et peuvent changer à chaud.
import { getSettings } from "./settings.js";
import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { fetch as ufetch, Agent } from "undici";

const ALLOW_PRIVATE = /^(1|on|true)$/i.test(process.env.ALLOW_PRIVATE_LLM || "");
const PRIVATE_MSG = "Hôte LLM non autorisé (adresse locale ou privée). Pour un serveur local comme Ollama, définis ALLOW_PRIVATE_LLM=1 dans .env.";

/** Vrai si l'adresse n'est pas une adresse publique unicast (loopback, privée, lien-local, multicast, NAT64, IPv4-mappée…). */
function isPrivateIp(address) {
  let a;
  try { a = ipaddr.process(String(address)); } catch { return true; }
  if (a.kind() === "ipv6" && a.isIPv4MappedAddress()) a = a.toIPv4Address();
  return a.range() !== "unicast";
}

/**
 * Agent HTTP dont la résolution DNS filtre les adresses privées : la vérification et la connexion
 * utilisent la même réponse DNS (pas de fenêtre de « DNS rebinding »). Aucune redirection suivie.
 */
const safeAgent = new Agent({
  maxRedirections: 0,
  connect: {
    lookup(hostname, options, callback) {
      if (net.isIP(hostname)) {
        if (isPrivateIp(hostname)) return callback(Object.assign(new Error(PRIVATE_MSG), { code: "EPRIVATEHOST" }));
        return options.all ? callback(null, [{ address: hostname, family: net.isIP(hostname) }]) : callback(null, hostname, net.isIP(hostname));
      }
      if (hostname === "localhost" || hostname.endsWith(".localhost")) return callback(Object.assign(new Error(PRIVATE_MSG), { code: "EPRIVATEHOST" }));
      dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return callback(err);
        const ok = (addrs || []).filter((a) => !isPrivateIp(a.address));
        if (ok.length === 0) return callback(Object.assign(new Error(PRIVATE_MSG), { code: "EPRIVATEHOST" }));
        return options.all ? callback(null, ok) : callback(null, ok[0].address, ok[0].family);
      });
    },
  },
});
const openAgent = new Agent({ maxRedirections: 0 });

/** fetch vers le fournisseur LLM : agent filtrant sauf ALLOW_PRIVATE_LLM=1, jamais de redirection. */
async function llmFetch(url, init) {
  if (!ALLOW_PRIVATE) {
    // Les IP littérales ne passent pas par lookup() : contrôle direct ici
    let host;
    try { host = new URL(url).hostname.replace(/^\[|\]$/g, ""); } catch { throw Object.assign(new Error("URL de base invalide"), { status: 400 }); }
    if (net.isIP(host) ? isPrivateIp(host) : host === "localhost" || host.endsWith(".localhost")) throw Object.assign(new Error(PRIVATE_MSG), { status: 400 });
  }
  try {
    return await ufetch(url, { ...init, dispatcher: ALLOW_PRIVATE ? openAgent : safeAgent, redirect: "error" });
  } catch (err) {
    const cause = err?.cause || err;
    if (cause?.code === "EPRIVATEHOST" || /EPRIVATEHOST|non autorisé/.test(String(cause?.message))) throw Object.assign(new Error(PRIVATE_MSG), { status: 400 });
    throw err;
  }
}
function cfg(override = {}) {
  const s = getSettings();
  return {
    baseUrl: (override.baseUrl || s.llmBaseUrl || "").replace(/\/+$/, ""),
    model: override.model || s.llmModel || "",
    apiKey: override.apiKey !== undefined ? override.apiKey : (s.llmApiKey || ""),
    reasoning: override.reasoning !== undefined ? override.reasoning : s.llmReasoning !== false,
  };
}
function ensure(c) {
  if (!c.baseUrl || !c.model) {
    const err = new Error("LLM non configuré : renseigne le fournisseur, le modèle et la clé dans l'admin (Réglages → Modèle de langage) ou dans .env (LLM_BASE_URL, LLM_MODEL, LLM_API_KEY).");
    err.status = 503;
    throw err;
  }
}
const headers = (c) => ({ "Content-Type": "application/json", ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) });
function body(c, messages, { effort, maxTokens, stream }) {
  const b = { model: c.model, messages, max_tokens: maxTokens, stream };
  if (c.reasoning && effort) b.reasoning_effort = effort;
  if (stream) b.stream_options = { include_usage: true };
  return b;
}
async function fail(res) {
  const t = await res.text().catch(() => "");
  const err = new Error(`LLM ${res.status}: ${t.slice(0, 300)}`);
  err.status = res.status;
  return err;
}

/** Appel non-streamé. Retourne { text, usage }. */
export async function complete(messages, { effort = "low", maxTokens = 1024, signal, override } = {}) {
  const c = cfg(override); ensure(c);
  const res = await llmFetch(`${c.baseUrl}/chat/completions`, { method: "POST", headers: headers(c), body: JSON.stringify(body(c, messages, { effort, maxTokens, stream: false })), signal });
  if (!res.ok) throw await fail(res);
  const json = await res.json();
  return { text: json.choices?.[0]?.message?.content ?? "", usage: json.usage, model: json.model || c.model };
}

/** Appel streamé : onDelta(text), onReasoning(text), onUsage(usage). */
export async function stream(messages, { effort = "low", maxTokens = 2048, signal, onDelta, onReasoning, onUsage, override } = {}) {
  const c = cfg(override); ensure(c);
  const res = await llmFetch(`${c.baseUrl}/chat/completions`, { method: "POST", headers: headers(c), body: JSON.stringify(body(c, messages, { effort, maxTokens, stream: true })), signal });
  if (!res.ok) throw await fail(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const delta = json.choices?.[0]?.delta ?? {};
      if (delta.content && onDelta) onDelta(delta.content);
      const r = delta.reasoning_content ?? delta.reasoning;
      if (r && onReasoning) onReasoning(r);
      if (json.usage && onUsage) onUsage(json.usage);
    }
  }
}

/** Liste des modèles exposés par le fournisseur (GET /models). */
export async function listModels(override) {
  const c = cfg(override);
  if (!c.baseUrl) { const e = new Error("URL de base manquante"); e.status = 400; throw e; }
  const res = await llmFetch(`${c.baseUrl}/models`, { headers: headers(c) });
  if (!res.ok) throw await fail(res);
  const json = await res.json();
  const arr = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  return arr.map((m) => m.id || m.name || m.model).filter(Boolean);
}

export function currentModel() { return cfg().model; }
export function currentProvider() { const c = cfg(); return { baseUrl: c.baseUrl, model: c.model, reasoning: c.reasoning }; }
