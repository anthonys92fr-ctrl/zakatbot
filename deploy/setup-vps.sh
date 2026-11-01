#!/usr/bin/env bash
# Installation de ZakatBot sur un serveur Ubuntu 24.04.
# Usage, une fois connecté en SSH sur la VM :
#   curl -fsSL <url-du-script> | sudo bash      (ou)   sudo bash setup-vps.sh
# Puis : copier le projet dans /opt/beam-lab et créer /opt/beam-lab/.env
set -euo pipefail

APP_DIR=/opt/beam-lab
APP_USER=beam
DOMAIN="${DOMAIN:-}"          # vide = <ip>.sslip.io (gratuit, certificat valide) ; DOMAIN=none = IP seule auto-signée ; ou ton propre domaine
PORT="${PORT:-3000}"

echo "==> Paquets système"
apt-get update -y
apt-get install -y curl git ufw ca-certificates gnupg

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Utilisateur applicatif"
id -u $APP_USER >/dev/null 2>&1 || useradd -r -m -d $APP_DIR -s /usr/sbin/nologin $APP_USER
mkdir -p $APP_DIR && chown $APP_USER:$APP_USER $APP_DIR

echo "==> Pare-feu (ufw + règles iptables préinstallées par certaines images cloud)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
# Certaines images cloud livrent des règles iptables restrictives : on ouvre 80/443
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
apt-get install -y iptables-persistent >/dev/null 2>&1 || true
netfilter-persistent save >/dev/null 2>&1 || true

echo "==> Caddy (HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y && apt-get install -y caddy
fi
# Sans nom de domaine : on utilise <ip>.sslip.io, un nom gratuit qui pointe automatiquement vers l'IP
# (aucun achat, aucune configuration DNS) et qui permet un vrai certificat Let's Encrypt.
# DOMAIN=none force un certificat auto-signé sur l'IP brute.
PUBLIC_IP="$(curl -s -4 --max-time 5 https://api.ipify.org || curl -s -4 --max-time 5 https://ifconfig.me || true)"
if [ -z "$DOMAIN" ] && [ -n "$PUBLIC_IP" ]; then
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
  echo "    Pas de DOMAIN : utilisation de $DOMAIN (nom gratuit lié à l'IP $PUBLIC_IP, certificat valide)."
fi
if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "none" ]; then
  # Domaine (ou <ip>.sslip.io) : certificat Let's Encrypt automatique, HTTP redirigé vers HTTPS.
  # L'IP brute reste servie en HTTPS avec un certificat interne.
  cat > /etc/caddy/Caddyfile <<EOF
https://$PUBLIC_IP {
    tls internal
    encode gzip
    reverse_proxy 127.0.0.1:$PORT {
        flush_interval -1
    }
}
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:$PORT {
        flush_interval -1
    }
}
EOF
else
  # DOMAIN=none (ou IP publique introuvable) : HTTPS avec certificat interne sur l'IP, HTTP redirigé
  echo "    Certificat auto-signé sur l'IP (avertissement du navigateur à accepter)."
  cat > /etc/caddy/Caddyfile <<EOF
:80 {
    redir https://{host}{uri} permanent
}
:443 {
    tls internal
    encode gzip
    reverse_proxy 127.0.0.1:$PORT {
        flush_interval -1
    }
}
EOF
fi
systemctl enable --now caddy
systemctl reload caddy || true

echo "==> Service systemd"
cat > /etc/systemd/system/beam-lab.service <<EOF
[Unit]
Description=Beam Lab chatbot
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
# Limite mémoire utile sur la micro VM (1 Go)
MemoryMax=700M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable beam-lab

echo "==> Fichier .env (créé s'il manque, avec un mot de passe admin généré et TRUST_PROXY=1)"
if [ ! -f $APP_DIR/.env ]; then
  ADMIN_PW="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | cut -c1-24)"   # (pas de SIGPIPE avec pipefail)
  cat > $APP_DIR/.env <<ENV
PORT=$PORT
TRUST_PROXY=1
ADMIN_PASSWORD=$ADMIN_PW
# Mot de passe demandé aux visiteurs du chatbot (vide = accès libre) ; modifiable ensuite dans l'admin
ACCESS_PASSWORD=
LLM_BASE_URL=
LLM_MODEL=
LLM_API_KEY=
LLM_REASONING=off
EMBEDDINGS=on
ENV
  chown $APP_USER:$APP_USER $APP_DIR/.env && chmod 600 $APP_DIR/.env
  echo "    Mot de passe admin généré : $ADMIN_PW   (dans $APP_DIR/.env)"
else
  grep -q '^TRUST_PROXY=' $APP_DIR/.env || echo "TRUST_PROXY=1" >> $APP_DIR/.env
  grep -q '^ADMIN_PASSWORD=.\+' $APP_DIR/.env || echo "!! ADMIN_PASSWORD vide dans $APP_DIR/.env : l'admin restera fermé derrière Caddy"
fi

cat <<EOF

Installation terminée.
Étapes suivantes :
  1. Copier le projet :  depuis ton PC,  deploy/push.sh <ip> ou rsync -av --exclude node_modules ./ ubuntu@<ip>:/tmp/beam-lab
  2. Sur la VM :        sudo rsync -a /tmp/beam-lab/ $APP_DIR/ && sudo chown -R $APP_USER:$APP_USER $APP_DIR
  3. Compléter $APP_DIR/.env (modèle de langage : LLM_BASE_URL / LLM_MODEL / LLM_API_KEY, ou via l'admin)
  4. cd $APP_DIR && sudo -u $APP_USER npm ci --omit=dev && sudo -u $APP_USER npm run index
  5. sudo systemctl restart beam-lab && sudo journalctl -u beam-lab -f
Le site répond sur https://$DOMAIN (certificat valide, sans nom de domaine à acheter) et sur https://<ip> (certificat interne).
EOF
