# XTB Terminal — poste de trading CFD façon Bloomberg

Terminal web (non officiel) inspiré du Bloomberg Terminal, connecté à votre
compte CFD **XTB** via l'API officielle **xAPI** (`wss://ws.xtb.com`).

![aperçu](docs/screenshot.png)

## Fonctionnalités

- **Market Monitor** — watchlist temps réel (bid/ask/spread, **%chg jour**, flash haussier/baissier)
- **Graphique multi-panneaux** — chandeliers ou ligne, périodes M1 → MN,
  **SMA 20/50, bandes de Bollinger, volume, RSI 14, MACD 12/26/9**,
  **zoom molette, déplacement à la souris**, crosshair OHLC + indicateurs,
  ligne de dernier prix, mise à jour tick par tick
- **Quote Monitor** — bid/ask en gros, %chg, plus haut/bas du jour, spread
- **Positions ouvertes** — P/L en direct (flux `getProfits`), clôture en un clic
- **Historique** — trades clôturés sur 30 jours (`getTradesHistory`)
- **Alertes de prix** — `ALERT GOLD > 2700` : toast + notification navigateur, persistées localement
- **Calendrier économique** — événements macro (`getCalendar`), impact codé par couleur
- **Bandeau de compte** — balance, equity, marge, marge libre, niveau de marge, P/L ouvert
- **News** — flux d'actualités XTB en continu
- **Ticket d'ordre** — achat/vente au marché avec SL/TP et **confirmation obligatoire**
- **Ligne de commande façon Bloomberg** — `GOLD GP H4 <GO>`, `US500 DES`, `BUY EURUSD 0.1`…
  avec touches de fonction F1–F10 cliquables
- **IA intégrée** :
  - **AI ANALYST (TA)** — analyse technique automatique locale : score composite,
    verdict haussier/baissier, lecture RSI/MACD/SMA/Bollinger/momentum,
    niveaux pivots R2/R1/PIV/S1/S2 — fonctionne hors-ligne, sans clé
  - **Chat Claude** — posez vos questions (`AI quelle est la tendance ?`) : le
    contexte marché (instrument, indicateurs, positions, compte) est transmis à
    l'API Anthropic **directement depuis votre navigateur** ; la clé API est
    stockée en localStorage et n'est envoyée qu'à api.anthropic.com (`KEY <GO>`)
- **Latence serveur** affichée en continu, **mode SIMULATION** complet sans compte

## Démarrage

Aucune dépendance, aucun build : c'est un site statique.

```bash
# option 1 : ouvrir directement
xdg-open index.html          # (ou double-clic)

# option 2 : petit serveur local
python3 -m http.server 8000  # puis http://localhost:8000
```

À l'écran de connexion :

| Mode | Identifiants | Serveur |
|------|--------------|---------|
| **DÉMO** | N° de compte démo + mot de passe xStation | `wss://ws.xtb.com/demo` |
| **RÉEL** | N° de compte réel + mot de passe xStation | `wss://ws.xtb.com/real` |
| **SIMULATION** | aucun | prix simulés localement |

Vos identifiants sont envoyés **directement du navigateur aux serveurs XTB** —
aucun backend, aucun tiers. Le code est entièrement lisible dans `js/`.

## Ligne de commande (`<GO>` = Entrée, `/` pour focaliser)

| Commande | Effet |
|----------|-------|
| `EURUSD` | sélectionne l'instrument (graphe + quote + ticket) |
| `GOLD GP H4` | graphique Gold en H4 (M1 M5 M15 M30 H1 H4 D1 W1 MN) |
| `US500 DES` | fiche descriptive (contrat, levier, lots, swaps…) |
| `TA` / `GOLD TA` | analyse technique IA locale (onglet AI ANALYST) |
| `AI quelle tendance ?` | question au chat Claude (clé requise : `KEY`) |
| `IND RSI` | bascule un indicateur : SMA BB VOL RSI MACD |
| `LINE` / `CNDL` | type de graphique ligne / chandeliers |
| `ADD DE40` / `DEL DE40` | gère la watchlist |
| `ALERT GOLD > 2700` | alerte de prix (`ALERT LIST`, `ALERT DEL 1`) |
| `BUY GOLD 0.1` | achat au marché 0,10 lot (confirmation) |
| `SELL US500 0.2 5900 6100` | vente + Stop Loss + Take Profit |
| `CLOSE 123456` | clôture la position par n° d'ordre |
| `CAL` / `HIST` | calendrier économique / historique des trades |
| `POS` / `NEWS` / `ACCT` / `QM` | rafraîchit positions / news / compte / cotation |
| `HELP` | aide |

## Architecture

```
index.html         structure des panneaux
css/terminal.css   thème noir/ambre façon terminal de marché
js/xapi.js         client xAPI XTB (2 WebSockets : commandes + streaming,
                   file d'attente ≥250 ms, ping keep-alive, promesses par customTag)
js/sim.js          client simulé (même interface, marche aléatoire)
js/indicators.js   SMA/EMA/RSI/MACD/Bollinger/pivots + moteur d'analyse composite
js/chart.js        graphique multi-panneaux canvas (zoom, pan, sous-panneaux RSI/MACD)
js/ai.js           panneau IA : rapport TA + chat Claude (API Anthropic côté navigateur)
js/app.js          orchestration : panneaux, streams, commandes, ordres, alertes
```

Référence API : <http://developers.xstore.pro/documentation/>

## Avertissements

- Projet **non affilié à XTB** ni à Bloomberg L.P. « Bloomberg » n'est cité
  qu'à titre de comparaison de style.
- **Testez d'abord en DÉMO.** Les ordres passés en mode RÉEL sont de vrais
  ordres exécutés sur votre compte.
- Les CFD sont des instruments complexes et présentent un risque élevé de
  perte rapide en capital en raison de l'effet de levier. La majorité des
  comptes d'investisseurs particuliers perdent de l'argent en négociant des
  CFD. Assurez-vous de comprendre leur fonctionnement.
