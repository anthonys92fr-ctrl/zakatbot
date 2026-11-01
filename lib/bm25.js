// BM25 lexical, sans dépendance, avec index inversé (terme -> postings). Tokenisation simple FR/EN.

const STOP = new Set(
  "le la les un une des du de et ou à au aux en dans par pour sur avec sans ce cet cette ces se sa son ses que qui quoi dont où est sont a ont été être avoir il elle ils elles on nous vous je tu y ne pas plus moins très the a an and or of to in on for with is are was were be been by it its this that these those as at from".split(" "),
);
const MAX_QUERY_TERMS = 64;

export function tokenize(text) {
  return String(text)
    .slice(0, 100000)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Construit l'index : longueurs des documents, fréquences documentaires et postings (terme -> [[doc, tf], …]). */
export function buildBM25(chunks) {
  const lengths = new Array(chunks.length);
  const postings = {};
  chunks.forEach((c, i) => {
    const toks = tokenize(c.content);
    lengths[i] = toks.length;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, f] of tf) (postings[t] ||= []).push([i, f]);
  });
  const avgdl = lengths.reduce((s, l) => s + l, 0) / Math.max(lengths.length, 1);
  return { lengths, postings, avgdl, n: chunks.length };
}

/** Compatibilité avec les index construits avant l'index inversé (champ `docs` = tokens par document). */
function ensurePostings(index) {
  if (index.postings || !index.docs) return index;
  const postings = {};
  const lengths = index.docs.map((toks, i) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, f] of tf) (postings[t] ||= []).push([i, f]);
    return toks.length;
  });
  index.postings = postings; index.lengths = lengths; delete index.docs;
  return index;
}

export function searchBM25(index, query, k = 5, { k1 = 1.5, b = 0.75 } = {}) {
  ensurePostings(index);
  const terms = [...new Set(tokenize(query))].slice(0, MAX_QUERY_TERMS);
  const scores = new Map();
  for (const term of terms) {
    const plist = index.postings[term];
    if (!plist) continue;
    const idf = Math.log(1 + (index.n - plist.length + 0.5) / (plist.length + 0.5));
    for (const [i, tf] of plist) {
      const dl = index.lengths[i] || 0;
      scores.set(i, (scores.get(i) || 0) + idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl) / index.avgdl)));
    }
  }
  return [...scores].map(([i, score]) => ({ i, score })).sort((a, c) => c.score - a.score).slice(0, k);
}
