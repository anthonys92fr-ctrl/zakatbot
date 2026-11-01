// Embeddings locaux (CPU) via transformers.js. Optionnel : EMBEDDINGS=off pour désactiver.
// Modèle multilingue léger (~120 Mo téléchargés au premier lancement, mis en cache).

const ENABLED = (process.env.EMBEDDINGS || "on").toLowerCase() !== "off";
const MODEL_ID = process.env.EMBEDDING_MODEL || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      return pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    })();
  }
  return extractorPromise;
}

export const embeddingsEnabled = ENABLED;

export async function embed(texts) {
  if (!ENABLED) return null;
  const extractor = await getExtractor();
  const out = [];
  for (const t of texts) {
    const r = await extractor(t, { pooling: "mean", normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // vecteurs déjà normalisés
}

export function searchVectors(vectors, queryVec, k = 5) {
  return vectors
    .map((v, i) => ({ i, score: cosine(v, queryVec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
