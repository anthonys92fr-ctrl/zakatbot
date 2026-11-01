/* Admin ZakatBot */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => Number(n || 0).toLocaleString("fr-FR");
const fmtB = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " Mo" : b > 1024 ? Math.round(b / 1024) + " Ko" : b + " o");
const fmtD = (d) => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

let adminPwd = sessionStorage.getItem("zakatbot-admin") || "";
const pwdDialog = $("#pwdDialog"), pwdForm = $("#pwdForm"), pwdInput = $("#pwd");

async function api(path, opts = {}) {
  const res = await fetch("/api/admin" + path, { ...opts, headers: { "X-Admin-Password": adminPwd, "X-Requested-With": "ZakatBot", ...(opts.headers || {}) } });
  if (res.status === 401) { askPwd(); throw new Error("Mot de passe admin requis"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
const INSECURE = location.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
function askPwd() {
  if (INSECURE) { alert("Connexion non chiffrée (HTTP) : le mot de passe admin ne sera pas envoyé. Utilise l'adresse en https://."); return; }
  pwdInput.value = ""; if (!pwdDialog.open) pwdDialog.showModal();
}
pwdForm.addEventListener("submit", () => { adminPwd = pwdInput.value; sessionStorage.setItem("zakatbot-admin", adminPwd); boot(); });

/* ---------- onglets ---------- */
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
  location.hash = t.dataset.tab;
  if (t.dataset.tab === "stats") loadStats();
  if (t.dataset.tab === "index") attachLog();
}));

/* ---------- en-tête ---------- */
function renderStatus(ix, uptime) {
  const pi = $("#pillIndex");
  pi.classList.toggle("ok", Boolean(ix?.ready)); pi.classList.toggle("bad", !ix?.ready);
  pi.innerHTML = `<i class="led"></i>${ix?.ready ? `index : ${fmtN(ix.chunks)} chunks · ${ix.sources} docs${ix.vectors ? " · vecteurs" : ""}` : "index : absent"}`;
  $("#pillGraph").textContent = ix?.graph ? `graphe : ${fmtN(ix.graph.nodes)} nœuds · ${fmtN(ix.graph.edges)} arêtes` : "graphe : absent";
  if (uptime != null) $("#pillUptime").textContent = `serveur : ${uptime > 3600 ? Math.floor(uptime / 3600) + " h " : ""}${Math.floor((uptime % 3600) / 60)} min`;
}

