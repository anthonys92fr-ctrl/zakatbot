# Politique de sécurité

## Signaler une vulnérabilité
Ouvre un **rapport privé** via l'onglet *Security → Report a vulnerability* du dépôt GitHub (ne pas créer d'issue publique). Merci d'indiquer la version, les étapes de reproduction et l'impact estimé. Un accusé de réception est donné sous 7 jours.

## Périmètre
- Serveur Node.js (`server.js`, `routes/`, `lib/`), interface web (`public/`), scripts de déploiement (`deploy/`).
- Hors périmètre : les fournisseurs de modèles de langage tiers, les documents de la base de connaissances fournis par l'exploitant.

## Mesures en place
- Aucun secret dans le dépôt : clés et réglages dans `.env` et `data/settings.json` (ignorés par git) ; la clé API n'est jamais renvoyée en clair.
- Administration protégée par mot de passe (`ADMIN_PASSWORD`, comparaison à temps constant), limiteurs de débit, jetons temporaires à portée restreinte pour les liens de fichiers.
- Anti-SSRF sur l'appel au fournisseur de modèle (adresses privées refusées sauf `ALLOW_PRIVATE_LLM=1`), aucune redirection suivie.
- En-têtes de sécurité (CSP, nosniff, frame-ancestors none, Referrer-Policy, HSTS derrière HTTPS), entrées plafonnées, chemins de fichiers contrôlés.
- Dépendances surveillées par Dependabot ; `npm audit` sans vulnérabilité connue à la date de publication.

## Versions prises en charge
La branche `main` uniquement.
