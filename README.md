# Bullion Desk — positionnement institutionnel Or & Argent

Poste web qui répond à une seule question : **qui détient quoi sur l'or et
l'argent, et pourquoi ?**

Il n'existe pas de flux public des positions nominatives de telle banque ou de
tel hedge fund — ce n'est pas publié. La source qui s'en approche le plus est le
rapport hebdomadaire **Commitments of Traders** de la CFTC : chaque mardi, toutes
les positions déclarables du COMEX sont agrégées par catégorie d'opérateur et
publiées le vendredi. C'est la matière première de ce poste.

**Sans backend.** Le navigateur interroge directement les API publiques ; les
sources qui n'autorisent pas le CORS sont déposées en instantanés statiques par
GitHub Actions.

## Démarrage

```bash
python3 -m http.server 8000   # puis http://localhost:8000
```

Aucune installation, aucun compte. Une clé API Anthropic est nécessaire
uniquement pour l'agent d'analyse ; les sept vues fonctionnent sans.

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

Sept marchés : or, argent, micro or, micro argent, platine, palladium, cuivre.

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
serveur intermédiaire.

## Architecture

```
index.html              structure
css/positions.css       thème sombre, accent doré
js/vendor/              TradingView Lightweight Charts™ v5 (Apache-2.0)
js/cot/cftc.js          client Socrata CFTC : marchés, colonnes, cache local
js/cot/metrics.js       COT index, z-scores, percentiles, divergences, analogues
js/cot/macro.js         instantanés FRED/LBMA/news + spot temps réel + régime
js/cot/charts.js        graphiques temporels (LWC v5)
js/cot/agent.js         contexte structuré + API Anthropic en flux
js/cot/desk.js          orchestration et rendu des sept vues
scripts/refresh_data.py collecte des sources sans CORS → data/*.json
```

Le dossier `algo/` contient un paquet Python indépendant (backtest et forward
test d'une stratégie or/argent), sans lien avec le poste web.

## Avertissements

- Projet indépendant, non affilié à la CFTC, à la LBMA ni à TradingView.
- Le COT est **hebdomadaire et différé** : arrêté le mardi, publié le vendredi.
  Ce n'est jamais une photographie du marché en temps réel, et il ne couvre que
  les contrats à terme américains — ni l'OTC de Londres, ni les ETF, ni les
  achats de banques centrales.
- Les statistiques sur configurations comparables sont **descriptives**, sur de
  petits échantillons d'épisodes non indépendants. Ce ne sont pas des prévisions.
- Rien ici n'est un conseil en investissement.
