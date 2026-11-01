# Publier ZakatBot sur GitHub (nouveau compte)

Le dépôt local est prêt et le premier commit est fait. Ce qui est **exclu** de la publication par `.gitignore` : `.env` (clés), `data/` (index, graphe, `settings.json` qui contient la clé API), `docs/pdf/` (PDF d'éditeurs tiers, récupérables avec `npm run fetch-pdfs`), les clés SSH et de cloud dans `deploy/`, les journaux. La version publiée ne préconfigure aucun fournisseur de modèle : chacun renseigne le sien dans l'admin ou dans `.env`.

## 1. Créer le compte et le dépôt (dans le navigateur, par toi)
1. https://github.com/signup : créer le nouveau compte, vérifier l'e-mail.
2. https://github.com/new : nom du dépôt `zakatbot`, visibilité au choix, **ne pas** cocher « Add a README » (le dépôt local en a déjà un). Créer.

## 2. Identité git pour ce dépôt (le nom qui apparaîtra sur les commits)
Dans le dossier du projet :
```bash
git config user.name "Nom affiché"
```
```bash
git config user.email "adresse@du-nouveau-compte"
```
(Sans `--global` : n'affecte que ce dépôt. GitHub propose une adresse « noreply » dans Settings → Emails si tu ne veux pas exposer la tienne.)

## 3. Pousser
Méthode A, avec l'outil GitHub CLI (recommandé) :
```bash
gh auth login
```
(choisir GitHub.com, HTTPS, se connecter dans le navigateur avec le **nouveau** compte)
```bash
gh repo create zakatbot --source=. --public --push
```
(`--private` pour un dépôt privé ; cette commande crée le dépôt et pousse, l'étape 1.2 devient inutile)

Méthode B, sans GitHub CLI :
```bash
git remote add origin https://github.com/<nouveau-compte>/zakatbot.git
```
```bash
git push -u origin main
```
Git demandera une connexion : utiliser le nouveau compte (un jeton personnel « Personal access token » tient lieu de mot de passe sur HTTPS).

## 4. Après la publication
- Vérifier sur GitHub qu'aucun fichier sensible n'apparaît (`.env`, `data/`, `deploy/oci.config`, clés).
- Dans Settings → General, renseigner la description et l'URL de démo.
- Pour les mises à jour suivantes : `git add -A`, `git commit -m "message"`, `git push`.

## Reconstruire ailleurs à partir du dépôt
```bash
git clone https://github.com/<nouveau-compte>/zakatbot.git && cd zakatbot && npm install && cp .env.example .env && npm run fetch-pdfs && npm run index -- --no-graph && npm start
```
Puis configurer le modèle de langage dans l'admin et lancer « Graphe seul » dans Réindexation.
