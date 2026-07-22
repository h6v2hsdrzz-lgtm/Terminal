"""Orchestration : données de base -> timeframes -> signaux -> backtest -> métriques.

C'est LA fonction que tous les modules de validation appellent, avec des
données éventuellement transformées (bruit, detrend) ou découpées (OOS,
walk-forward) et des paramètres éventuellement surchargés (grid-search).
Un seul chemin de code = pas de divergence entre le backtest "officiel" et
les backtests de validation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import pandas as pd

from goldsilver.config import Config
from goldsilver.data.timeframes import build_timeframes
from goldsilver.engine.backtester import Backtester, BacktestResult
from goldsilver.metrics.performance import Metrics, compute_metrics
from goldsilver.strategy.base import get_strategy


@dataclass(frozen=True)
class RunResult:
    result: BacktestResult
    metrics: Metrics
    params: dict[str, Any]

    @property
    def equity(self) -> pd.Series:
        return self.result.equity

    @property
    def trades(self) -> pd.DataFrame:
        return self.result.trades_frame


def slice_market(
    market: Mapping[str, pd.DataFrame],
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
    warmup: pd.Timedelta | None = None,
) -> dict[str, pd.DataFrame]:
    """Découpe [start-warmup, end] ; le warmup sert uniquement aux indicateurs."""
    out: dict[str, pd.DataFrame] = {}
    for a, df in market.items():
        lo = (start - warmup) if (start is not None and warmup is not None) else start
        sub = df
        if lo is not None:
            sub = sub[sub.index >= lo]
        if end is not None:
            sub = sub[sub.index <= end]
        out[a] = sub
    return out


def run_backtest(
    market: Mapping[str, pd.DataFrame],
    cfg: Config,
    params_override: Mapping[str, Any] | None = None,
    no_trade_before: pd.Timestamp | None = None,
) -> RunResult:
    """Backtest complet du portefeuille or+argent sur les données fournies.

    ``market`` : {actif: OHLCV au timeframe de base}. Si ``no_trade_before``
    est fourni, les bougies antérieures ne servent qu'à amorcer les
    indicateurs ; aucune entrée avant cette date, et l'equity comme les
    métriques sont calculées à partir de cette date.
    """
    params = dict(cfg.strategy.params)
    if params_override:
        params.update(params_override)
    strategy = get_strategy(cfg.strategy.name, params)

    signals: dict[str, pd.DataFrame] = {}
    for asset, base in market.items():
        tfs = build_timeframes(
            base,
            cfg.data.base_timeframe,
            cfg.data.timeframes,
            cfg.data.session_day_offset_hours,
        )
        signals[asset] = strategy.generate(asset, tfs)

    bt = Backtester(cfg)
    max_bars = params.get("max_bars_held")
    result = bt.run(
        signals,
        max_bars_held=int(max_bars) if max_bars is not None else None,
        no_trade_before=no_trade_before,
    )

    equity = result.equity
    trades = result.trades_frame
    if no_trade_before is not None:
        equity = equity[equity.index >= no_trade_before]
        if len(trades):
            trades = trades[trades["entry_time"] >= no_trade_before]
        result = BacktestResult(
            equity=equity,
            trades=[t for t in result.trades if t.entry_time >= no_trade_before],
            initial_equity=result.initial_equity,
            exposure=result.exposure,
        )

    metrics = compute_metrics(equity, trades, result.initial_equity, result.exposure)
    return RunResult(result=result, metrics=metrics, params=params)
