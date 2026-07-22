# goldsilver — algo de trading XAU/USD + XAG/USD avec validation anti-overfitting

Backtest **réaliste** (spread bid/ask réel majoré, slippage, swap overnight,
worst-case intrabar, gaps) et surtout une **suite de validation** dont le seul
but est de répondre honnêtement à une question : *cette stratégie a-t-elle un
edge out-of-sample, oui ou non ?*

Le rendement n'est jamais une cible d'optimisation ici. La cible utilisateur
(5-6 %/mois) est traitée comme un **benchmark à mesurer**, pas une contrainte
à forcer. Les chiffres publiés sont les chiffres out-of-sample, coûts
pessimistes inclus — voir la section [Résultats](#résultats-mesurés) et le
verdict en bas.

## Installation

```bash
cd algo
python3 -m pip install -e .[dev]     # Python 3.11+
```

## Lancer un backtest complet

```bash
# 1) Télécharger ~7,5 ans de bougies 1h bid+ask (Dukascopy, gratuit, sans clé)
python3 -m goldsilver fetch

# 2) Backtest rapide, paramètres par défaut (métriques en console)
python3 -m goldsilver backtest

# 3) Validation complète (OOS, walk-forward, Monte-Carlo, noise, detrend,
#    sensibilité) + rapport HTML + résumé JSON dans reports/
python3 -m goldsilver validate

# Tests
python3 -m pytest
```

Tout est piloté par `config/default.yaml` (aucun paramètre en dur) :
`-c mon_fichier.yaml` pour une variante. Vous pouvez aussi fournir vos propres
CSV (`time,open,high,low,close,volume[,spread]`, UTC) aux chemins configurés —
y compris en 15m (`data.base_timeframe: "15m"`).

## Architecture

```
algo/
├── config/default.yaml       # TOUTE la configuration (données, coûts, stratégie, seuils)
├── src/goldsilver/
│   ├── data/                 # fetch Dukascopy (bid+ask -> spread réel), loader CSV,
│   │                         # nettoyage, resampling multi-TF SANS look-ahead
│   ├── strategy/             # Strategy ABC + trend_pullback (daily EMA + RSI 1h,
│   │                         # SL = k x ATR, TP = R:R x SL >= 1:3)
│   ├── engine/               # sizing en % de risque, coûts, backtester bar-par-bar
│   ├── metrics/              # CAGR, mensuel moyen ± écart-type, Sharpe, Sortino,
│   │                         # max DD, win rate, profit factor, expectancy
│   ├── validation/           # oos, walk_forward, monte_carlo, noise, detrend,
│   │                         # sensitivity — un module par méthode
│   ├── report/               # verdict à seuils explicites + rapport HTML plotly
│   └── pipeline.py           # le chemin de code UNIQUE data -> signaux -> engine
└── tests/                    # sizing/risque, SL/TP/gaps/swap, anti-lookahead, métriques
```

### Choix d'honnêteté intégrés au code

- **Anti-look-ahead structurel** : une bougie 1h ne voit que la dernière bougie
  daily *terminée* (`align_to_base`, décalage d'une bougie + jointure asof).
  Testé par un test d'invariance : ajouter des données futures ne change aucun
  signal passé.
- **Exécution pessimiste** : signaux exécutés à l'ouverture suivante ; SL et TP
  dans la même bougie ⇒ SL d'abord ; gap au-delà du SL ⇒ exécution au gap ;
  spread réel par bougie × multiplicateur pessimiste (1.3 par défaut) ;
  slippage sur stops/market ; swap nightly, triple le mercredi.
- **Argent ≠ or** : l'argent est plus volatil — le SL en ATR et le sizing en %
  de risque adaptent automatiquement la taille ; une position déjà ouverte sur
  le métal corrélé dans le même sens divise le risque de la seconde par 2
  (`corr_risk_factor`), avec plafond de risque cumulé.
- **Grille d'optimisation volontairement petite** (3×3×3) et objectif unique :
  moins de degrés de liberté = moins d'overfitting. Un jeu de paramètres qui
  fait < 30 trades est disqualifié.
- **Verdict à seuils écrits d'avance** dans le YAML (rétention Sharpe OOS ≥ 0.5,
  WFE ≥ 0.5, P(ruine) ≤ 5 %, plateau ≥ 0.5, etc.) : les seuils classent, ils ne
  s'optimisent pas.

## Méthodes de validation

| Module | Question posée |
|---|---|
| `oos.py` | Split 70/30 chronologique. Les paramètres (défaut ET optimisés-sur-train) tiennent-ils sur le test ? Dégradation = overfitting. |
| `walk_forward.py` | Ré-optimisation glissante (36 mois train / 6 mois test). L'equity chaînée des segments test est 100 % out-of-sample. WFE = rendement OOS / IS. |
| `monte_carlo.py` | Reshuffle + bootstrap des trades → distribution des drawdowns, P(ruine ≥ 30 %), percentiles de rendement. |
| `noise.py` | Bruit gaussien 0.1 × ATR sur les prix, 100 runs. Une stratégie qui meurt d'un bruit microscopique n'a jamais eu d'edge. |
| `detrend.py` | Dérive de fond retirée des prix. Ce qui reste est du timing ; ce qui disparaît n'était que « l'or montait ». |
| `sensitivity.py` | Heatmaps 2D autour des paramètres choisis. Plateau = robuste, pic isolé = ajusté au bruit. |

## Résultats mesurés

*(section remplie par le run de validation du dépôt — régénérez avec
`python3 -m goldsilver validate`, rapport HTML détaillé dans `reports/`)*

<!-- RESULTS -->

## Avertissements

Backtest ≠ avenir. Les hypothèses de coûts sont pessimistes mais pas
garanties (spread en période de news, slippage sur stops). Les swaps CFD
varient selon le courtier et les taux — vérifiez les valeurs de
`engine.costs.per_asset` contre votre courtier. Rien ici n'est un conseil en
investissement.
