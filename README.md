# Terminal — poste de trading multi-courtiers

Terminal web professionnel (non officiel) : données de marché temps réel,
graphiques de niveau TradingView, carnet d'ordres, statistiques avancées,
paper trading et analyste IA — le tout **sans backend** : le navigateur parle
directement aux API officielles.

Le dépôt contient **deux postes indépendants** :

| Poste | Page | Objet |
|-------|------|-------|
| **Terminal** | `index.html` | Trading multi-courtiers : crypto (OKX), CFD (XTB), graphiques, paper trading |
| **Bullion Desk** | `positions.html` | Positionnement institutionnel sur l'or et l'argent : rapport COT de la CFTC, régime macro, agent d'analyse |

![aperçu](docs/screenshot.png)

## Courtiers / sources de données

| Source | Données | Trading | Identifiants |
|--------|---------|---------|--------------|
| **OKX** | Crypto spot temps réel (WebSocket public, repli REST auto) | Paper trading (100 000 USDT fictifs, prix réels) | Aucun |
| **XTB** | CFD Forex / indices / matières premières (xAPI) | **Réel** sur votre compte démo ou réel | N° de compte + mot de passe xStation |
| **Simulation** | Marche aléatoire locale | Paper trading | Aucun |

## Fonctionnalités

**Graphiques** — moteur [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts)
(open source, Apache-2.0), en **disposition 1 / 2 / 4 graphiques synchronisés**
(chaque cellule son instrument et son unité de temps) : chandeliers /
Heikin-Ashi / ligne, volume, EMA 20-50-200, Bollinger, VWAP session,
**SuperTrend, Ichimoku**, RSI, **Stochastique** et MACD en sous-panneaux,
échelle log, axe en heure locale, zoom/pan fluides, crosshair avec légende
OHLC, lignes de prix positions (entrée/SL/TP) et alertes. **Outils de dessin**
(horizontale, tendance, Fibonacci) persistés par instrument. Chargement
infini de l'historique. Bandeau **marché global** (cap., dominance BTC/ETH).

**Marché** — carnet d'ordres 5 niveaux avec barres de profondeur, flux des
transactions, statistiques : variation/volumes 24h, **funding rate, open
interest, prix d'index** (dérivés OKX), ATR 14, volatilité par bougie,
spread/swap/levier (CFD XTB). Recherche instantanée parmi tous les
instruments OKX.

**Trading** — ticket achat/vente au marché avec SL/TP, confirmation
systématique, notionnel affiché. Paper trading exécuté aux prix réels avec
**SL/TP déclenchés automatiquement**, historique persistant et statistiques
de portefeuille (taux de réussite, profit factor, gain/perte moyens).
En mode XTB : ordres réels sur votre compte.

**Alertes de prix** — toast + notification navigateur + ligne sur le
graphique, persistées localement.

**IA** — rapport d'analyse technique local (score composite, verdict,
niveaux pivots — fonctionne sans clé) + chat Claude avec contexte marché
complet (prix, indicateurs, carnet, funding, positions, compte) envoyé
**directement du navigateur** à l'API Anthropic. Boutons : Analyse, Risque,
Plan de trade. Clé stockée en localStorage (`KEY`).

**News** — annonces officielles OKX / flux news XTB selon la source.

## Démarrage

Site statique, aucune dépendance :

```bash
python3 -m http.server 8000   # puis http://localhost:8000
```

ou ouvrez directement la version en ligne, choisissez **OKX** et lancez —
aucun compte requis.

## Ligne de commande (`/` pour focaliser, ↑↓ historique)

| Commande | Effet |
|----------|-------|
| `BTC-USDT` / `ETH-USDT 4H` | sélectionne l'instrument (+ unité de temps) |
| `BUY 0.05` / `SELL 0.05 98000 92000` | ordre au marché (+ SL + TP) |
| `CLOSE 3` / `CLOSE ALL` | clôture une / toutes les positions |
| `ALERT BTC-USDT > 70000` | alerte de prix (`ALERT DEL 1`) |
| `ADD SOL-USDT` / `DEL SOL-USDT` | watchlist |
| `TA` / `AI question…` / `KEY` | analyse technique / chat IA / clé API |
| `BOOK` `STATS` `NEWS` `POS` `HIST` | navigation |
| `IND RSI` (EMA BB VWAP VOL RSI MACD) | indicateurs |
| `RESET PAPER` | remet le compte fictif à 100 000 |
| `HELP` | aide |

## Architecture

```
index.html              structure
css/terminal.css        thème sombre sobre (accent doré unique)
js/vendor/              TradingView Lightweight Charts™ v5 (Apache-2.0)
js/indicators.js        SMA EMA RSI MACD Bollinger ATR VWAP Heikin-Ashi + moteur TA
js/chart.js             graphique multi-panneaux (LWC v5)
js/paper.js             moteur de paper trading (SL/TP auto, stats)
js/providers/okx.js     OKX v5 public : WS temps réel + repli REST
js/providers/xtb.js     XTB xAPI : données + compte + ordres réels
js/providers/sim.js     simulation hors-ligne
js/xapi.js              client bas niveau xAPI XTB
js/ai.js                rapport TA + chat Claude (API Anthropic côté navigateur)
js/app.js               orchestration
```

---

# Bullion Desk — positionnement institutionnel Or & Argent

`positions.html` — un second poste, autonome, qui répond à une seule question :
**qui détient quoi sur l'or et l'argent, et pourquoi ?**

Il n'existe pas de flux public des positions nominatives de JPMorgan ou d'un
hedge fund donné. La source qui s'en approche le plus est le rapport
hebdomadaire **Commitments of Traders** de la CFTC : chaque mardi, toutes les
positions déclarables du COMEX sont agrégées par catégorie d'opérateur, et
publiées le vendredi. C'est la matière première de ce poste.

