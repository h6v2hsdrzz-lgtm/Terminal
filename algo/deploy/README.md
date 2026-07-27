# Déploiement VPS — bot goldsilver en continu (démo puis réel)

Objectif : faire tourner le bot **24/7** sur une petite machine toujours
allumée, avec redémarrage automatique. Compter ~10 minutes.

## 1. Prendre un VPS (le moins cher suffit)

Le bot est ultra-léger (un cycle toutes les 4h). N'importe quel petit VPS
**Ubuntu 22.04 / 24.04** fait l'affaire :

| Fournisseur | Offre | Prix indicatif |
|---|---|---|
| Hetzner | CX22 (2 vCPU / 4 Go) | ~4 €/mois |
| DigitalOcean | Basic droplet | ~6 $/mois |
| Vultr / Contabo / OVH | équivalent | 4-6 €/mois |

Choisis Ubuntu, récupère l'IP et le mot de passe root (ou ta clé SSH).

## 2. Se connecter et déployer

```bash
ssh root@TON_IP

# récupérer le code (dépôt privé : utilise un token GitHub ou une clé de déploiement)
git clone https://TON_TOKEN@github.com/h6v2hsdrzz-lgtm/terminal.git /opt/goldsilver
#   (alternative sans token : scp -r le dossier algo/ depuis ta machine)

cd /opt/goldsilver/algo

# créer le .env avec tes identifiants IG démo (JAMAIS committé)
cp .env.example .env
nano .env      # remplis IG_API_KEY, IG_IDENTIFIER, IG_PASSWORD, IG_ENV=demo, IG_ACCOUNT_ID=Z5MVJV

# installer + activer le service systemd
sudo bash deploy/install.sh
sudo systemctl start goldsilver-live
```

C'est tout. Le bot tourne, survit aux reboots et se relance seul en cas de crash.

## 3. Surveiller

```bash
systemctl status goldsilver-live          # actif ? depuis quand ?
journalctl -u goldsilver-live -f          # logs en direct (chaque cycle 4h)
tail -f /opt/goldsilver/algo/live_state/journal.jsonl   # décisions/ordres
cd /opt/goldsilver/algo && .venv/bin/python -m goldsilver.live report   # perf vs backtest
```

## 4. Piloter

| Action | Commande |
|---|---|
| Arrêt d'urgence (flatten + halte) | `touch /opt/goldsilver/algo/KILL` |
| Arrêter le service | `sudo systemctl stop goldsilver-live` |
| Reprendre après un KILL | `rm KILL && .venv/bin/python -m goldsilver.live reset-halt && sudo systemctl restart goldsilver-live` |
| Baisser le risque à 2 % | éditer `config/live.yaml` (`risk_pct: 0.02`) puis `systemctl restart` |
| Passer démo → réel | `IG_ENV=live` dans `.env` + `mode: live` + les 3 verrous (voir README principal) |

## 5. Mettre à jour le code

```bash
cd /opt/goldsilver && git pull
cd algo && .venv/bin/pip install -e . && sudo systemctl restart goldsilver-live
```

## Notes

- **Secrets** : le `.env` reste sur le VPS, en `chmod 600`, jamais dans git.
- **Fuseau** : le bot raisonne en UTC (bornes de bougies 4h). Peu importe le
  fuseau du VPS.
- **Quota données IG** : les bougies sont mises en cache dans `live_state/cache/`,
  la consommation reste sous le quota hebdomadaire même en tournant en continu.
- **Telegram** (optionnel) : renseigne `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
  dans le `.env` pour recevoir ouvertures/fermetures/kill switches sur ton tél.
- **Risque** : `config/live.yaml` est à **4 %/trade** (drawdown backtest ~67 %).
  Les kill switches (-20 % DD, -5 %/jour) restent le filet de sécurité.
