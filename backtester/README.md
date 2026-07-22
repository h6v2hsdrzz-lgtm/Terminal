# quantbt — backtesting & validation anti-overfitting

Framework Python de backtesting **et** de validation de stratégies de trading
(XAG/USD, ETH, day/swing). L'objectif n'est pas de produire une jolie courbe
d'equity, mais de répondre à la seule question qui compte : *cet edge est-il
réel, ou est-ce du sur-ajustement ?* Le rapport final rend un verdict clair :
**ROBUSTE / FRAGILE / OVERFIT**.

## Installation

```bash
cd backtester
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"          # pandas, numpy, plotly, PyYAML, pytest
pip install -e ".[crypto]"       # optionnel : ccxt pour fetch OKX
```

## Démarrage rapide

```bash
# 1. Générer des données synthétiques de démonstration (seedées)
python scripts/make_sample_data.py

# 2. Backtest + validation complète + rapport HTML
python -m quantbt run -c configs/backtest.yaml
# → reports/report.html  (equity, drawdown, Monte-Carlo, heatmap, verdict)

# 3. Tests
python -m pytest
```

Pour de vraies données : déposez un CSV OHLCV (colonnes flexibles :
`timestamp/date, open/o, high/h, low/l, close/c, volume`) et pointez
`data.csv_path` dessus, ou passez `data.source: ccxt` (voir
`configs/eth_okx.yaml` pour ETH/USDT sur OKX).

> Note : la stratégie d'exemple (croisement EMA + SL ATR) sur les données
> synthétiques ressort volontairement **OVERFIT** — c'est la démonstration que
> le framework rejette un edge inexistant au lieu de l'embellir.

## Architecture

```
src/quantbt/
├── config.py        # dataclasses typées ← YAML (aucun paramètre en dur)
├── cli.py           # orchestrateur : data → backtest → validations → rapport
├── data/            # CSV/ccxt, nettoyage OHLC, resampling multi-TF sans lookahead
├── strategy/        # Strategy ABC (signal → SL/TP), registre, exemple ema_atr
├── engine/          # moteur bar-par-bar : spread pessimiste, slippage,
│                    # commissions, funding, sizing risk %, SL/TP, filtre R:R
├── metrics/         # CAGR, Sharpe, Sortino, maxDD, win rate, PF, expectancy…
├── validation/      # LE cœur : oos, walkforward, montecarlo, noise,
│                    # detrend, sensitivity, verdict
└── report/          # rapport HTML autonome (plotly)
```

## Modèle d'exécution (choix volontairement pessimistes)

| Décision | Règle |
|---|---|
| Anti-lookahead | signal à la clôture de t → exécution à l'**open de t+1** ; les colonnes du TF supérieur ne montrent que des barres HTF **clôturées** |
| Fills | demi-spread + slippage toujours défavorables ; `pessimistic_mult` gonfle le spread au-delà de sa moyenne |
| SL/TP intrabar | si SL **et** TP sont dans le range de la même barre → **SL d'abord** |
| Gaps | un gap au-delà du SL est rempli au prix d'ouverture (pire que le SL), jamais au niveau |
| Sizing | `qty = equity × risk_pct / |entry − SL|`, plafonné au levier max |
| Filtre R:R | entrée rejetée si le R:R **net** (mesuré sur le fill réel) < `min_rr` ; visez `rr` stratégie > `min_rr` pour absorber les coûts |
| Sharpe/Sortino | calculés sur les rendements **journaliers** (les rendements par barre 15 m d'une equity majoritairement plate donnent des valeurs annualisées absurdes) |

## Méthodes de validation

- **Out-of-sample** (`validation/oos.py`) — optimise sur le train (70 %), juge
  sur le test jamais vu. Dégradation IS→OOS au-delà du seuil = drapeau overfitting.
- **Walk-forward** (`validation/walkforward.py`) — fenêtre glissante (ou ancrée) :
  optimise → teste sur la période suivante → avance. Sort la **WFE**
  (efficacité walk-forward) et la consistance des folds ; l'equity OOS
  recousue apparaît sur le graphe d'equity.
- **Monte-Carlo** (`validation/montecarlo.py`) — reshuffle de l'ordre des
  trades (risque de séquence) + bootstrap (mix de trades) sur les rendements
  par trade composés → percentiles d'equity finale, de max drawdown, et
  **risque de ruine** (P(equity < seuil)).
- **Noise test** (`validation/noise.py`) — bruit gaussien proportionnel à
  l'ATR sur l'OHLC (barres reconstruites valides, HTF re-resamplé), N runs
  seedés → stabilité du signe de l'expectancy et dispersion.
- **Detrending** (`validation/detrend.py`) — retire la dérive exponentielle
  (log-linéaire) des prix et re-teste : si l'edge disparaît, la performance
  n'était que du **beta marché**, pas du timing.
- **Sensibilité** (`validation/sensitivity.py`) — heatmap 2-D des paramètres :
  un **plateau** de performance = robuste ; un pic isolé = fragile.
- **Verdict** (`validation/verdict.py`) — agrège tous les drapeaux
  (pass/warn/fail). Un `fail` sur un module critique (OOS, walk-forward,
  detrend) ⇒ **OVERFIT** ; accumulation de warns ⇒ **FRAGILE** ; sinon
  **ROBUSTE**.

## Configuration

Tout vit dans le YAML (voir `configs/backtest.yaml`, commenté) : données et
timeframes, coûts (spread pessimiste, slippage, commissions, funding), risque
(capital, risk %, levier, `min_rr`), stratégie + `param_grid` (utilisé par
l'optimisation OOS, le walk-forward et la heatmap), seuils de chaque
validation, et rapport. `seed` fixe la reproductibilité de bout en bout.

## Écrire sa propre stratégie

```python
from quantbt.strategy.base import Strategy
from quantbt.strategy.registry import register

@register
class MaStrat(Strategy):
    name = "ma_strat"

    @classmethod
    def default_params(cls): return {"lookback": 20}

    @classmethod
    def default_param_grid(cls): return {"lookback": [10, 20, 40]}

    def generate_signals(self, data):
        df = data.frame  # OHLCV base + colonnes *_1h / *_1D (HTF clôturé)
        ...
        # retourne un DataFrame indexé comme df avec: signal (-1/0/+1), sl, tp
```

Puis `strategy.name: ma_strat` dans le YAML. Contrat : la ligne t ne peut
utiliser que l'information disponible à la clôture de t (le moteur exécute à
l'open de t+1) ; le test `test_no_lookahead_signals_after_data_truncation`
montre comment vérifier qu'une stratégie ne triche pas.

## Avertissement

Outil d'analyse à but éducatif/recherche. Les résultats de backtest, même
« robustes », ne préjugent pas des performances futures. Rien ici n'est un
conseil en investissement.