## Sources

| Source | Données | CORS | Accès |
|--------|---------|------|-------|
| **CFTC** (Socrata) | Rapports COT, 1986 → aujourd'hui | ✅ | direct depuis le navigateur |
| **LBMA** | Fixings or/argent quotidiens depuis 1968 | ❌ | instantané `data/prices.json` |
| **FRED** (Fed de Saint-Louis) | 16 séries macro (taux réels, dollar, crédit…) | ❌ | instantané `data/macro.json` |
| **api.gold-api.com** / OKX | Spot XAU/XAG temps réel | ✅ | direct, avec repli |
| **RSS** (Fed, BCE, presse) | Fil d'actualité | ❌ | instantané `data/news.json` |

Les sources sans CORS ne peuvent pas être lues par un navigateur depuis une page
GitHub Pages. Plutôt qu'un backend ou un proxy CORS tiers — fragile, et qui
verrait passer tout le trafic — `scripts/refresh_data.py` les récupère dans
GitHub Actions et dépose trois JSON statiques dans `data/`. Le site reste
entièrement statique ; seule leur fraîcheur dépend du cron
(`.github/workflows/market-data.yml`, deux fois par jour en semaine).

## Cohortes suivies

Le rapport **détaillé** (depuis 2006) sépare :

- **Producteurs / négociants** — mines, raffineurs, industriels. Couvrent une
  production physique : structurellement vendeurs.
- **Swap dealers** — les banques. Font le marché face aux indices et aux clients
  OTC puis se couvrent sur le COMEX ; leur short massif est le miroir mécanique
  du long des indices et des fonds, **pas** un avis baissier.
- **Managed money** — hedge funds et CTA. La cohorte directionnelle la plus
  suivie : c'est elle qui marque les extrêmes de sentiment.
- **Autres reportables** et **non déclarants** (petits porteurs).

Le rapport **historique** (depuis 1986) n'a que deux blocs — non-commerciaux et
commerciaux — mais vingt ans d'historique en plus, indispensables pour situer un
extrême dans le temps long. Les deux existent en « futures seuls » et
« futures + options ».

## Ce que le poste calcule

Un net brut ne dit rien seul. Chaque chiffre est replacé dans trois référentiels :

- **son histoire** — COT index (0 = plancher de la fenêtre, 100 = sommet),
  z-score, rang de percentile, sur 6 mois à tout l'historique ;
- **la taille du marché** — % d'open interest, net par opérateur, concentration
  des 4 et 8 plus gros, notionnel en dollars ;
- **le prix** — corrélation des variations, divergences, et un relevé
  descriptif de ce que le prix a fait après des configurations comparables.

Le **score de tension** (±100) agrège ces signaux en une lecture unique, et
affiche systématiquement ses composantes : un score qu'on ne peut pas décomposer
ne vaut rien.

## Les sept vues

| Vue | Contenu |
|-----|---------|
| **Vue d'ensemble** | Cartes de synthèse, répartition par cohorte, net contre prix, régime macro, actualité |
| **Cohortes** | Tableau complet (longs, courts, net, Δ, % OI, biais, index, z, opérateurs, notionnel) + concentration |
| **Historique** | Nets de toutes les cohortes, open interest, concentration, COT index glissant |
| **Extrêmes** | Matrice index/z/percentile, rotations à plus de 2σ, basculements du net, configurations comparables |
| **Or / Argent** | Écart de positionnement normalisé et comparaison directe des deux métaux |
| **Macro** | 16 séries FRED avec sparklines, régime, corrélations or et argent |
| **Actualité** | Fil filtrable métaux / macro |

## Agent d'analyse

L'agent reçoit à chaque question un instantané JSON (~9 Ko) de **ce qui est
affiché à l'écran** : positionnement complet, score de tension et ses
composantes, régime macro, corrélations, divergences, analogues, news. Il ne
devine rien — chaque chiffre qu'il cite se retrouve dans le panneau d'à côté.

Six analyses pré-câblées (lecture du COT, régime macro, interprétation des news,
synthèse & scénarios, cartographie du risque, arbitrage or/argent) et un champ
libre. Réponses **diffusées en flux**. L'appel part directement du navigateur
vers l'API Anthropic ; la clé reste en `localStorage` et ne transite par aucun
serveur intermédiaire. Le reste du poste fonctionne sans clé.

## Architecture

```
positions.html          structure
css/positions.css       thème partagé avec le terminal
js/cot/cftc.js          client Socrata CFTC : marchés, colonnes, cache local
js/cot/metrics.js       COT index, z-scores, percentiles, divergences, analogues
js/cot/macro.js         instantanés FRED/LBMA/news + spot temps réel + régime
js/cot/charts.js        graphiques temporels (LWC v5)
js/cot/agent.js         contexte structuré + API Anthropic en flux
js/cot/desk.js          orchestration et rendu des sept vues
scripts/refresh_data.py collecte des sources sans CORS → data/*.json
```

## Avertissements

- Projet indépendant, non affilié à OKX, XTB, TradingView, la CFTC, la LBMA ni Bloomberg.
- Le COT est **hebdomadaire et différé** : arrêté le mardi, publié le vendredi.
  Ce n'est jamais une photographie du marché en temps réel, et il ne couvre que
  les contrats à terme américains — ni l'OTC de Londres, ni les ETF, ni les
  achats de banques centrales.
- Les statistiques sur configurations comparables sont **descriptives**, sur de
  petits échantillons d'épisodes non indépendants. Ce ne sont pas des prévisions.
- Le paper trading est fictif. En mode **XTB réel**, les ordres sont réels.
- Les produits à effet de levier comportent un risque élevé de perte rapide
  en capital. Ceci n'est pas un conseil en investissement.
