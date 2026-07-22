"""Out-of-sample : split chronologique train/test + mesure de dégradation.

Deux évaluations sont produites, et les deux figurent au rapport :

1. **Paramètres par défaut** (config), appliqués tels quels au train et au
   test : mesure la stratégie « comme conçue », sans aucune sélection.
2. **Paramètres optimisés sur le train** (grid-search), appliqués FIGÉS au
   test : mesure combien la sélection de paramètres généralise.

La dégradation IS -> OOS est le premier signal d'overfitting : une stratégie
saine perd un peu ; une stratégie sur-ajustée s'effondre.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Mapping

import pandas as pd

from goldsilver.config import Config
from goldsilver.metrics.performance import Metrics
from goldsilver.pipeline import RunResult, run_backtest, slice_market
from goldsilver.validation.grid import GridResult, grid_search

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class OOSResult:
    split_time: pd.Timestamp
    default_is: RunResult
    default_oos: RunResult
    tuned_params: dict[str, Any]
    tuned_is: RunResult
    tuned_oos: RunResult
    grid: GridResult

    @staticmethod
    def _retention(is_m: Metrics, oos_m: Metrics) -> dict[str, float]:
        def ratio(a: float, b: float) -> float:
            return a / b if b not in (0.0, 0) and abs(b) > 1e-12 else float("nan")

        return {
            "sharpe_retention": ratio(oos_m.sharpe, is_m.sharpe),
            "monthly_mean_retention": ratio(oos_m.monthly_mean, is_m.monthly_mean),
            "profit_factor_retention": ratio(oos_m.profit_factor, is_m.profit_factor),
        }

    @property
    def default_retention(self) -> dict[str, float]:
        return self._retention(self.default_is.metrics, self.default_oos.metrics)

    @property
    def tuned_retention(self) -> dict[str, float]:
        return self._retention(self.tuned_is.metrics, self.tuned_oos.metrics)


def split_time(market: Mapping[str, pd.DataFrame], train_frac: float) -> pd.Timestamp:
    """Instant du split : quantile ``train_frac`` de l'index (union des actifs)."""
    all_ts = sorted(set().union(*(set(df.index) for df in market.values())))
    return all_ts[int(len(all_ts) * train_frac)]


def run_oos(market: Mapping[str, pd.DataFrame], cfg: Config) -> OOSResult:
    t_split = split_time(market, cfg.validation.oos.train_frac)
    warmup = pd.Timedelta(days=cfg.data.warmup_days)
    t0 = min(df.index[0] for df in market.values())

    train = slice_market(market, None, t_split)
    test = slice_market(market, t_split, None, warmup=warmup)

    log.info("OOS : train %s -> %s, test %s -> fin", t0, t_split, t_split)

    default_is = run_backtest(train, cfg)
    default_oos = run_backtest(test, cfg, no_trade_before=t_split)

    grid = grid_search(train, cfg)
    tuned_is = run_backtest(train, cfg, grid.best_params)
    tuned_oos = run_backtest(test, cfg, grid.best_params, no_trade_before=t_split)

    return OOSResult(
        split_time=t_split,
        default_is=default_is,
        default_oos=default_oos,
        tuned_params=grid.best_params,
        tuned_is=tuned_is,
        tuned_oos=tuned_oos,
        grid=grid,
    )
