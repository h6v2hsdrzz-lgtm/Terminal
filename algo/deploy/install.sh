#!/usr/bin/env bash
# Installe le bot goldsilver comme service systemd sur un VPS Ubuntu/Debian.
# À lancer depuis le dossier algo/ du dépôt cloné :
#     sudo bash deploy/install.sh
# Idempotent : peut être relancé (met à jour venv + service).
set -euo pipefail

ALGO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
VENV="$ALGO_DIR/.venv"
PY="$VENV/bin/python"

echo "== goldsilver live — installation VPS =="
echo "  dossier     : $ALGO_DIR"
echo "  utilisateur : $RUN_USER"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERREUR : lance avec sudo (installation d'un service systemd)." >&2
  exit 1
fi

# 1) dépendances système
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y python3 python3-venv python3-pip >/dev/null
fi

# 2) environnement virtuel + package (en tant qu'utilisateur non-root)
sudo -u "$RUN_USER" python3 -m venv "$VENV"
sudo -u "$RUN_USER" "$VENV/bin/pip" install --quiet --upgrade pip
sudo -u "$RUN_USER" "$VENV/bin/pip" install --quiet -e "$ALGO_DIR"

# 3) contrôle du .env (secrets — jamais committé, à créer par l'utilisateur)
if [ ! -f "$ALGO_DIR/.env" ]; then
  echo ""
  echo "⚠️  $ALGO_DIR/.env ABSENT."
  echo "    Crée-le AVANT de démarrer :  cp .env.example .env  puis remplis"
  echo "    IG_API_KEY / IG_IDENTIFIER / IG_PASSWORD / IG_ENV=demo / IG_ACCOUNT_ID"
  echo ""
fi
# protège les secrets
[ -f "$ALGO_DIR/.env" ] && chmod 600 "$ALGO_DIR/.env" && chown "$RUN_USER" "$ALGO_DIR/.env"

# 4) génère et installe le service systemd avec les bons chemins
cat > /etc/systemd/system/goldsilver-live.service <<UNIT
[Unit]
Description=goldsilver live trading bot (XAU/XAG breakout 4h)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$ALGO_DIR
EnvironmentFile=$ALGO_DIR/.env
ExecStart=$PY -m goldsilver.live run
Restart=always
RestartSec=30
StartLimitIntervalSec=0

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable goldsilver-live >/dev/null 2>&1 || true

echo "✅ Service installé et activé au démarrage."
echo ""
echo "  Démarrer   : sudo systemctl start goldsilver-live"
echo "  État       : systemctl status goldsilver-live"
echo "  Logs live  : journalctl -u goldsilver-live -f"
echo "  Journal    : tail -f $ALGO_DIR/live_state/journal.jsonl"
echo "  Rapport    : $PY -m goldsilver.live report   (depuis $ALGO_DIR)"
echo "  STOP d'urgence : touch $ALGO_DIR/KILL   (ou sudo systemctl stop goldsilver-live)"
