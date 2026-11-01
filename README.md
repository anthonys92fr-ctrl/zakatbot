# ZakatBot

Chatbot pédagogique sur la **zakat** : une page, trois moteurs côte à côte propulsés par le LLM de ton choix (toute API compatible OpenAI : OpenAI, Groq, Mistral, OpenRouter, Reflection, Ollama…, configuré dans l'admin), un **juge LLM** qui note et explique les écarts, et une **visualisation du graphe de connaissances** :

| Colonne | Approche |
|---|---|
| A · LLM seul | le modèle répond avec ses seules connaissances |
| B · RAG | recherche hybride BM25 + embeddings locaux dans `docs/`, passages injectés dans le prompt |
| C · RAG + Graph RAG | passages + sous-graphe d'entités/relations extrait par le LLM à l'indexation |

Le juge évalue exactitude, fidélité aux sources, complétude et clarté, puis rend un verdict.

## Lancer en local

```bash
npm install
copy .env.example .env        # (cp sur Linux/macOS) puis renseigner LLM_BASE_URL, LLM_MODEL, LLM_API_KEY — ou le faire dans l'admin
npm run fetch-pdfs            # optionnel : PDF de référence (droits de leurs éditeurs, non versionnés)
npm run index                 # indexe docs/ (BM25 + embeddings + graphe via le LLM)
npm start                     # http://localhost:3000  ·  admin : http://localhost:3000/admin
```

Aucun fournisseur de modèle n'est préconfiguré : choisis-le dans **Admin → Réglages → Modèle de langage** (test de connexion intégré) ou dans `.env`.

- **[Mode d'emploi](MODE-EMPLOI.md)** du site et de l'administration.
- **[Publication sur GitHub](PUBLICATION.md)** et fichiers exclus du dépôt.

- `npm run index -- --no-graph` : sans appels LLM (pas de graphe).
- `npm run index -- --graph-only` : ne reconstruit que le graphe.
- Base documentaire : 7 fiches en français dans `docs/` et 9 PDF de référence dans `docs/pdf/` (Qaradawi *Fiqh al-Zakah* vol. 1-2, guides NZF 2025/2021, guides ZATCA, leçons NewMuslims FR). Ajoute tes `.md`, `.txt` ou `.pdf` et relance l'index.
- `GRAPH_MAX_CHUNKS` (défaut 150) limite le nombre de chunks envoyés à Beam pour l'extraction du graphe.

## Variables `.env`

Voir `.env.example`. Les plus utiles : `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` / `LLM_REASONING`, `REASONING_EFFORT` (low = rapide), `TOP_K`, `EMBEDDINGS=off` pour une petite VM, `ACCESS_PASSWORD` pour protéger la page, `ADMIN_PASSWORD` pour l'administration. Les réglages faits dans l'admin sont conservés dans `data/settings.json` et priment sur `.env`. Les fournisseurs LLM sur adresse locale ou privée (Ollama) nécessitent `ALLOW_PRIVATE_LLM=1`.

## Administration (`/admin`)

Documents du RAG (dépôt, suppression), réindexation avec journal en direct, réglages à chaud (**modèle de langage** : fournisseur compatible OpenAI, URL, modèle, clé API, raisonnement natif, avec test de connexion et liste des modèles ; efforts de raisonnement, TOP_K, prompt système, mot de passe d'accès, **moteurs affichés** : A, B, C, deux à deux ou les trois, **juge LLM on/off**) et statistiques (requêtes, tokens, latences). Sans `ADMIN_PASSWORD`, l'admin n'est accessible qu'en connexion directe depuis la machine elle-même (boucle locale, sans proxy) ; derrière Caddy ou à distance, `ADMIN_PASSWORD` est obligatoire (le script `deploy/setup-vps.sh` en génère un et pose `TRUST_PROXY=1`). Les réglages sont conservés dans `data/settings.json` et priment sur `.env`.

## Déploiement sur un serveur (Ubuntu 24.04)

1. Sur le serveur : `sudo bash deploy/setup-vps.sh` (Node 22, Caddy HTTPS, pare-feu, service systemd, `.env` généré avec un mot de passe admin). **Sans nom de domaine**, le site est servi sur `https://<ip-avec-tirets>.sslip.io` (nom gratuit lié à l'IP, certificat valide) et sur `https://<ip>` ; avec ton domaine : `DOMAIN=chat.exemple.fr sudo -E bash deploy/setup-vps.sh`.
2. Depuis ton PC : `bash deploy/push.sh <ip> [utilisateur-ssh]` (clé SSH privée attendue dans `deploy/ssh_key`, ou `SSH_KEY=/chemin/vers/la/cle`).
3. Configurer le modèle de langage dans l'admin (`https://…/admin`), ajouter tes documents et lancer une réindexation.

Sur une machine modeste (1 Go de RAM), mettre `EMBEDDINGS=off` dans `.env` ou construire l'index en local et copier `data/` sur le serveur.

## API

- `POST /api/chat/:mode` (`llm` | `rag` | `graph`) `{ messages }` → flux SSE (`context`, `first`, `text`, `done`, `error`).
- `POST /api/judge` `{ question, answers:{llm,rag,graph} }` → JSON scores + analyses + verdict.
- `GET /api/graph?max=150` → nœuds (documents, entités) et liens (mentions, relations) pour la visualisation.
- `GET /api/config`, `GET /health`.
