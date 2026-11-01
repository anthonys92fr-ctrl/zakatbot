# Déployer ZakatBot sur un serveur

ZakatBot s'installe sur n'importe quelle machine **Ubuntu 24.04** (x86-64 ou ARM64) avec 1 Go de RAM minimum (2 Go conseillés si `EMBEDDINGS=on`), 10 Go de disque, et les ports **22, 80 et 443** ouverts. Aucun nom de domaine n'est nécessaire : le site est servi sur `https://<ip>` et sur `https://<ip-avec-tirets>.sslip.io` (nom gratuit lié à l'IP, certificat Let's Encrypt valide).

Le déroulé est le même partout :

1. **Créer la machine** chez le fournisseur (sections ci-dessous), avec ta clé SSH publique, et ouvrir 80/443 dans son pare-feu réseau.
2. **Préparer le serveur** : copier `deploy/setup-vps.sh` dessus et l'exécuter en root. Il installe Node 22, Caddy (HTTPS automatique), le pare-feu local, le service systemd, et crée `/opt/beam-lab/.env` avec un mot de passe admin généré (affiché une fois).
3. **Envoyer l'application** depuis ton PC : `bash deploy/push.sh <ip> <utilisateur-ssh>` (clé privée dans `deploy/ssh_key` ou variable `SSH_KEY`).
4. **Configurer** : ouvrir `https://<ip>/admin` (ou l'adresse sslip.io), saisir le mot de passe admin, choisir le fournisseur de modèle (Réglages → Modèle de langage, bouton Tester), déposer tes documents, lancer « Tout réindexer ».

Étape 2 en détail, une fois connecté en SSH :

```bash
scp -i deploy/ssh_key deploy/setup-vps.sh <utilisateur>@<ip>:/tmp/ && ssh -i deploy/ssh_key <utilisateur>@<ip> 'sudo bash /tmp/setup-vps.sh'
```

Avec ton propre domaine pointant vers l'IP : `sudo DOMAIN=chat.exemple.fr bash /tmp/setup-vps.sh`.

---

## Oracle Cloud Free Tier

Offre gratuite permanente : jusqu'à 4 OCPU ARM / 24 Go (VM.Standard.A1.Flex) ou 2 micro-VM AMD (VM.Standard.E2.1.Micro, 1 Go), 200 Go de stockage. Les ressources gratuites ne se créent que dans la **région d'origine** choisie à l'inscription.

1. Console → Compute → Instances → **Create instance**. Image **Canonical Ubuntu 24.04** (variante *aarch64* pour ARM). Forme : A1.Flex (idéal, 2 OCPU / 12 Go suffisent) ou E2.1.Micro.
2. Networking : *Create new virtual cloud network* + *Create new public subnet*. Section **Add SSH keys** : coller ta clé publique. Utilisateur SSH : `ubuntu`.
3. Si « Out of capacity » : réessayer plus tard, changer de fault domain, ou passer le compte en Pay As You Go (les ressources Always Free restent gratuites, mais la capacité est servie en priorité).
4. Après création : instance → *Attached VNICs* → vérifier l'**IP publique** (l'assigner si absente). Puis Networking → Virtual cloud networks → ton VCN → Security Lists → *Default Security List* → **Add Ingress Rules** : source `0.0.0.0/0`, TCP, ports de destination `80` puis `443`.
5. Les images Ubuntu d'Oracle ont des règles iptables restrictives : `setup-vps.sh` ouvre 80/443 lui-même.

## OVH VPS

1. Commander un VPS (Starter ou Value, 2 Go), OS **Ubuntu 24.04**. OVH envoie l'utilisateur (`ubuntu` ou `debian`) et un mot de passe initial par e-mail.
2. Première connexion : `ssh ubuntu@<ip>`, puis ajouter ta clé publique dans `~/.ssh/authorized_keys` et désactiver le mot de passe (`PasswordAuthentication no` dans `/etc/ssh/sshd_config`, `sudo systemctl restart ssh`).
3. Pare-feu : par défaut aucun filtrage réseau chez OVH ; `setup-vps.sh` configure `ufw` (22, 80, 443). Le *Firewall Network* OVH est optionnel.
4. Suite commune (étapes 2 à 4).

## Google Cloud (Compute Engine)

Offre « Always Free » : une e2-micro (1 Go, x86) dans les régions us-west1, us-central1 ou us-east1 ; ailleurs ou plus gros, facturé.

1. Console → Compute Engine → **Create instance** : e2-micro ou e2-small, boot disk **Ubuntu 24.04 LTS**, 10 Go+.
2. Cocher *Allow HTTP traffic* et *Allow HTTPS traffic* (crée les règles de pare-feu VPC 80/443).
3. SSH : Security → *Manage access* → ajouter ta clé publique (le nom d'utilisateur est celui du commentaire de la clé), ou utiliser le bouton SSH du navigateur pour coller la clé.
4. Réserver l'IP externe en statique (VPC network → IP addresses → *Reserve*) sinon elle change au redémarrage.
5. Suite commune.

## Microsoft Azure

Offre gratuite : B1s (1 Go) 750 h/mois pendant 12 mois, puis facturé ; B2s (4 Go) conseillé.

1. Portail → Virtual machines → **Create** : image **Ubuntu Server 24.04 LTS**, taille B1s/B2s, authentification **SSH public key** (coller ta clé), utilisateur `azureuser`.
2. Onglet Networking : *Inbound ports* → cocher **SSH (22), HTTP (80), HTTPS (443)**. Public IP : SKU Standard, allocation **Static**.
3. Après création, vérifier le Network Security Group de la VM (règles entrantes 80 et 443 présentes).
4. Suite commune avec `azureuser@<ip>`.

## Amazon Web Services (EC2)

Offre gratuite 12 mois : t2.micro ou t3.micro (1 Go) ; t4g.small (ARM, 2 Go) souvent en essai gratuit.

1. Console → EC2 → **Launch instance** : AMI **Ubuntu Server 24.04 LTS**, type t3.micro (x86) ou t4g.small (ARM).
2. *Key pair* : créer ou importer ta clé publique (`.pem` téléchargé si créée là ; à placer dans `deploy/ssh_key` avec `chmod 600`).
3. *Network settings* → Security group : autoriser **SSH (22)**, **HTTP (80)**, **HTTPS (443)** depuis `0.0.0.0/0` (ou ton IP pour le 22).
4. Associer une **Elastic IP** (EC2 → Elastic IPs → Allocate → Associate) pour une adresse fixe.
5. Suite commune avec `ubuntu@<ip>`.

---

## Après l'installation

- Mot de passe admin : dans `/opt/beam-lab/.env` sur le serveur (`sudo cat /opt/beam-lab/.env`).
- Journal du service : `sudo journalctl -u beam-lab -f`. Redémarrage : `sudo systemctl restart beam-lab`.
- Mise à jour : relancer `bash deploy/push.sh <ip> <utilisateur>` depuis ton PC.
- Sauvegarde : `/opt/beam-lab/docs` (documents), `/opt/beam-lab/data` (index, réglages, clé API), `/opt/beam-lab/.env`.
- Machine à 1 Go : mettre `EMBEDDINGS=off` dans `.env` (recherche BM25 seule) ou construire l'index sur ton PC puis copier `data/` sur le serveur.
