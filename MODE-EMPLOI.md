# ZakatBot — Mode d'emploi

ZakatBot est un site de questions-réponses sur la zakat. Une même question est envoyée à un, deux ou trois « moteurs » qui répondent côte à côte, puis un juge automatique note et compare les réponses. Une page d'administration permet de gérer les documents de référence, le modèle de langage et les réglages.

## 1. Utiliser le chatbot

### Poser une question
1. Ouvre la page d'accueil (par exemple `http://localhost:3000` en local, ou l'adresse du serveur).
2. Tape ta question dans le champ en bas de page, puis **Entrée** (Maj+Entrée pour aller à la ligne). Tu peux aussi cliquer une des **questions suggérées** : elle remplit le champ, à toi de valider.
3. Les colonnes actives répondent en même temps, mot à mot. Les réponses sont en français si la question est en français.

### Lire une réponse
- **Colonne A · LLM seul** : le modèle répond avec ses seules connaissances.
- **Colonne B · LLM + RAG** : le modèle s'appuie sur des passages extraits des documents de référence. Les passages utilisés sont listés au-dessus de la réponse ([1], [2]…) et cités dans le texte.
- **Colonne C · LLM + RAG + Graph RAG** : comme B, plus un graphe d'entités et de relations (personnes, concepts, écoles juridiques…) qui aide à relier plusieurs documents. Les entités et relations mobilisées apparaissent sous forme de pastilles.
- **Sources cliquables** : chaque pastille de source et chaque citation [n] ouvre le fichier d'origine (PDF affiché dans le navigateur, fiche en texte).
- **Métriques** dans l'en-tête de chaque colonne : temps de recherche, temps jusqu'au premier mot, durée totale, **tokens** consommés (détail prompt / réponse / raisonnement sous la réponse).

### Le juge LLM
Si le juge est activé, une section **Juge LLM** apparaît sous les colonnes après chaque question : note sur 10 pour chaque réponse selon quatre critères (exactitude, fidélité aux sources, complétude, clarté), analyse de ce qui s'est passé, verdict et gagnant. La bascule **Juge auto** en bas de page permet de ne pas lancer le juge pour une question donnée.

### Graphe de connaissances
Le bouton **Graphe** (en haut) affiche, en bas de page, la carte des documents (carrés) et des entités (ronds) reliés par les mentions et relations. Survole un nœud pour le détail, molette pour zoomer, glisser pour déplacer, double-clic pour recentrer, champ de recherche pour filtrer. Les entités utilisées par la dernière réponse C sont surlignées en or.

### Conversation
- Chaque colonne garde le fil de la conversation : tu peux poser une question de suite (« et pour l'argent ? »).
- **Effacer** (en haut) vide les trois colonnes. L'historique est conservé dans ton navigateur uniquement.
- Si le site est protégé par un mot de passe d'accès, il est demandé à l'ouverture et retenu pour la durée de l'onglet.

### Limites
Le chatbot donne une information générale et pédagogique ; il ne remplace pas l'avis d'un savant ou d'un organisme compétent pour une situation personnelle. Les montants (nisab, zakat al-fitr) changent chaque année : vérifie auprès d'une source à jour.

## 2. Administrer le site

Ouvre **/admin** (bouton **Admin** en haut du chatbot). Sans mot de passe admin défini, la page n'est accessible qu'en connexion directe depuis l'ordinateur qui héberge le serveur (jamais derrière un proxy ni à distance) ; avec `ADMIN_PASSWORD` dans `.env`, elle demande le mot de passe (retenu pour la durée de l'onglet). Sur un serveur, le mot de passe est obligatoire.

### Onglet Documents
- **Ajouter des fichiers** : glisse des fichiers `.md`, `.txt` ou `.pdf` (40 Mo max chacun) dans la zone, ou clique pour choisir. Le champ « sous-dossier » range les fichiers dans un dossier de `docs/`.
- **Coller un texte** : déplie « Ou coller un texte comme nouveau document », donne un nom et colle le contenu (Markdown ou texte).
- **Tableau** : type, taille, pages (PDF), nombre de chunks, état d'indexation, date. Le titre et **Ouvrir** affichent le fichier, **↓** le télécharge, **Supprimer** le retire.
- Un badge **index à reconstruire** apparaît dès qu'un fichier est ajouté, modifié ou supprimé depuis la dernière indexation : passe par l'onglet Réindexation.

