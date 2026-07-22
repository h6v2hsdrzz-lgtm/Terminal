"""Walk-forward analysis : optimisation glissante, évaluation toujours hors-échantillon.

Pour chaque fold : grid-search sur ``train_months``, application des
paramètres FIGÉS sur les ``test_months`` suivants. Les segments de test,
mis bout à bout, forment une equity 100 % out-of-sample.

Walk-Forward Efficiency (WFE) = rendement annualisé OOS / rendement
annualisé IS (moyennes des folds). En dessous de ~0.5, l'optimisation
capture surtout du bruit.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any, Mapping

import numpy as np
import pandas as pd

from goldsilver.config import Config
from goldsilver.pipeline import run_backtest, slice_market
from goldsilver.validation.grid import grid_search

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class WalkForwardFold:
    fold: int
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    test_end: pd.Timestamp
    best_params: dict[str, Any]
    is_annual_return: float
    oos_annual_return: float
    is_sharpe: float
    oos_sharpe: float
    oos_total_return: float
    oos_n_trades: int


@dataclass(frozen=True)
class WalkForwardResult:
    folds: list[WalkForwardFold]
    stitched_equity: pd.Series      # equity OOS re-chaînée (base 1.0)
    wfe: float                      # efficiency sur le rendement annualisé
    wfe_sharpe: float               # idem sur le Sharpe
    profitable_folds_frac: float
    params_stability: pd.DataFrame  # paramètres retenus par fold

    @property
    def n_folds(self) -> int:
        return len(self.folds)


def _annualized(total_return: float, days: float) -> float:
    if days <= 0 or total_return <= -1.0:
        return -1.0
    return (1.0 + total_return) ** (365.25 / days) - 1.0


def run_walk_forward(market: Mapping[str, pd.DataFrame], cfg: Config) -> WalkForwardResult:
    wf = cfg.validation.walk_forward
    warmup = pd.Timedelta(days=cfg.data.warmup_days)
    t0 = min(df.index[0] for df in market.values())
    t_end = max(df.index[-1] for df in market.values())

    folds: list[WalkForwardFold] = []
    stitched_parts: list[pd.Series] = []
    train_start = t0
    fold_no = 0
    while True:
        train_end = train_start + pd.DateOffset(months=wf.train_months)
        test_end = train_end + pd.DateOffset(months=wf.test_months)
        if train_end >= t_end:
            break
        test_end = min(test_end, t_end)

        train = slice_market(market, None if wf.anchored else train_start, train_end,
                             warmup=None if wf.anchored else warmup)
        ntb_train = None if wf.anchored else train_start
        test = slice_market(market, train_end, test_end, warmup=warmup)

        grid = grid_search(train, cfg, no_trade_before=ntb_train)
        rr_is = run_backtest(train, cfg, grid.best_params, no_trade_before=ntb_train)
        rr_oos = run_backtest(test, cfg, grid.best_params, no_trade_before=train_end)

        is_days = max(rr_is.metrics.n_days, 1e-9)
        oos_days = max(rr_oos.metrics.n_days, 1e-9)
        fold = WalkForwardFold(
            fold=fold_no,
            train_start=train_start,
            train_end=train_end,
            test_end=test_end,
            best_params=grid.best_params,
            is_annual_return=_annualized(rr_is.metrics.total_return, is_days),
            oos_annual_return=_annualized(rr_oos.metrics.total_return, oos_days),
            is_sharpe=rr_is.metrics.sharpe,
            oos_sharpe=rr_oos.metrics.sharpe,
            oos_total_return=rr_oos.metrics.total_return,
            oos_n_trades=rr_oos.metrics.n_trades,
        )
        folds.append(fold)
        log.info(
            "WF fold %d : train->%s | OOS %s -> %s : %+.2f %% (%d trades)",
            fold_no, train_end.date(), train_end.date(), test_end.date(),
            100 * fold.oos_total_return, fold.oos_n_trades,
        )
        norm = rr_oos.equity / rr_oos.equity.iloc[0]
        stitched_parts.append(norm)

        fold_no += 1
        train_start = train_start + pd.DateOffset(months=wf.test_months)
        if test_end >= t_end:
            break

    if not folds:
        raise ValueError(
            "Walk-forward : historique trop court pour train_months="
            f"{wf.train_months} + test_months={wf.test_months}"
        )

    # chaînage multiplicatif des segments OOS
    chained: list[pd.Series] = []
    level = 1.0
    for part in stitched_parts:
        chained.append(part * level)
        level = float(chained[-1].iloc[-1])
    stitched = pd.concat(chained)
    stitched = stitched[~stitched.index.duplicated(keep="last")]

    mean_is = float(np.mean([f.is_annual_return for f in folds]))
    mean_oos = float(np.mean([f.oos_annual_return for f in folds]))
    mean_is_sharpe = float(np.mean([f.is_sharpe for f in folds]))
    mean_oos_sharpe = float(np.mean([f.oos_sharpe for f in folds]))

    def _eff(oos: float, is_: float) -> float:
        if abs(is_) < 1e-12:
            return float("nan")
        if is_ < 0:
            # IS négatif : l'efficiency n'a pas de sens, signaler tel quel
            return float("nan")
        return oos / is_

    params_rows = [{"fold": f.fold, **f.best_params} for f in folds]

    return WalkForwardResult(
        folds=folds,
        stitched_equity=stitched,
        wfe=_eff(mean_oos, mean_is),
        wfe_sharpe=_eff(mean_oos_sharpe, mean_is_sharpe),
        profitable_folds_frac=float(np.mean([f.oos_total_return > 0 for f in folds])),
        params_stability=pd.DataFrame(params_rows),
    )
