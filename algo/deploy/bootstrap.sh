#!/usr/bin/env bash
# Déploiement VPS en UNE commande. Aucune valeur secrète n'est stockée dans
# ce fichier : tout passe par des variables d'environnement que tu définis
# avant de lancer. Exemple :
#
#   export GITHUB_TOKEN=ghp_xxx        # token GitHub (scope repo)
#   export IG_API_KEY=7d2e...a6b
#   export IG_IDENTIFIER=algoclaude
#   export IG_PASSWORD=ton_mot_de_passe
#   export IG_ACCOUNT_ID=Z5MVJV
#   curl -fsSL https://raw.githubusercontent.com/... /bootstrap.sh | bash
#   (ou colle ce script entier dans le terminal du VPS)
#
# Idempotent : re-lançable. Cible Ubuntu/Debian.
set -euo pipefail

GITHUB_TOKEN="${GITHUB_TOKEN:?definis GITHUB_TOKEN (token GitHub, scope repo)}"
IG_API_KEY="${IG_API_KEY:?definis IG_API_KEY}"
IG_IDENTIFIER="${IG_IDENTIFIER:?definis IG_IDENTIFIER}"
IG_PASSWORD="${IG_PASSWORD:?definis IG_PASSWORD}"
IG_ACCOUNT_ID="${IG_ACCOUNT_ID:?definis IG_ACCOUNT_ID (ex. Z5MVJV)}"
IG_ENV="${IG_ENV:-demo}"
BRANCH="${BRANCH:-claude/gold-silver-trading-algo-u9te94}"
DEST="${DEST:-/opt/goldsilver}"
OWNER_REPO="h6v2hsdrzz-lgtm/terminal"

echo "== bootstrap VPS goldsilver (env=$IG_ENV, branche=$BRANCH) =="

sudo apt-get update -qq
sudo apt-get install -y git python3 python3-venv python3-pip >/dev/null

# code
sudo rm -rf "$DEST"
sudo git clone --depth 1 -b "$BRANCH" \
  "https://${GITHUB_TOKEN}@github.com/${OWNER_REPO}.git" "$DEST"
sudo chown -R "$(id -un)" "$DEST"
cd "$DEST/algo"

# secrets locaux (jamais committés)
umask 077
cat > .env <<ENV
IG_API_KEY=${IG_API_KEY}
IG_IDENTIFIER=${IG_IDENTIFIER}
IG_PASSWORD=${IG_PASSWORD}
IG_ENV=${IG_ENV}
IG_ACCOUNT_ID=${IG_ACCOUNT_ID}
GOLDSILVER_LIVE_ACK=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ENV
chmod 600 .env

# service systemd + démarrage
sudo bash deploy/install.sh
sudo systemctl start goldsilver-live
sleep 5

echo ""
echo "===================== RÉSULTAT ====================="
systemctl is-active --quiet goldsilver-live \
  && echo "✅ goldsilver-live ACTIF — le bot tourne 24/7." \
  || { echo "❌ le service n'est pas actif, voir les logs :"; journalctl -u goldsilver-live --no-pager | tail -20; }
echo "Logs live      : journalctl -u goldsilver-live -f"
echo "Journal trades : tail -f $DEST/algo/live_state/journal.jsonl"
echo "STOP d'urgence : touch $DEST/algo/KILL"
