// Graph RAG : extraction d'entités/relations par le LLM à l'indexation,
// puis expansion de voisinage à la requête.
import { complete } from "./llm.js";
import { tokenize } from "./bm25.js";

const EXTRACT_PROMPT = `Tu es un extracteur de graphe de connaissances. À partir du texte fourni, extrais :
- les entités importantes (personnes, organisations, produits, lieux, concepts, dates clés)
- les relations entre ces entités

Réponds UNIQUEMENT en JSON valide, sans commentaire, au format :
{"entities":[{"name":"...","type":"...","description":"..."}],
 "relations":[{"source":"...","target":"...","relation":"...","description":"..."}]}

Règles : noms d'entités courts et canoniques (même orthographe partout), 3 à 12 entités, relations en verbe court ("dirige", "fabrique", "situé à").`;

function norm(name) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Construit le graphe à partir des chunks. Appelle le LLM une fois par chunk, avec `concurrency` appels en parallèle. */
export async function buildGraph(chunks, { effort = "low", onProgress, concurrency = 4 } = {}) {
  const nodes = new Map(); // key -> {name,type,description,chunks:Set}
  const edges = new Map(); // key -> {source,target,relation,description,chunks:Set}

  async function extract(c) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text } = await complete(
          [{ role: "system", content: EXTRACT_PROMPT }, { role: "user", content: c.content }],
          { effort, maxTokens: 1500 },
        );
        const data = parseJson(text);
        if (data) return data;
      } catch (err) {
        console.warn(`  extraction ${c.id} tentative ${attempt + 1} :`, err.message);
      }
    }
    return null;
  }

  // Extraction en parallèle (ordre d'intégration conservé pour un graphe déterministe)
  const results = new Array(chunks.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
    while (next < chunks.length) {
      const i = next++;
      results[i] = await extract(chunks[i]);
      done++;
      const d = results[i];
      onProgress?.(done, chunks.length, chunks[i].id, d ? `${d.entities?.length || 0} entités, ${d.relations?.length || 0} relations` : "échec");
    }
  }));

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const data = results[i];
    if (!data) continue;

    for (const e of data.entities || []) {
      if (!e?.name) continue;
      const key = norm(e.name);
      const node = nodes.get(key) || { name: e.name.trim(), type: e.type || "", description: "", chunks: new Set() };
      if (e.description && e.description.length > node.description.length) node.description = e.description;
      node.chunks.add(c.id);
      nodes.set(key, node);
    }
    for (const r of data.relations || []) {
      if (!r?.source || !r?.target) continue;
      const s = norm(r.source), t = norm(r.target);
      for (const k of [s, t]) {
        if (!nodes.has(k)) nodes.set(k, { name: k === s ? r.source.trim() : r.target.trim(), type: "", description: "", chunks: new Set([c.id]) });
        else nodes.get(k).chunks.add(c.id);
      }
      const key = `${s}|${r.relation || ""}|${t}`;
      const edge = edges.get(key) || { source: s, target: t, relation: r.relation || "lié à", description: r.description || "", chunks: new Set() };
      edge.chunks.add(c.id);
      edges.set(key, edge);
    }
  }

  return {
    nodes: Object.fromEntries([...nodes].map(([k, n]) => [k, { ...n, chunks: [...n.chunks] }])),
    edges: [...edges.values()].map((e) => ({ ...e, chunks: [...e.chunks] })),
  };
}

/**
 * Trouve les entités du graphe mentionnées dans la question (matching lexical),
 * puis étend aux voisins sur `hops` sauts. Retourne entités, relations et ids de chunks.
 */
export function queryGraph(graph, question, { hops = 1, maxEntities = 12 } = {}) {
  const qn = norm(question);
  const qTokens = new Set(tokenize(question));
  const keys = Object.keys(graph.nodes);

  // 1. entités directement mentionnées
  let seeds = keys.filter((k) => k.length > 2 && qn.includes(k));
  if (seeds.length === 0) {
    // repli : entités partageant au moins un token significatif avec la question
    seeds = keys.filter((k) => tokenize(k).some((t) => qTokens.has(t)));
  }
  seeds = seeds.sort((a, b) => b.length - a.length).slice(0, maxEntities);

  // 2. expansion
  const visited = new Set(seeds);
  let frontier = new Set(seeds);
  const relations = [];
  for (let h = 0; h < hops; h++) {
    const next = new Set();
    for (const e of graph.edges) {
      if (frontier.has(e.source) || frontier.has(e.target)) {
        relations.push(e);
        for (const k of [e.source, e.target]) if (!visited.has(k)) { visited.add(k); next.add(k); }
      }
    }
    frontier = next;
  }

  const entities = [...visited].slice(0, maxEntities * 2).map((k) => ({ key: k, ...graph.nodes[k] })).filter((n) => n.name);
  const chunkIds = new Set();
  for (const n of entities) for (const c of n.chunks || []) chunkIds.add(c);
  for (const r of relations) for (const c of r.chunks || []) chunkIds.add(c);

  const uniqRel = [...new Map(relations.map((r) => [`${r.source}|${r.relation}|${r.target}`, r])).values()].slice(0, 30);
  return { seeds, entities, relations: uniqRel, chunkIds: [...chunkIds] };
}

export function describeGraph(graph, entities, relations) {
  const lines = [];
  if (entities.length) {
    lines.push("Entités :");
    for (const e of entities) lines.push(`- ${e.name}${e.type ? ` (${e.type})` : ""}${e.description ? ` : ${e.description}` : ""}`);
  }
  if (relations.length) {
    lines.push("", "Relations :");
    for (const r of relations) {
      const s = graph.nodes[r.source]?.name || r.source, t = graph.nodes[r.target]?.name || r.target;
      lines.push(`- ${s} —[${r.relation}]→ ${t}${r.description ? ` (${r.description})` : ""}`);
    }
  }
  return lines.join("\n");
}
