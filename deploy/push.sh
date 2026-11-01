#!/usr/bin/env bash
# Envoie le projet sur le serveur et (re)démarre le service.
# Du dossier deploy/, seuls setup-vps.sh et fetch-pdfs.sh sont envoyés : clés et configurations locales n'en sortent jamais.
# Usage : bash deploy/push.sh <ip-du-serveur> [utilisateur-ssh=ubuntu]   (clé : deploy/ssh_key ou SSH_KEY=/chemin/cle)
set -euo pipefail
IP="${1:?ip de la VM requise}"
USER="${2:-ubuntu}"
KEY="${SSH_KEY:-$(dirname "$0")/ssh_key}"   # clé privée SSH du serveur (ou variable SSH_KEY)
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Dossier temporaire privé sur la VM (sous le dossier personnel de l'utilisateur SSH)"
STAGE="$(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$USER@$IP" 'd=$(mktemp -d "$HOME/beam-lab.XXXXXX") && chmod 700 "$d" && printf %s "$d"')"
case "$STAGE" in
  /*/beam-lab.??????) ;;
  *) echo "Chemin temporaire inattendu : $STAGE" >&2; exit 1 ;;
esac
echo "    $STAGE"

echo "==> Envoi des fichiers vers $USER@$IP"
rsync -az --delete \n  --exclude 'node_modules' --exclude '.git' --exclude '.env' --exclude 'data' --exclude '__pycache__' --exclude '*.log' --exclude '*.pem' --exclude 'journey.md' \n  --include 'deploy/' --include 'deploy/setup-vps.sh' --include 'deploy/fetch-pdfs.sh' --exclude 'deploy/*' \n  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new"   "$HERE/" "$USER@$IP:$STAGE/"

echo "==> Installation côté VM"
ssh -i "$KEY" "$USER@$IP" "bash -s -- $(printf %q "$STAGE")" <<'EOF'
set -e
STAGE="$1"
case "$STAGE" in "$HOME"/beam-lab.??????) ;; *) echo "chemin refusé : $STAGE" >&2; exit 1 ;; esac
[ -d "$STAGE" ] && [ -O "$STAGE" ] || { echo "dossier temporaire invalide" >&2; exit 1; }
sudo rsync -a --exclude '.env' "$STAGE/" /opt/beam-lab/
rm -rf "$STAGE"
sudo chown -R beam:beam /opt/beam-lab
cd /opt/beam-lab
if [ ! -f .env ]; then echo "!! /opt/beam-lab/.env manquant : crée-le à partir de .env.example"; fi
sudo -u beam npm ci --omit=dev --no-audit --no-fund
if [ -f .env ] && [ ! -f data/index.json ]; then sudo -u beam npm run index -- --no-graph || true; fi
sudo systemctl restart beam-lab
sleep 2
sudo systemctl --no-pager --lines=5 status beam-lab || true
EOF
echo "==> OK : http://$IP"
