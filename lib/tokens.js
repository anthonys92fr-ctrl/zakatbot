// Jetons temporaires (en mémoire) pour les accès qui ne peuvent pas porter d'en-tête :
// liens de fichiers et flux SSE. Évite de mettre un mot de passe dans une URL.
// Un magasin par portée (pas d'éviction croisée), hachage SHA-256, taille plafonnée.
import crypto from "node:crypto";

const TTL_MS = 15 * 60 * 1000;
const MAX_PER_SCOPE = 1000;
const stores = new Map(); // scope -> Map(sha256(token) -> exp)
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const storeFor = (scope) => { if (!stores.has(scope)) stores.set(scope, new Map()); return stores.get(scope); };

function sweep(store) {
  const now = Date.now();
  for (const [h, exp] of store) if (exp < now) store.delete(h);
  while (store.size >= MAX_PER_SCOPE) store.delete(store.keys().next().value); // éviction du plus ancien de la même portée
}

export function issueToken(scope) {
  const store = storeFor(scope);
  sweep(store);
  const token = crypto.randomBytes(24).toString("base64url");
  store.set(hash(token), Date.now() + TTL_MS);
  return { token, expiresIn: TTL_MS / 1000 };
}

export function checkToken(token, scope) {
  if (typeof token !== "string" || token.length < 16 || token.length > 64) return false;
  const store = stores.get(scope);
  if (!store) return false;
  const h = hash(token);
  const exp = store.get(h);
  if (!exp) return false;
  if (exp < Date.now()) { store.delete(h); return false; }
  return true;
}
