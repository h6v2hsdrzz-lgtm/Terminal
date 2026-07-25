"""Robustesse : sensibilité des paramètres, stress des coûts, alpha/beta.

* **Sensibilité (§8.5)** — la zone de performance doit être un *plateau*. Un
  pic isolé signe le surajustement. On mesure donc explicitement la « planéité »
  du voisinage du meilleur point.
* **Stress des coûts (§8.7)** — frais et slippage x1,5 et x2. Si l'edge
  disparaît, il n'existait pas.
* **Alpha/beta (§8.10)** — la surperformance est-elle de l'alpha, ou du beta
  amplifié par le levier ?
"""

from __future__ import annotations

from typing import Any, Iterable

import numpy as np
import pandas as pd
from scipy import stats

from ..config import Config
from ..reports.metrics import to_returns
from ..utils import get_logger

log = get_logger("validation.robustness")


# ---------------------------------------------------------------------------
# Sensibilité des paramètres
# ---------------------------------------------------------------------------
def sensitivity_table(outcomes, metric: str = "sharpe") -> pd.DataFrame:
    rows = []
    for outcome in outcomes:
        row = dict(outcome.params)
        row[metric] = outcome.metrics.get(metric)
        row["trades"] = outcome.metrics.get("trades")
        row["total_return"] = outcome.metrics.get("total_return")
        row["max_drawdown"] = outcome.metrics.get("max_drawdown")
        rows.append(row)
    return pd.DataFrame(rows)


def heatmap(table: pd.DataFrame, x: str, y: str, metric: str = "sharpe") -> pd.DataFrame:
    if table.empty or x not in table or y not in table:
        return pd.DataFrame()
    return table.pivot_table(index=y, columns=x, values=metric, aggfunc="mean")


def plateau_score(table: pd.DataFrame, metric: str = "sharpe", top_share: float = 0.25) -> dict[str, float]:
    """Mesure de « planéité » autour du meilleur point.

    ``plateau_ratio`` = médiane des voisins du top / valeur du meilleur point.
    Proche de 1 : plateau (robuste). Proche de 0 : pic isolé (surajustement).
    """
    if table.empty or metric not in table:
        return {"best": float("nan"), "plateau_ratio": float("nan"), "top_share": top_share}
    values = table[metric].astype(float).replace([np.inf, -np.inf], np.nan).dropna()
    if values.empty:
        return {"best": float("nan"), "plateau_ratio": float("nan"), "top_share": top_share}
    best = float(values.max())
    n_top = max(2, int(np.ceil(len(values) * top_share)))
    top = values.nlargest(n_top)
    ratio = float(top.median() / best) if best != 0 else float("nan")
    return {
        "best": best,
        "median_top": float(top.median()),
        "median_all": float(values.median()),
        "plateau_ratio": ratio,
        "dispersion": float(values.std(ddof=1)) if len(values) > 1 else float("nan"),
        "n_points": int(len(values)),
        "top_share": top_share,
    }


# ---------------------------------------------------------------------------
# Stress des coûts
# ---------------------------------------------------------------------------
def cost_stress(
    cfg: Config,
    market_data,
    multipliers: Iterable[float] | None = None,
    start=None,
    end=None,
    shared_cache: dict | None = None,
    params: dict | None = None,
) -> pd.DataFrame:
    """Rejoue la stratégie avec frais et slippage multipliés.

    Passe par ``ValidationRunner`` pour garantir **exactement** la même fenêtre
    (pré-chargement de warmup compris) que le backtest de référence : comparer
    un stress calculé sur une fenêtre plus courte donnerait un écart qui ne
    vient pas des coûts.
    """
    from .runner import ValidationRunner

    multipliers = list(multipliers or cfg.get_path("validation.cost_stress.multipliers"))
    rows = []
    for mult in multipliers:
        runner = ValidationRunner(cfg, market_data, registry=None, cost_stress=float(mult),
                                  shared_cache=shared_cache)
        outcome = runner.run_once(params or {}, start, end,
                                  label=f"stress_x{mult:g}", record=False)
        m = outcome.metrics
        rows.append(
            {
                "cost_multiplier": mult,
                "cagr": m.get("cagr"),
                "sharpe": m.get("sharpe"),
                "total_return": m.get("total_return"),
                "max_drawdown": m.get("max_drawdown"),
                "trades": m.get("trades"),
                "net_pnl": m.get("net_pnl"),
                "gross_pnl": m.get("gross_pnl"),
                "costs_total": m.get("costs_total"),
                "costs_over_gross_pnl": m.get("costs_over_gross_pnl"),
            }
        )
    table = pd.DataFrame(rows)
    if len(table) > 1 and table["sharpe"].notna().any():
        base = table.iloc[0]["sharpe"]
        table["sharpe_retention"] = table["sharpe"] / base if base and np.isfinite(base) else np.nan
    return table


# ---------------------------------------------------------------------------
# Alpha / beta
# ---------------------------------------------------------------------------
def alpha_beta(
    strategy_equity: pd.Series,
    benchmark_equity: pd.Series,
    frequency: str = "D",
    periods_per_year: int = 365,
) -> dict[str, Any]:
    """Régression des rendements de la stratégie sur ceux du benchmark.

    Un beta élevé avec un alpha nul signifie : « la performance est du BTC avec
    du levier », pas une compétence de sélection.
    """
    s = to_returns(strategy_equity.dropna(), frequency)
    b = to_returns(benchmark_equity.dropna(), frequency)
    joined = pd.concat([s.rename("strategy"), b.rename("benchmark")], axis=1).dropna()
    if len(joined) < 20:
        return {"n_obs": len(joined), "alpha": float("nan"), "beta": float("nan")}

    x = joined["benchmark"].to_numpy()
    y = joined["strategy"].to_numpy()
    result = stats.linregress(x, y)
    alpha_period = float(result.intercept)
    return {
        "n_obs": int(len(joined)),
        "alpha_period": alpha_period,
        "alpha_annualized": float((1 + alpha_period) ** periods_per_year - 1),
        "beta": float(result.slope),
        "r_squared": float(result.rvalue ** 2),
        "alpha_pvalue": float(result.pvalue),
        "alpha_stderr": float(result.intercept_stderr),
        "beta_stderr": float(result.stderr),
        "correlation": float(result.rvalue),
        "alpha_significant_5pct": bool(result.pvalue < 0.05 and result.intercept > 0),
    }


def regime_breakdown(trades: pd.DataFrame, min_trades: int = 200) -> pd.DataFrame:
    """Décomposition par régime avec le seuil statistique du §8.8.

    Un régime sous ``min_trades`` est marqué **non concluant** : le rapport ne
    doit pas en tirer d'affirmation.
    """
    from ..reports.metrics import summarize_by

    table = summarize_by(trades, "regime")
    if table.empty:
        return table
    table["conclusive"] = table["trades"] >= min_trades
    table["verdict"] = np.where(
        table["conclusive"], "échantillon suffisant",
        f"échantillon insuffisant (< {min_trades} trades) — aucune conclusion",
    )
    return table