### Onglet Réindexation
- **Tout réindexer** : reconstruit l'index de recherche (BM25 + embeddings) et le graphe de connaissances (appels au modèle de langage, quelques minutes, consomme des tokens).
- **Index seul** : sans appels au modèle, rapide, pas de graphe mis à jour.
- **Graphe seul** : ne reconstruit que le graphe.
- Le journal s'affiche en direct ; **Annuler** interrompt. À la fin, le serveur recharge l'index automatiquement, sans redémarrage.

### Onglet Réglages
Tous les réglages s'appliquent immédiatement et sont conservés dans `data/settings.json` (ils priment sur `.env`).
- **Modèle de langage** : fournisseur (préréglages OpenAI, Groq, Mistral, OpenRouter, Reflection Beam, Ollama local, ou autre API compatible OpenAI), URL de base, modèle (lien « Charger la liste des modèles »), clé API (laisser vide pour conserver l'actuelle), interrupteur **Raisonnement natif** (seulement si le fournisseur gère `reasoning_effort`). **Tester la connexion** vérifie les valeurs saisies avant d'enregistrer.
- **Juge LLM** : interrupteur. Éteint, le juge disparaît du chatbot et aucun token n'est dépensé pour le jugement.
- **Efforts de raisonnement** (chat et juge), **passages récupérés** (TOP_K), **longueur max de réponse**, **messages d'historique**, **chunks envoyés au modèle pour le graphe**.
- **Moteurs affichés** : cartes radio pour choisir A, B, C, deux à deux ou les trois. Seules les colonnes choisies sont interrogées et jugées.
- **Mot de passe d'accès au chatbot** : vide = accès libre.
- **Prompt système** : personnalité et consignes du bot.
- **Revenir aux valeurs du .env** restaure les valeurs de départ.

### Onglet Statistiques
Depuis le dernier démarrage : requêtes, tokens (dont raisonnement), erreurs, mémoire, puis le détail par moteur et pour le juge (latence moyenne), et les dernières questions posées.

## 3. Installer et lancer

```bash
npm install
copy .env.example .env      # Windows (cp sur Linux/macOS) ; renseigner LLM_* ou le faire ensuite dans l'admin
npm run fetch-pdfs          # optionnel : PDF de référence sur la zakat (droits de leurs éditeurs, non versionnés)
npm run index               # construit l'index et le graphe (ou npm run index -- --no-graph sans appels LLM)
npm start                   # http://localhost:3000
```

Variables utiles dans `.env` : `PORT`, `ADMIN_PASSWORD`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_REASONING`, `ALLOW_PRIVATE_LLM=1` (fournisseur local comme Ollama), `EMBEDDINGS=off` (machine modeste), `DEFAULT_MODES`, `JUDGE_ENABLED`, `TRUST_PROXY=1` (derrière Caddy). Le déploiement sur un serveur Ubuntu est décrit dans le README (`deploy/setup-vps.sh`, `deploy/push.sh`).

## 4. Questions fréquentes
- **« LLM non configuré »** dans l'en-tête : aucun fournisseur n'est renseigné. Admin → Réglages → Modèle de langage, puis Tester et Enregistrer.
- **« Clé API refusée »** : la clé est fausse, expirée ou ne correspond pas au fournisseur choisi.
- **Les colonnes ne répondent plus à la deuxième question** : recharge la page (Ctrl+F5) ; si le problème persiste, désactive « Raisonnement natif » pour un fournisseur qui ne le gère pas.
- **Les sources ne correspondent pas à mes documents** : lance une réindexation après avoir ajouté ou modifié des fichiers.
- **Réponses lentes** : baisse l'effort de raisonnement (low) et le nombre de passages, ou désactive le juge.
