"""Performance metrics computed from an equity curve and a trade list."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from quantbt.engine.backtester import BacktestResult

TRADING_DAYS_PER_YEAR = 365.0  # crypto trades 24/7; metals close weekends but
# using calendar days for both keeps CAGR/Sharpe comparable across assets.


@dataclass(frozen=True)
class Metrics:
    cagr: float
    sharpe: float
    sortino: float
    max_drawdown: float  # negative fraction, e.g. -0.23
    win_rate: float
    profit_factor: float
    expectancy_r: float  # mean R multiple per trade
    exposure: float
    n_trades: int
    total_return: float
    avg_rr_realized: float

    def as_dict(self) -> dict[str, float]:
        return asdict(self)


def max_drawdown(equity: pd.Series) -> float:
    peak = equity.cummax()
    dd = equity / peak - 1.0
    return float(dd.min()) if len(dd) else 0.0


def _daily_returns(equity: pd.Series) -> pd.Series:
    """Daily equity returns. Sharpe/Sortino are computed on daily bars: per-bar
    intraday returns on a mostly-flat equity curve produce absurd annualized
    values (|Sharpe| in the hundreds) that compare with nothing."""
    daily = equity.resample("1D").last().dropna()
    if len(daily) < 3:
        return equity.pct_change().fillna(0.0)
    return daily.pct_change().fillna(0.0)


def compute_metrics(result: BacktestResult) -> Metrics:
    eq = result.equity
    trades = result.trades
    n_bars = len(eq)

    total_return = float(eq.iloc[-1] / result.initial_capital - 1.0) if n_bars else 0.0
    years = n_bars / (result.bars_per_day * TRADING_DAYS_PER_YEAR) if n_bars else 0.0
    if years > 0 and eq.iloc[-1] > 0:
        cagr = float((eq.iloc[-1] / result.initial_capital) ** (1 / years) - 1.0)
    else:
        cagr = -1.0 if total_return <= -1.0 else 0.0

    daily = _daily_returns(eq)
    ann = float(np.sqrt(TRADING_DAYS_PER_YEAR))
    std = float(daily.std())
    sharpe = float(daily.mean() / std * ann) if std > 0 else 0.0
    downside = daily[daily < 0]
    dstd = float(downside.std())
    sortino = float(daily.mean() / dstd * ann) if dstd > 0 else 0.0

    if len(trades):
        wins = trades[trades["pnl"] > 0]
        losses = trades[trades["pnl"] < 0]
        win_rate = len(wins) / len(trades)
        gross_win = float(wins["pnl"].sum())
        gross_loss = float(-losses["pnl"].sum())
        profit_factor = gross_win / gross_loss if gross_loss > 0 else float("inf")
        expectancy_r = float(trades["r_multiple"].mean())
        avg_rr = float(wins["r_multiple"].mean()) if len(wins) else 0.0
    else:
        win_rate = 0.0
        profit_factor = 0.0
        expectancy_r = 0.0
        avg_rr = 0.0

    return Metrics(
        cagr=cagr,
        sharpe=sharpe,
        sortino=sortino,
        max_drawdown=max_drawdown(eq),
        win_rate=win_rate,
        profit_factor=profit_factor,
        expectancy_r=expectancy_r,
        exposure=result.exposure,
        n_trades=len(trades),
        total_return=total_return,
        avg_rr_realized=avg_rr,
    )