/* ---------- documents ---------- */
let linkToken = "", linkTokenExp = 0;
async function getLinkToken() {
  if (linkToken && Date.now() < linkTokenExp) return linkToken;
  const r = await api("/token", { method: "POST" });
  linkToken = r.token; linkTokenExp = Date.now() + (r.expiresIn - 60) * 1000;
  return linkToken;
}
function fileUrl(source, download = false) {
  const p = "/api/admin/docs/file/" + source.split("/").map(encodeURIComponent).join("/");
  const q = [];
  if (download) q.push("download=1");
  if (linkToken) q.push("t=" + encodeURIComponent(linkToken));
  return p + (q.length ? "?" + q.join("&") : "");
}
async function loadDocs() {
  await getLinkToken().catch(() => {});
  const { docs, index, stale } = await api("/docs");
  renderStatus(index);
  $("#staleBadge").hidden = !stale;
  const tb = $("#docsTable tbody");
  tb.innerHTML = docs.map((d) => `
    <tr>
      <td><a class="doc-link" href="${fileUrl(d.source)}" target="_blank" rel="noopener"><b>${esc(d.title || d.source)}</b></a><br><span style="color:var(--muted);font-size:12px">${esc(d.source)}</span></td>
      <td><span class="type ${esc(d.type)}">${esc(d.type)}</span></td>
      <td class="num">${fmtB(d.size)}</td>
      <td class="num">${d.pages ?? "—"}</td>
      <td class="num">${d.indexed ? fmtN(d.chunks) : "—"}</td>
      <td>${d.indexed ? '<span class="yes">oui</span>' : '<span class="no">non</span>'}</td>
      <td style="font-size:12px;color:var(--muted)">${fmtD(d.mtime)}</td>
      <td class="row-actions"><a class="btn sm" href="${fileUrl(d.source)}" target="_blank" rel="noopener" title="Ouvrir dans un nouvel onglet">Ouvrir</a><a class="btn sm" href="${fileUrl(d.source, true)}" title="Télécharger">↓</a><button class="btn sm danger" data-del="${esc(d.source)}" type="button">Supprimer</button></td>
    </tr>`).join("");
  $("#docsEmpty").hidden = docs.length > 0;
  $$("[data-del]", tb).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Supprimer ${b.dataset.del} ? Il faudra réindexer ensuite.`)) return;
    try { await api("/docs/" + b.dataset.del.split("/").map(encodeURIComponent).join("/"), { method: "DELETE" }); await loadDocs(); }
    catch (e) { alert(e.message); }
  }));
}

const dz = $("#dropzone"), fileInput = $("#fileInput"), uploads = $("#uploads");
dz.addEventListener("click", () => fileInput.click());
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
dz.addEventListener("drop", (e) => uploadFiles([...e.dataTransfer.files]));
fileInput.addEventListener("change", () => { uploadFiles([...fileInput.files]); fileInput.value = ""; });

function readB64(file) {
  return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result.split(",")[1]); r.onerror = ko; r.readAsDataURL(file); });
}
async function uploadFiles(files) {
  const folder = $("#folder").value.trim();
  for (const f of files) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(f.name)}</span><span class="bar"><i></i></span><span class="st">${fmtB(f.size)}</span>`;
    uploads.prepend(li);
    const bar = $(".bar i", li), st = $(".st", li);
    try {
      bar.style.width = "30%";
      const contentBase64 = await readB64(f);
      bar.style.width = "60%";
      const r = await api("/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, folder, contentBase64 }) });
      bar.style.width = "100%"; li.classList.add("ok"); st.textContent = "ajouté : " + r.source;
    } catch (e) { li.classList.add("err"); st.textContent = e.message; }
  }
  await loadDocs();
}
$("#pasteBtn").addEventListener("click", async () => {
  const name = $("#pasteName").value.trim(), text = $("#pasteText").value;
  if (!name || !text.trim()) return alert("Nom et contenu requis.");
  try { await api("/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: /\.(md|txt)$/i.test(name) ? name : name + ".md", folder: $("#folder").value.trim(), text }) }); $("#pasteName").value = ""; $("#pasteText").value = ""; await loadDocs(); }
  catch (e) { alert(e.message); }
});

/* ---------- réindexation ---------- */
const log = $("#log"), jobState = $("#jobState"), cancelBtn = $("#cancelBtn");
let es = null;
function setRunning(on) { $$("[data-reindex]").forEach((b) => (b.disabled = on)); cancelBtn.hidden = !on; }
async function attachLog() {
  if (es) es.close();
  log.textContent = "";
  const t = await getLinkToken().catch(() => "");
  es = new EventSource("/api/admin/reindex/stream" + (t ? "?t=" + encodeURIComponent(t) : ""));
  es.onmessage = (ev) => {
    const line = JSON.parse(ev.data);
    if (line.startsWith("__END__")) {
      const code = line.split(" ")[1];
      if (code !== "none") { jobState.textContent = code === "0" ? "terminé" : `échec (code ${code})`; jobState.className = "job-state " + (code === "0" ? "ok" : "err"); setRunning(false); loadDocs(); }
      es.close(); return;
    }
    log.textContent += line + "\n"; log.scrollTop = log.scrollHeight;
  };
  es.onerror = () => es.close();
}
$$("[data-reindex]").forEach((b) => b.addEventListener("click", async () => {
  try {
    await api("/reindex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: b.dataset.reindex }) });
    jobState.textContent = "en cours…"; jobState.className = "job-state"; setRunning(true); attachLog();
  } catch (e) { jobState.textContent = e.message; jobState.className = "job-state err"; }
}));
cancelBtn.addEventListener("click", () => api("/reindex/cancel", { method: "POST" }).catch(() => {}));

/* ---------- réglages ---------- */
const form = $("#settingsForm"), settingsState = $("#settingsState");
let defaults = {};
function fillSettings(s) {
  for (const [k, v] of Object.entries(s)) { const el = form.elements[k]; if (!el) continue; if (el.type === "checkbox") { el.checked = Boolean(v); continue; } el.value = Array.isArray(v) ? v.join(",") : v; }
  llmPreset.value = detectPreset(s.llmBaseUrl);
  const k = form.elements.llmApiKey; if (k) { k.value = ""; k.placeholder = s.llmApiKeySet ? `(inchangée : ${s.llmApiKey})` : "(aucune clé)"; }
  const dm = form.elements.defaultModes; if (dm && Array.isArray(s.defaultModes)) { const key = ["llm", "rag", "graph"].filter((m) => s.defaultModes.includes(m)).join(","); dm.value = key; }
}
async function loadSettings() { const r = await api("/settings"); defaults = r.defaults; fillSettings(r.settings); }
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const patch = Object.fromEntries(new FormData(form).entries());
  patch.judgeEnabled = form.elements.judgeEnabled.checked;
  patch.llmReasoning = form.elements.llmReasoning.checked;
  if (!patch.llmApiKey) delete patch.llmApiKey; // vide = conserver
  try { const r = await api("/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }); fillSettings(r.settings); settingsState.textContent = "enregistré"; settingsState.className = "job-state ok"; }
  catch (err) { settingsState.textContent = err.message; settingsState.className = "job-state err"; }
});
$("#resetBtn").addEventListener("click", async () => {
  try { const r = await api("/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(defaults) }); fillSettings(r.settings); settingsState.textContent = "valeurs du .env restaurées"; settingsState.className = "job-state ok"; }
  catch (err) { settingsState.textContent = err.message; settingsState.className = "job-state err"; }
});

/* ---------- LLM ---------- */
const PRESETS = {
  reflection: { url: "https://api.reflection.ai/openai/v1", model: "Beam-1.0-501B-A23B", reasoning: true },
  openai: { url: "https://api.openai.com/v1", model: "gpt-4o-mini", reasoning: false },
  groq: { url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", reasoning: false },
  mistral: { url: "https://api.mistral.ai/v1", model: "mistral-large-latest", reasoning: false },
  openrouter: { url: "https://openrouter.ai/api/v1", model: "reflection/beam-1.0-501b-a23b", reasoning: false },
  ollama: { url: "http://localhost:11434/v1", model: "llama3.1", reasoning: false },
  custom: null,
};
const llmPreset = $("#llmPreset"), llmTestState = $("#llmTestState");
function detectPreset(url) { if (!url) return ""; return Object.entries(PRESETS).find(([k, p]) => p && url.startsWith(p.url))?.[0] || "custom"; }
llmPreset.addEventListener("change", () => {
  const p = PRESETS[llmPreset.value];
  if (!p) return;
  form.elements.llmBaseUrl.value = p.url; form.elements.llmModel.value = p.model; form.elements.llmReasoning.checked = p.reasoning;
});
form.elements.llmBaseUrl.addEventListener("input", () => { llmPreset.value = detectPreset(form.elements.llmBaseUrl.value); });
function llmBody() { return { llmBaseUrl: form.elements.llmBaseUrl.value.trim(), llmModel: form.elements.llmModel.value.trim(), llmApiKey: form.elements.llmApiKey.value, llmReasoning: form.elements.llmReasoning.checked }; }
$("#llmTestBtn").addEventListener("click", async () => {
  llmTestState.textContent = "test en cours…"; llmTestState.className = "job-state";
  try {
    const r = await api("/llm/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(llmBody()) });
    llmTestState.textContent = `OK en ${(r.ms / 1000).toFixed(1)} s · modèle ${r.model}${r.usage?.total_tokens ? ` · ${fmtN(r.usage.total_tokens)} tokens` : ""} · réponse : « ${r.text} »`;
    llmTestState.className = "job-state ok";
  } catch (e) { llmTestState.textContent = e.message; llmTestState.className = "job-state err"; }
});
$("#llmListBtn").addEventListener("click", async () => {
  llmTestState.textContent = "chargement des modèles…"; llmTestState.className = "job-state";
  try {
    const r = await api("/llm/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(llmBody()) });
    $("#llmModels").innerHTML = r.models.map((m) => `<option value="${esc(m)}"></option>`).join("");
    llmTestState.textContent = `${r.models.length} modèle(s) disponibles : commence à taper dans le champ Modèle.`; llmTestState.className = "job-state ok";
  } catch (e) { llmTestState.textContent = e.message; llmTestState.className = "job-state err"; }
});

/* ---------- stats ---------- */
const LABELS = { llm: "A · LLM seul", rag: "B · RAG", graph: "C · RAG + Graph RAG", judge: "Juge" };
async function loadStats() {
  const s = await api("/stats");
  renderStatus(s.index, s.uptimeSec);
  const all = Object.values(s.byMode);
  const tot = (k) => all.reduce((a, m) => a + (m[k] || 0), 0);
  $("#tiles").innerHTML = [
    [fmtN(tot("requests")), "requêtes"], [fmtN(tot("totalTokens")), "tokens consommés"], [fmtN(tot("reasoningTokens")), "tokens de raisonnement"],
    [fmtN(tot("errors")), "erreurs"], [s.memoryMb + " Mo", "mémoire serveur"], [fmtD(s.startedAt), "démarré le"],
  ].map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#statsTable tbody").innerHTML = Object.entries(s.byMode).map(([k, m]) => `<tr><td>${LABELS[k] || k}</td><td class="num">${fmtN(m.requests)}</td><td class="num">${fmtN(m.errors)}</td><td class="num">${fmtN(m.promptTokens)}</td><td class="num">${fmtN(m.completionTokens)}</td><td class="num">${fmtN(m.reasoningTokens)}</td><td class="num">${fmtN(m.totalTokens)}</td><td class="num">${m.avgMs ? (m.avgMs / 1000).toFixed(1) + " s" : "—"}</td></tr>`).join("");
  $("#recent").innerHTML = s.recent.length ? s.recent.map((r) => `<li><time>${fmtD(r.at)}</time><span>${esc(r.question)}</span></li>`).join("") : '<li style="color:var(--muted)">Aucune question depuis le démarrage.</li>';
}
$("#refreshStats").addEventListener("click", loadStats);

/* ---------- démarrage ---------- */
async function boot() {
  try {
    await loadDocs(); await loadSettings();
    api("/stats").then((s) => renderStatus(s.index, s.uptimeSec)).catch(() => {});
    const st = await api("/reindex/status");
    if (st.running) { setRunning(true); jobState.textContent = "en cours…"; }
    const tab = location.hash.slice(1);
    if (tab) $(`.tab[data-tab="${tab}"]`)?.click();
  } catch (e) {
    if (!/admin requis/.test(e.message)) alert(e.message);
  }
}
boot();
