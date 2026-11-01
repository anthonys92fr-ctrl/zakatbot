// Chargement de l'index et construction du contexte pour chaque mode.
import fs from "node:fs";
import path from "node:path";
import { searchBM25 } from "./bm25.js";
import { embed, searchVectors, embeddingsEnabled } from "./embed.js";
import { queryGraph, describeGraph } from "./graph.js";
import { cleanTitle } from "./chunk.js";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");

let index = null; // { chunks, bm25, vectors|null, graph|null, builtAt }

export function loadIndex() {
  const p = path.join(DATA_DIR, "index.json");
  if (!fs.existsSync(p)) { index = null; return null; }
  index = JSON.parse(fs.readFileSync(p, "utf8"));
  // Nettoyage des titres PDF douteux (métadonnées du type "Microsoft Word - X.doc") sans réindexer
  const fixTitle = (title, source) => cleanTitle(title, source);
  for (const c of index.chunks) c.title = fixTitle(c.title, c.source);
  for (const d of index.docs || []) d.title = fixTitle(d.title, d.source);
  const g = path.join(DATA_DIR, "graph.json");
  index.graph = fs.existsSync(g) ? JSON.parse(fs.readFileSync(g, "utf8")) : null;
  return index;
}

export function indexStatus() {
  if (!index) return { ready: false };
  return {
    ready: true,
    chunks: index.chunks.length,
    sources: [...new Set(index.chunks.map((c) => c.source))].length,
    vectors: Boolean(index.vectors),
    graph: index.graph ? { nodes: Object.keys(index.graph.nodes).length, edges: index.graph.edges.length } : null,
    builtAt: index.builtAt,
  };
}

/**
 * Graphe pour la visualisation : nœuds documents + entités, arêtes entité→document (mention)
 * et entité→entité (relation). Limité aux `maxEntities` entités les plus connectées.
 */
export function graphForViz({ maxEntities = 120 } = {}) {
  if (!index) return { nodes: [], links: [] };
  const docs = index.docs || [...new Set(index.chunks.map((c) => c.source))].map((source) => ({ source, title: index.chunks.find((c) => c.source === source)?.title || source, chunks: index.chunks.filter((c) => c.source === source).length }));
  const nodes = docs.map((d) => ({ id: `doc:${d.source}`, kind: "doc", label: d.title || d.source, source: d.source, chunks: d.chunks, pages: d.pages || null }));
  const links = [];
  if (!index.graph) return { nodes, links };

  const degree = new Map();
  for (const e of index.graph.edges) { degree.set(e.source, (degree.get(e.source) || 0) + 1); degree.set(e.target, (degree.get(e.target) || 0) + 1); }
  const entities = Object.entries(index.graph.nodes)
    .map(([key, n]) => ({ key, ...n, degree: (degree.get(key) || 0) + (n.chunks?.length || 0) * 0.5 }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, maxEntities);
  const keep = new Set(entities.map((e) => e.key));

  for (const e of entities) {
    nodes.push({ id: `ent:${e.key}`, kind: "entity", label: e.name, type: e.type || "", description: e.description || "", degree: e.degree });
    const srcs = new Set((e.chunks || []).map((cid) => cid.split("#")[0]));
    for (const s of srcs) links.push({ source: `ent:${e.key}`, target: `doc:${s}`, kind: "mention" });
  }
  for (const r of index.graph.edges) {
    if (keep.has(r.source) && keep.has(r.target) && r.source !== r.target)
      links.push({ source: `ent:${r.source}`, target: `ent:${r.target}`, kind: "relation", label: r.relation });
  }
  // documents orphelins reliés à rien : garder quand même (ils apparaissent isolés)
  return { nodes, links };
}

/** Fusion RRF (Reciprocal Rank Fusion) de plusieurs listes classées. */
function rrf(lists, k = 60) {
  const scores = new Map();
  for (const list of lists) list.forEach((r, rank) => scores.set(r.i, (scores.get(r.i) || 0) + 1 / (k + rank + 1)));
  return [...scores].map(([i, score]) => ({ i, score })).sort((a, b) => b.score - a.score);
}

/** Recherche hybride BM25 + vecteurs. */
export async function retrieve(question, k = 5) {
  if (!index) return [];
  const lists = [searchBM25(index.bm25, question, k * 2)];
  if (index.vectors && embeddingsEnabled) {
    try {
      const [qv] = await embed([question]);
      lists.push(searchVectors(index.vectors, qv, k * 2));
    } catch (err) {
      console.warn("Embeddings indisponibles à la requête :", err.message);
    }
  }
  return rrf(lists).slice(0, k).map((r) => ({ ...index.chunks[r.i], score: r.score }));
}

function formatChunks(chunks) {
  return chunks.map((c, i) => `[${i + 1}] (${c.source}) ${c.content}`).join("\n\n");
}

/** Contexte "RAG" : passages seulement. */
export async function buildRagContext(question, k = 5) {
  const chunks = await retrieve(question, k);
  return { chunks, context: formatChunks(chunks), graph: null };
}

/** Contexte "RAG + Graph RAG" : passages + sous-graphe + passages liés aux entités. */
export async function buildGraphRagContext(question, k = 5) {
  const base = await retrieve(question, k);
  if (!index?.graph) return { chunks: base, context: formatChunks(base), graph: null };

  const g = queryGraph(index.graph, question, { hops: 1 });
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const extra = g.chunkIds.map((id) => byId.get(id)).filter(Boolean).filter((c) => !base.some((b) => b.id === c.id)).slice(0, 3);
  const chunks = [...base, ...extra];
  const graphText = describeGraph(index.graph, g.entities, g.relations);
  const context = `${graphText ? `GRAPHE DE CONNAISSANCES\n${graphText}\n\n` : ""}PASSAGES\n${formatChunks(chunks)}`;
  return {
    chunks,
    context,
    graph: {
      seeds: g.seeds.map((k) => index.graph.nodes[k]?.name || k),
      entities: g.entities.map((e) => ({ name: e.name, type: e.type })),
      relations: g.relations.map((r) => ({
        source: index.graph.nodes[r.source]?.name || r.source,
        relation: r.relation,
        target: index.graph.nodes[r.target]?.name || r.target,
      })),
    },
  };
}
