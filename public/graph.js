/* Visualisation force-directed du graphe de connaissances (canvas, sans dépendance). */
window.GraphViz = (function () {
  const canvas = document.getElementById("gvCanvas");
  const tip = document.getElementById("gvTip");
  const empty = document.getElementById("gvEmpty");
  const search = document.getElementById("gvSearch");
  const section = document.getElementById("graphviz");
  if (!canvas) return {};
  const ctx = canvas.getContext("2d");

  let nodes = [], links = [], byId = new Map();
  let W = 0, H = 0, dpr = 1;
  let running = false, alpha = 1, raf = null;
  let hover = null, drag = null, highlight = new Set(), filter = "";
  let view = { x: 0, y: 0, k: 1 };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const colors = () => ({
    doc: css("--c-rag"), ent: css("--c-graph"), gold: css("--gold") || "#c9a227",
    text: css("--text"), muted: css("--muted"), line: css("--border-strong"),
  });

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    draw();
  }

  function load(data) {
    nodes = data.nodes.map((n, i) => ({
      ...n,
      r: n.kind === "doc" ? 11 : 4 + Math.min(10, Math.sqrt(n.degree || 1) * 2),
      x: W / 2 + Math.cos(i) * (n.kind === "doc" ? 120 : 260) + (Math.random() - .5) * 40,
      y: H / 2 + Math.sin(i) * (n.kind === "doc" ? 120 : 200) + (Math.random() - .5) * 40,
      vx: 0, vy: 0,
    }));
    byId = new Map(nodes.map((n) => [n.id, n]));
    links = data.links.map((l) => ({ ...l, s: byId.get(l.source), t: byId.get(l.target) })).filter((l) => l.s && l.t);
    empty.hidden = nodes.length > 0;
    alpha = 1; view = { x: 0, y: 0, k: 1 };
    start();
  }

  /* ---- simulation ---- */
  function step() {
    const n = nodes.length;
    if (!n) return;
    // répulsion (approximation O(n²) acceptable jusqu'à ~500 nœuds)
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 90000) continue;
        const f = (a.kind === "doc" || b.kind === "doc" ? 4200 : 1700) / d2;
        const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    // ressorts
    for (const l of links) {
      const rest = l.kind === "mention" ? 90 : 60;
      let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - rest) * (l.kind === "mention" ? 0.02 : 0.04);
      dx /= d; dy /= d;
      l.s.vx += dx * f; l.s.vy += dy * f; l.t.vx -= dx * f; l.t.vy -= dy * f;
    }
    // gravité vers le centre + intégration
    for (const a of nodes) {
      if (a === drag) { a.vx = a.vy = 0; continue; }
      a.vx += (W / 2 - a.x) * 0.002; a.vy += (H / 2 - a.y) * 0.002;
      a.vx *= 0.85; a.vy *= 0.85;
      a.x += a.vx * alpha; a.y += a.vy * alpha;
    }
    alpha = Math.max(alpha * 0.985, 0.08);
  }

  function start() {
    if (running) return;
    running = true;
    const loop = () => { if (!running) return; step(); draw(); raf = requestAnimationFrame(loop); };
    loop();
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

  /* ---- rendu ---- */
  function matches(n) { return filter && (n.label || "").toLowerCase().includes(filter); }
  function draw() {
    const c = colors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
    const anyHL = highlight.size > 0 || filter;
    const isHL = (n) => highlight.has(n.id) || matches(n) || (hover && (hover === n || links.some((l) => (l.s === hover && l.t === n) || (l.t === hover && l.s === n))));

    for (const l of links) {
      const hl = anyHL || hover ? (isHL(l.s) && isHL(l.t)) || (hover && (l.s === hover || l.t === hover)) : false;
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y);
      ctx.strokeStyle = hl ? c.gold : (l.kind === "mention" ? c.line : c.ent);
      ctx.globalAlpha = hl ? 0.95 : (anyHL || hover ? 0.08 : (l.kind === "mention" ? 0.35 : 0.5));
      ctx.lineWidth = hl ? 1.8 : (l.kind === "mention" ? 0.8 : 1.2);
      if (l.kind === "mention") ctx.setLineDash([3, 4]); else ctx.setLineDash([]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const n of nodes) {
      const hl = isHL(n);
      ctx.globalAlpha = anyHL || hover ? (hl ? 1 : 0.25) : 1;
      if (n.kind === "doc") {
        ctx.fillStyle = c.doc;
        ctx.beginPath(); ctx.roundRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2, 3); ctx.fill();
        if (hl) { ctx.strokeStyle = c.gold; ctx.lineWidth = 2.5; ctx.stroke(); }
      } else {
        ctx.fillStyle = hl ? c.gold : c.ent;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
        if (hl) { ctx.strokeStyle = c.text; ctx.lineWidth = 1; ctx.stroke(); }
      }
      const showLabel = n.kind === "doc" || n.r >= 8 || hl || view.k > 1.6;
      if (showLabel) {
        ctx.fillStyle = c.text; ctx.font = `${n.kind === "doc" ? "600 " : ""}${n.kind === "doc" ? 12 : 11}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        const label = (n.label || "").length > 32 ? n.label.slice(0, 30) + "…" : n.label;
        ctx.fillText(label, n.x, n.y + n.r + 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---- interactions ---- */
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  }
  function pick(p) {
    let best = null, bd = Infinity;
    for (const n of nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < n.r + 6 && d < bd) { bd = d; best = n; } }
    return best;
  }
  canvas.addEventListener("mousemove", (e) => {
    const p = toWorld(e);
    if (drag) { drag.x = p.x; drag.y = p.y; alpha = Math.max(alpha, 0.3); start(); return; }
    const n = pick(p);
    if (n !== hover) { hover = n; canvas.style.cursor = n ? "pointer" : "grab"; draw(); }
    if (n) {
      tip.hidden = false;
      const r = canvas.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - r.left + 14, W - 280) + "px"; tip.style.top = e.clientY - r.top + 14 + "px";
      tip.innerHTML = n.kind === "doc"
        ? `<b>${esc(n.label)}</b><br><span>${esc(n.source)}</span><br><span>${n.chunks} chunks${n.pages ? ` · ${n.pages} pages` : ""}</span>`
        : `<b>${esc(n.label)}</b>${n.type ? ` <em>${esc(n.type)}</em>` : ""}${n.description ? `<br><span>${esc(n.description.slice(0, 160))}</span>` : ""}<br><span>${links.filter((l) => l.s === n || l.t === n).length} liens</span>`;
    } else tip.hidden = true;
  });
  canvas.addEventListener("mouseleave", () => { hover = null; tip.hidden = true; draw(); });
  canvas.addEventListener("mousedown", (e) => { const n = pick(toWorld(e)); if (n) { drag = n; canvas.style.cursor = "grabbing"; } else { drag = null; panStart = { x: e.clientX - view.x, y: e.clientY - view.y }; } });
  let panStart = null;
  window.addEventListener("mousemove", (e) => { if (panStart && !drag) { view.x = e.clientX - panStart.x; view.y = e.clientY - panStart.y; draw(); } });
  window.addEventListener("mouseup", () => { drag = null; panStart = null; canvas.style.cursor = "grab"; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(4, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.12 : 0.9)));
    view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k; draw();
  }, { passive: false });
  canvas.addEventListener("dblclick", () => { view = { x: 0, y: 0, k: 1 }; alpha = 0.6; start(); });
  search?.addEventListener("input", () => { filter = search.value.trim().toLowerCase(); draw(); });
  window.addEventListener("resize", () => { if (!section.hidden) resize(); });

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---- API publique ---- */
  let loaded = false;
  async function show(password) {
    section.hidden = false;
    resize();
    if (!loaded) {
      try {
        const res = await fetch("/api/graph?max=150", { headers: { "X-Access-Password": password || "" } });
        const data = await res.json();
        load(data); loaded = true;
      } catch { empty.hidden = false; }
    } else start();
  }
  function hide() { section.hidden = true; stop(); }
  function setHighlight(names) {
    highlight = new Set();
    if (names?.length) {
      const wanted = names.map((s) => s.toLowerCase());
      for (const n of nodes) if (n.kind === "entity" && wanted.includes((n.label || "").toLowerCase())) highlight.add(n.id);
      for (const n of nodes) if (n.kind === "doc" && names.some((s) => (n.source || "").includes(s))) highlight.add(n.id);
    }
    draw();
  }
  return { show, hide, setHighlight, get visible() { return !section.hidden; } };
})();
