"""Grid-search partagé par l'out-of-sample et le walk-forward.

Garde-fous anti-overfitting :
- la grille vient de la config et est volontairement PETITE ;
- un jeu de paramètres qui produit moins de ``min_trades`` trades reçoit un
  score invalide (-inf) : pas de « meilleur paramètre » assis sur 4 trades ;
- l'objectif (Sharpe par défaut) est configurable mais unique — on ne
  choisit pas après coup la métrique qui arrange.
"""

from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass
from typing import Any, Mapping

import math

import pandas as pd

from goldsilver.config import Config
from goldsilver.metrics.performance import Metrics
from goldsilver.pipeline import run_backtest

log = logging.getLogger(__name__)


def objective_value(metrics: Metrics, objective: str, min_trades: int) -> float:
    if metrics.n_trades < min_trades:
        return -math.inf
    value = {
        "sharpe": metrics.sharpe,
        "profit_factor": metrics.profit_factor,
        "return": metrics.total_return,
        "expectancy_r": metrics.expectancy_r,
    }.get(objective)
    if value is None:
        raise ValueError(f"Objectif inconnu : {objective}")
    return float(value) if math.isfinite(value) else -math.inf


@dataclass(frozen=True)
class GridResult:
    best_params: dict[str, Any]
    best_score: float
    table: pd.DataFrame  # une ligne par combinaison : params + métriques clés


def grid_search(
    market: Mapping[str, pd.DataFrame],
    cfg: Config,
    no_trade_before: pd.Timestamp | None = None,
) -> GridResult:
    grid = cfg.validation.grid
    names = list(grid)
    rows: list[dict[str, Any]] = []
    best_score = -math.inf
    best_params: dict[str, Any] = {}
    combos = list(itertools.product(*(grid[n] for n in names)))
    for values in combos:
        override = dict(zip(names, values))
        rr = run_backtest(market, cfg, override, no_trade_before)
        score = objective_value(rr.metrics, cfg.validation.objective, cfg.validation.min_trades)
        rows.append(
            {
                **override,
                "score": score,
                "sharpe": rr.metrics.sharpe,
                "total_return": rr.metrics.total_return,
                "max_drawdown": rr.metrics.max_drawdown,
                "profit_factor": rr.metrics.profit_factor,
                "n_trades": rr.metrics.n_trades,
            }
        )
        if score > best_score:
            best_score = score
            best_params = override
    if not best_params:
        # aucune combinaison valide : on retombe sur les paramètres par défaut
        log.warning("Grid-search : aucune combinaison n'atteint min_trades=%d",
                    cfg.validation.min_trades)
        best_params = {}
    return GridResult(best_params=best_params, best_score=best_score,
                      table=pd.DataFrame(rows))
