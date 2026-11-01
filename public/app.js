/* Beam Lab — front */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const ALL_MODES = ["llm", "rag", "graph"];
let MODES = [...ALL_MODES]; // moteurs actifs, définis par l'admin (defaultModes)
function applyModes(list) {
  const wanted = ALL_MODES.filter((m) => (list || []).includes(m));
  MODES = wanted.length ? wanted : [...ALL_MODES];
  for (const m of ALL_MODES) lanes[m].hidden = !MODES.includes(m);
  document.getElementById("arena").style.setProperty("--cols", String(MODES.length));
  document.getElementById("arena").dataset.cols = String(MODES.length);
  const names = { llm: "LLM seul", rag: "LLM + RAG", graph: "LLM + RAG + Graph" };
  const label = MODES.length === 3 ? "les trois colonnes répondent en même temps"
    : MODES.length === 2 ? `${names[MODES[0]]} et ${names[MODES[1]]} répondent en même temps`
    : `${names[MODES[0]]} répond`;
  input.placeholder = `Pose ta question sur la zakat… ${label}`;
  const J = judgeEnabled;
  const hero = document.querySelector(".hero-text");
  if (hero) hero.textContent = MODES.length === 3
    ? `Nisab, hawl, calcul sur l'épargne, l'or, les actions ou l'entreprise, zakat al-fitr, bénéficiaires, écoles juridiques, pratique en France : la même question est envoyée à trois moteurs${J ? ", puis un juge compare les réponses" : ""}.`
    : MODES.length === 2
      ? `Nisab, hawl, calcul, zakat al-fitr, bénéficiaires, écoles juridiques, pratique en France : la même question est envoyée à deux moteurs (${names[MODES[0]]} et ${names[MODES[1]]})${J ? ", puis un juge compare les réponses" : ""}.`
      : `Nisab, hawl, calcul, zakat al-fitr, bénéficiaires, écoles juridiques, pratique en France : le moteur ${names[MODES[0]]} répond${J ? ", puis un juge évalue la réponse" : ""}.`;
  const sub = document.querySelector(".brand .sub");
  if (sub) sub.textContent = `Comprendre, calculer et donner la zakat — ${MODES.length === 3 ? "trois moteurs" : MODES.length === 2 ? "deux moteurs" : "un moteur"}${J ? ", un juge" : ""}.`;
  const jd = document.querySelector(".judge-head .sub");
  if (jd) jd.textContent = MODES.length === 1 ? "Beam évalue la réponse sur quatre critères et explique ce qui s'est passé." : `Beam évalue les ${MODES.length === 3 ? "trois" : "deux"} réponses sur quatre critères et explique ce qui s'est passé.`;
}
const LETTERS = { llm: "A", rag: "B", graph: "C" };
const LABELS = { llm: "LLM seul", rag: "RAG", graph: "RAG + Graph RAG" };

const form = $("#form"), input = $("#input"), sendBtn = $("#send"), clearBtn = $("#clear");
const autoJudge = $("#autoJudge");
const judgeSec = $("#judge"), judgeBody = $("#judgeBody"), judgeState = $("#judgeState");
const pwdDialog = $("#pwdDialog"), pwdForm = $("#pwdForm"), pwdInput = $("#pwd");

const lanes = Object.fromEntries(ALL_MODES.map((m) => [m, $(`.lane[data-mode="${m}"]`)]));
const threads = Object.fromEntries(ALL_MODES.map((m) => [m, $("[data-thread]", lanes[m])]));

