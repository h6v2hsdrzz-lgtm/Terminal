"""Walk-forward analysis: optimize on a window, test on the next unseen one.

Rolling by default (train window slides), anchored optional (train start
fixed). The key output is the walk-forward efficiency (WFE): aggregate OOS
performance relative to what the optimizer promised in-sample. WFE near or
above the threshold means the edge survives on unseen data.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from quantbt.config import CostConfig, RiskConfig, WalkForwardConfig
from quantbt.data.loader import MarketData
from quantbt.engine.backtester import run_backtest
from quantbt.metrics.core import compute_metrics
from quantbt.strategy.base import Strategy
from quantbt.validation.common import Flag, ValidationOutcome, get_grid, grid_search, slice_data


def run_walkforward(
    data: MarketData,
    strategy: Strategy,
    costs: CostConfig,
    risk: RiskConfig,
    cfg: WalkForwardConfig,
    param_grid: dict | None = None,
) -> ValidationOutcome:
    n = len(data.frame)
    grid = get_grid(strategy, param_grid or {})

    folds: list[dict[str, Any]] = []
    oos_equity_parts: list[pd.Series] = []
    train_bars, test_bars = cfg.train_bars, cfg.test_bars

    start = 0
    fold_id = 0
    while fold_id < cfg.n_folds:
        train_start = 0 if cfg.anchored else start
        train_end = start + train_bars
        test_end = train_end + test_bars
        if test_end > n:
            break
        train = slice_data(data, train_start, train_end)
        test = slice_data(data, train_end, test_end)

        best_params, is_m, _ = grid_search(train, strategy, grid, costs, risk, cfg.objective)
        test_result = run_backtest(test, strategy.with_params(**best_params), costs, risk)
        oos_m = compute_metrics(test_result)

        folds.append(
            {
                "fold": fold_id,
                "train_range": [str(train.frame.index[0]), str(train.frame.index[-1])],
                "test_range": [str(test.frame.index[0]), str(test.frame.index[-1])],
                "best_params": best_params,
                "is_metrics": is_m.as_dict(),
                "oos_metrics": oos_m.as_dict(),
            }
        )
        # Normalize each OOS segment to its own start so segments chain into
        # one compounded curve regardless of per-fold capital.
        oos_equity_parts.append(test_result.equity / test_result.equity.iloc[0])
        start += test_bars
        fold_id += 1

    if not folds:
        return ValidationOutcome(
            module="walkforward",
            flags=[Flag("walkforward.data", "warn",
                        f"not enough bars ({n}) for train={train_bars}+test={test_bars}", None)],
            payload={"folds": []},
        )

    stitched = pd.concat(
        [part * _chain_factor(oos_equity_parts, i) for i, part in enumerate(oos_equity_parts)]
    )
    is_obj = [f["is_metrics"][cfg.objective] for f in folds]
    oos_obj = [f["oos_metrics"][cfg.objective] for f in folds]
    mean_is = sum(is_obj) / len(is_obj)
    mean_oos = sum(oos_obj) / len(oos_obj)
    wfe = mean_oos / mean_is if mean_is > 0 else float("-inf")
    positive_folds = sum(1 for v in oos_obj if v > 0) / len(oos_obj)

    flags: list[Flag] = []
    if mean_is <= 0:
        flags.append(Flag("walkforward.edge", "fail",
                          f"mean in-sample {cfg.objective} non-positive ({mean_is:.2f})", mean_is))
    elif wfe < 0:
        flags.append(Flag("walkforward.wfe", "fail",
                          f"WFE negative ({wfe:.2f}) — optimized params lose money out of sample", wfe))
    elif wfe < cfg.min_wfe:
        flags.append(Flag("walkforward.wfe", "warn",
                          f"WFE {wfe:.2f} below threshold {cfg.min_wfe}", wfe))
    else:
        flags.append(Flag("walkforward.wfe", "pass", f"WFE {wfe:.2f}", wfe))
    if positive_folds < 0.5:
        flags.append(Flag("walkforward.consistency", "warn",
                          f"only {positive_folds:.0%} of OOS folds have positive {cfg.objective}",
                          positive_folds))
    else:
        flags.append(Flag("walkforward.consistency", "pass",
                          f"{positive_folds:.0%} of OOS folds positive", positive_folds))

    return ValidationOutcome(
        module="walkforward",
        flags=flags,
        payload={
            "folds": folds,
            "wfe": wfe,
            "mean_is": mean_is,
            "mean_oos": mean_oos,
            "positive_folds": positive_folds,
            "oos_equity": stitched,
        },
    )


def _chain_factor(parts: list[pd.Series], i: int) -> float:
    factor = 1.0
    for p in parts[:i]:
        factor *= float(p.iloc[-1])
    return factor
