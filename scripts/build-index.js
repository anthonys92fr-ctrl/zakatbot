// Construit data/index.json (chunks + BM25 + embeddings) et data/graph.json (Graph RAG).
// Usage : npm run index                 → tout
//         npm run index -- --no-graph   → sans le graphe (pas d'appels LLM)
//         npm run index -- --graph-only → ne reconstruit que le graphe
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadChunks } from "../lib/chunk.js";
import { buildBM25 } from "../lib/bm25.js";
import { embed, embeddingsEnabled } from "../lib/embed.js";
import { buildGraph } from "../lib/graph.js";
import { loadSettings, getSettings } from "../lib/settings.js";

loadSettings();

const DOCS_DIR = process.env.DOCS_DIR || path.resolve("docs");
const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const args = new Set(process.argv.slice(2));
const withGraph = !args.has("--no-graph");
const graphOnly = args.has("--graph-only");
const GRAPH_MAX = Number(process.env.GRAPH_MAX_CHUNKS || 150);

fs.mkdirSync(DATA_DIR, { recursive: true });

const { chunks, docs } = await loadChunks(DOCS_DIR, {
  size: Number(process.env.CHUNK_SIZE || 1200),
  pdfSize: Number(process.env.PDF_CHUNK_SIZE || 1800),
  overlap: Number(process.env.CHUNK_OVERLAP || 200),
});
if (chunks.length === 0) {
  console.error(`Aucun document dans ${DOCS_DIR}. Ajoute des fichiers .md, .txt ou .pdf puis relance.`);
  process.exit(1);
}
console.log(`${chunks.length} chunks issus de ${docs.length} document(s) :`);
for (const d of docs) console.log(`  - ${d.source} (${d.type}${d.pages ? `, ${d.pages} p.` : ""}, ${d.chunks} chunks)`);

if (!graphOnly) {
  const bm25 = buildBM25(chunks);
  let vectors = null;
  if (embeddingsEnabled) {
    console.log("Calcul des embeddings (premier lancement : téléchargement du modèle)…");
    try {
      vectors = [];
      for (let i = 0; i < chunks.length; i++) {
        const [v] = await embed([chunks[i].content.slice(0, 2000)]);
        vectors.push(v);
        if ((i + 1) % 25 === 0 || i + 1 === chunks.length) process.stdout.write(`  ${i + 1}/${chunks.length}\r`);
      }
      console.log("");
    } catch (err) {
      console.warn("Embeddings ignorés :", err.message);
      vectors = null;
    }
  }
  fs.writeFileSync(path.join(DATA_DIR, "index.json"), JSON.stringify({ chunks, docs, bm25, vectors, builtAt: new Date().toISOString() }));
  console.log(`index.json écrit (${vectors ? "BM25 + vecteurs" : "BM25 seul"}).`);
}

if (withGraph) {
  const llm = getSettings();
  if (!llm.llmBaseUrl || !llm.llmModel || (!llm.llmApiKey && !/localhost|127\.0\.0\.1/.test(llm.llmBaseUrl))) {
    console.error("LLM non configuré pour construire le graphe : admin → Réglages → Modèle de langage, ou LLM_BASE_URL / LLM_MODEL / LLM_API_KEY dans .env ; sinon utilise --no-graph.");
    process.exit(1);
  }
  console.log(`LLM : ${llm.llmModel} via ${llm.llmBaseUrl}`);
  // Sélection équilibrée : tous les chunks des .md, puis un échantillon régulier des PDF jusqu'à GRAPH_MAX
  const mdChunks = chunks.filter((c) => !c.source.toLowerCase().endsWith(".pdf"));
  const pdfChunks = chunks.filter((c) => c.source.toLowerCase().endsWith(".pdf"));
  const room = Math.max(GRAPH_MAX - mdChunks.length, 0);
  const step = pdfChunks.length > room && room > 0 ? pdfChunks.length / room : 1;
  const sampled = room > 0 ? Array.from({ length: Math.min(room, pdfChunks.length) }, (_, i) => pdfChunks[Math.floor(i * step)]) : [];
  const selected = [...mdChunks, ...sampled];
  console.log(`Extraction du graphe via le LLM : ${selected.length} chunks (${mdChunks.length} md + ${sampled.length} pdf échantillonnés, GRAPH_MAX_CHUNKS=${GRAPH_MAX})…`);
  const graph = await buildGraph(selected, {
    effort: process.env.GRAPH_EFFORT || "low",
    concurrency: Number(process.env.GRAPH_CONCURRENCY || 4),
    onProgress: (done, total, id, info) => console.log(`  [${done}/${total}] ${id} → ${info}`),
  });
  fs.writeFileSync(path.join(DATA_DIR, "graph.json"), JSON.stringify(graph));
  console.log(`graph.json écrit : ${Object.keys(graph.nodes).length} entités, ${graph.edges.length} relations.`);
}
console.log("Terminé.");