let histories = { llm: [], rag: [], graph: [] };
let password = sessionStorage.getItem("zakatbot-pwd") || "";
let lastGraphNames = [];
let judgeEnabled = true;
function applyJudge(on) {
  judgeEnabled = Boolean(on);
  const wrap = autoJudge.closest(".toggle");
  if (wrap) wrap.hidden = !judgeEnabled;
  if (!judgeEnabled) judgeSec.hidden = true;
}
const hero = $("#hero");
let busy = false;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Markdown minimal, échappé ---------- */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function md(text) {
  const blocks = [];
  let t = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  t = esc(t);
  t = t.replace(/^### (.*)$/gm, "<strong>$1</strong>").replace(/^## (.*)$/gm, "<strong>$1</strong>").replace(/^# (.*)$/gm, "<strong>$1</strong>");
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, '<span class="cite">[$1]</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // tableaux : lignes "| a | b |" avec ligne de séparation "|---|---|"
  t = t.replace(/(?:^|\n)((?:\|.*\|[ \t]*(?:\n|$)){2,})/g, (m, block) => {
    const lines = block.trim().split("\n").map((r) => r.trim());
    const isSep = (r) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(r);
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const head = lines[0], body = lines.slice(1).filter((r) => !isSep(r));
    if (!lines.slice(1).some(isSep)) return m; // pas un vrai tableau
    return `\n<table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  });
  // listes
  t = t.replace(/(?:^|\n)((?:[-*] .*(?:\n|$))+)/g, (m, list) => "\n<ul>" + list.trim().split("\n").map((l) => `<li>${l.replace(/^[-*] /, "")}</li>`).join("") + "</ul>");
  t = t.replace(/(?:^|\n)((?:\d+\. .*(?:\n|$))+)/g, (m, list) => "\n<ol>" + list.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("") + "</ol>");
  t = t.split(/\n{2,}/).map((p) => (/^<(ul|ol|pre|table)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

/* ---------- Liens vers les fichiers sources ---------- */
let docToken = "", docTokenExp = 0;
async function ensureDocToken() {
  if (docToken && Date.now() < docTokenExp) return docToken;
  try {
    const r = await fetch("/api/doc-token", { method: "POST", headers: { "X-Access-Password": password } });
    if (r.ok) { const j = await r.json(); docToken = j.token; docTokenExp = Date.now() + (j.expiresIn - 60) * 1000; }
  } catch {}
  return docToken;
}
function docUrl(source) {
  const p = "/api/docs/file/" + String(source).split("/").map(encodeURIComponent).join("/");
  return docToken ? p + "?t=" + encodeURIComponent(docToken) : p;
}
/** Transforme les citations [n] d'une bulle en liens vers le fichier source correspondant. */
function linkCitations(bubble, sources) {
  if (!sources?.length) return;
  for (const c of bubble.querySelectorAll(".cite")) {
    const nums = (c.textContent.match(/\d+/g) || []).map(Number);
    const src = sources.find((s) => s.n === nums[0]);
    if (!src) continue;
    const a = document.createElement("a");
    a.className = "cite";
    a.href = docUrl(src.source); a.target = "_blank"; a.rel = "noopener";
    a.title = `${src.title || src.source} — ouvrir le fichier`;
    a.textContent = c.textContent;
    c.replaceWith(a);
  }
}

/* ---------- Rendu messages ---------- */
function clone(id) { return $(`#${id}`).content.firstElementChild.cloneNode(true); }

function addUser(mode, text) {
  const el = clone("tpl-user");
  $(".bubble", el).textContent = text;
  threads[mode].appendChild(el);
  scrollLane(mode);
  animateIn(el);
}
function addAssistant(mode) {
  const el = clone("tpl-assistant");
  threads[mode].appendChild(el);
  scrollLane(mode);
  animateIn(el);
  return el;
}
function animateIn(el) { el.classList.add("anim-in"); }
function scrollLane(mode) { const t = threads[mode]; t.scrollTop = t.scrollHeight; }
function setMetric(mode, key, ms) {
  const b = $(`[data-m="${key}"]`, lanes[mode]);
  if (b) b.textContent = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
const fmtN = (n) => Number(n || 0).toLocaleString("fr-FR");
function setTokens(mode, usage) {
  const b = $(`[data-m="tokens"]`, lanes[mode]);
  if (!b || !usage) return;
  const total = usage.total_tokens ?? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  b.textContent = fmtN(total);
  b.parentElement.title = `prompt ${fmtN(usage.prompt_tokens)} · réponse ${fmtN(usage.completion_tokens)}${usage.completion_tokens_details?.reasoning_tokens ? ` (dont raisonnement ${fmtN(usage.completion_tokens_details.reasoning_tokens)})` : ""}`;
}
function usageFooter(usage) {
  if (!usage) return "";
  const total = usage.total_tokens ?? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  const r = usage.completion_tokens_details?.reasoning_tokens;
  return `<div class="usage">${fmtN(total)} tokens · prompt ${fmtN(usage.prompt_tokens)} · réponse ${fmtN(usage.completion_tokens)}${r ? ` · raisonnement ${fmtN(r)}` : ""}</div>`;
}
function resetMetrics(mode) { $$("[data-m]", lanes[mode]).forEach((b) => (b.textContent = "—")); }

function renderSources(el, sources) {
  const box = $(".sources", el);
  if (!sources?.length) return;
  box.hidden = false;
  box.innerHTML = "";
  for (const s of sources) {
    const chip = document.createElement("a");
    chip.className = "chip";
    chip.href = docUrl(s.source); chip.target = "_blank"; chip.rel = "noopener";
    chip.title = `${s.source} — ouvrir le fichier\n\n${s.preview}…`;
    chip.innerHTML = `<b>[${s.n}]</b><span>${esc(s.title || s.source)}</span>`;
    box.appendChild(chip);
  }
}
function renderGraph(el, graph) {
  const box = $(".graphbox", el);
  if (!graph || (!graph.entities?.length && !graph.relations?.length)) return;
  box.hidden = false;
  box.innerHTML = "";
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = `graphe · ${graph.entities.length} entités · ${graph.relations.length} relations${graph.seeds?.length ? ` · amorces : ${graph.seeds.join(", ")}` : ""}`;
  box.appendChild(lbl);
  for (const r of graph.relations.slice(0, 8)) {
    const chip = document.createElement("span");
    chip.className = "chip rel";
    chip.innerHTML = `<span>${esc(r.source)}</span><em>—${esc(r.relation)}→</em><span>${esc(r.target)}</span>`;
    box.appendChild(chip);
  }
  for (const e of graph.entities.slice(0, 10)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span>${esc(e.name)}</span>${e.type ? `<em style="color:var(--muted)">${esc(e.type)}</em>` : ""}`;
    box.appendChild(chip);
  }
}

/* ---------- Appel streamé d'un mode ---------- */
async function ask(mode, text) {
  await ensureDocToken();
  const lane = lanes[mode];
  lane.classList.add("active");
  lane.classList.remove("winner");
  resetMetrics(mode);
  histories[mode].push({ role: "user", content: text });
  addUser(mode, text);
  const el = addAssistant(mode);
  const bubble = $(".bubble", el);
  let full = "", reasoning = "", usage = null, sources = [];

  try {
    const res = await fetch(`/api/chat/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Password": password },
      body: JSON.stringify({ messages: histories[mode] }),
    });
    if (res.status === 401) { el.remove(); histories[mode].pop(); askPassword(); return null; }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Erreur ${res.status}`); }

    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const ev = JSON.parse(line.slice(5));
        switch (ev.type) {
          case "context":
            setMetric(mode, "ctx", ev.ms); sources = ev.sources || []; renderSources(el, ev.sources); renderGraph(el, ev.graph);
            if (mode === "graph" && window.GraphViz?.setHighlight) {
              const names = [...(ev.graph?.entities || []).map((e) => e.name), ...(ev.sources || []).map((s) => s.source)];
              lastGraphNames = names;
              if (GraphViz.visible) GraphViz.setHighlight(names);
            }
            break;
          case "first": setMetric(mode, "first", ev.ms); break;
          case "text": full += ev.text; bubble.innerHTML = md(full) + '<span class="cursor"></span>'; scrollLane(mode); break;
          case "reasoning": reasoning += ev.text; if (!full) bubble.innerHTML = '<span class="thinking"><i></i><i></i><i></i></span> <span class="reason-hint">réflexion…</span>'; break;
          case "usage": usage = ev.usage; setTokens(mode, usage); break;
          case "done": setMetric(mode, "total", ev.ms); break;
          case "error": throw new Error(ev.error);
        }
      }
    }
    if (!full) full = "(réponse vide)";
    bubble.innerHTML = md(full) + usageFooter(usage);
    linkCitations(bubble, sources);
    histories[mode].push({ role: "assistant", content: full, reasoning, usage, sources });
    return full;
  } catch (err) {
    el.classList.add("error");
    bubble.textContent = err.message || "Erreur inconnue";
    histories[mode].pop();
    return null;
  } finally {
    lane.classList.remove("active");
    save();
  }
}

/* ---------- Juge ---------- */
async function runJudge(question, answers) {
  judgeSec.hidden = false;
  judgeState.innerHTML = '<span class="thinking" style="--lane:var(--c-judge)"><i></i><i></i><i></i></span> délibération…';
  judgeBody.innerHTML = '<p class="judge-empty">Le juge relit les trois réponses et les sources…</p>';
  judgeSec.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  try {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Password": password },
      body: JSON.stringify({ question, answers }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Erreur ${res.status}`); }
    const j = await res.json();
    renderJudge(j);
    const u = j.usage;
    judgeState.textContent = u ? `verdict rendu · ${fmtN(u.total_tokens ?? (u.prompt_tokens || 0) + (u.completion_tokens || 0))} tokens (prompt ${fmtN(u.prompt_tokens)} · réponse ${fmtN(u.completion_tokens)})` : "verdict rendu";
  } catch (err) {
    judgeState.textContent = "échec";
    judgeBody.innerHTML = `<p class="judge-empty" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

function renderJudge(j) {
  const crit = [["exactitude", "Exactitude"], ["fidelite", "Fidélité"], ["completude", "Complétude"], ["clarte", "Clarté"]];
  const grid = document.createElement("div");
  grid.className = "score-grid";
  const judged = (j.modes && j.modes.length ? j.modes : MODES).filter((m) => j.scores?.[LETTERS[m]]);
  grid.dataset.cols = String(judged.length);
  for (const mode of judged) {
    const L = LETTERS[mode], raw = j.scores?.[L] || {};
    const num = (v) => Math.max(0, Math.min(10, Number(v) || 0));
    const s = { exactitude: num(raw.exactitude), fidelite: num(raw.fidelite), completude: num(raw.completude), clarte: num(raw.clarte), total: raw.total == null ? null : num(raw.total) };
    const card = document.createElement("div");
    card.className = "score-card" + (judged.length > 1 && j.gagnant === L ? " winner" : "");
    card.style.setProperty("--lane", `var(--c-${mode})`);
    card.innerHTML = `
      <div class="score-top"><h3>${L} · ${LABELS[mode]}</h3><div class="score-total">${s.total ?? "—"}<small>/10</small></div></div>
      <div class="bars">${crit.map(([k, lbl]) => `<div class="bar"><span>${lbl}</span><div class="track"><div class="fill" data-w="${(s[k] ?? 0) * 10}"></div></div><b>${s[k] ?? "—"}</b></div>`).join("")}</div>
      <div class="analysis">${md(j.analyses?.[L] || "")}</div>`;
    grid.appendChild(card);
    lanes[mode].classList.toggle("winner", judged.length > 1 && j.gagnant === L);
  }
  const verdict = document.createElement("div");
  verdict.className = "verdict";
  verdict.innerHTML = `<b>Verdict</b> — ${md(j.verdict || "")}`;
  judgeBody.innerHTML = "";
  judgeBody.append(grid, verdict);
  requestAnimationFrame(() => $$(".fill", grid).forEach((f) => (f.style.width = f.dataset.w + "%")));
  $$(".score-card", grid).forEach((c, i) => { c.style.animationDelay = `${i * 80}ms`; c.classList.add("anim-pop"); });
}

/* ---------- Orchestration ---------- */
async function submit(text) {
  if (busy) return;
  busy = true; sendBtn.disabled = true;
  judgeSec.hidden = true;
  hero.classList.add("collapsed");
  ALL_MODES.forEach((m) => lanes[m].classList.remove("winner"));

  const results = await Promise.all(MODES.map((m) => ask(m, text)));
  const answers = Object.fromEntries(MODES.map((m, i) => [m, results[i]]).filter(([, v]) => v));

  if (judgeEnabled && autoJudge.checked && results.some(Boolean)) await runJudge(text, answers);

  busy = false; sendBtn.disabled = false; input.focus();
}

/* ---------- Persistance ---------- */
function save() { try { localStorage.setItem("zakatbot-history", JSON.stringify(histories)); } catch {} }
function load() {
  try {
    const raw = localStorage.getItem("zakatbot-history");
    if (!raw) return;
    histories = JSON.parse(raw);
    if (ALL_MODES.some((m) => histories[m]?.length)) hero.classList.add("collapsed");
    for (const m of ALL_MODES) for (const msg of histories[m] || []) {
      if (msg.role === "user") addUser(m, msg.content);
      else { const el = addAssistant(m); $(".bubble", el).innerHTML = md(msg.content) + usageFooter(msg.usage); if (msg.sources?.length) { renderSources(el, msg.sources); linkCitations($(".bubble", el), msg.sources); } }
    }
  } catch { histories = { llm: [], rag: [], graph: [] }; }
}

/* ---------- UI ---------- */
function askPassword() { pwdInput.value = ""; pwdDialog.showModal(); }
pwdForm.addEventListener("submit", () => { password = pwdInput.value; sessionStorage.setItem("zakatbot-pwd", password); });

/* suggestions + graphe */
$$(".sugg").forEach((b) => b.addEventListener("click", () => { input.value = b.textContent.trim(); autoResize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }));
const toggleGraphBtn = $("#toggleGraph");
toggleGraphBtn.addEventListener("click", async () => {
  if (GraphViz.visible) { GraphViz.hide(); toggleGraphBtn.setAttribute("aria-expanded", "false"); }
  else { await GraphViz.show(password); GraphViz.setHighlight(lastGraphNames); toggleGraphBtn.setAttribute("aria-expanded", "true"); document.getElementById("graphviz").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); }
});

function autoResize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px"; }
form.addEventListener("submit", (e) => { e.preventDefault(); const t = input.value.trim(); if (!t || busy) return; input.value = ""; autoResize(); submit(t); });
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
input.addEventListener("input", autoResize);
clearBtn.addEventListener("click", () => {
  histories = { llm: [], rag: [], graph: [] }; save();
  ALL_MODES.forEach((m) => { threads[m].innerHTML = ""; resetMetrics(m); lanes[m].classList.remove("winner"); });
  judgeSec.hidden = true;
  hero.classList.remove("collapsed");
  lastGraphNames = []; if (GraphViz.visible) GraphViz.setHighlight([]);
});

fetch("/api/config").then((r) => r.json()).then((c) => {
  const pm = $("#pillModel");
  if (c.llmConfigured === false || !c.model) { pm.classList.add("bad"); pm.innerHTML = '<i class="led"></i>LLM non configuré · voir Admin → Réglages'; }
  else { pm.classList.add("ok"); pm.innerHTML = `<i class="led"></i>${esc(c.model)} · effort ${esc(c.effort)}`; }
  applyJudge(c.judgeEnabled !== false);
  applyModes(c.defaultModes);
  const ix = c.index || {};
  $("#pillIndex").textContent = ix.ready ? `index : ${ix.chunks} chunks · ${ix.sources} docs${ix.vectors ? " · vecteurs" : " · BM25"}` : "index : absent";
  $("#pillGraph").textContent = ix.graph ? `graphe : ${ix.graph.nodes} nœuds · ${ix.graph.edges} arêtes` : "graphe : absent";
  if (c.needsPassword && !password) askPassword();
}).catch(() => { const pm = $("#pillModel"); pm.classList.add("bad"); pm.innerHTML = '<i class="led"></i>serveur injoignable'; });

load();
ensureDocToken().then(() => { if (!docToken) return; for (const m of ALL_MODES) for (const a of threads[m].querySelectorAll('a.chip, a.cite')) { const u = new URL(a.href, location.origin); if (!u.searchParams.get('t')) { u.searchParams.set('t', docToken); a.href = u.pathname + u.search; } } });
input.focus();
