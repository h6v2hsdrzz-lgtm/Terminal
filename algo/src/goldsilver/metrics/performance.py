"""Métriques de performance calculées sur l'equity et la liste de trades.

Conventions :
- Sharpe / Sortino : rendements JOURNALIERS (equity rééchantillonnée en fin
  de journée), annualisés en racine de 252, taux sans risque nul.
- Rendement mensuel : equity de fin de mois calendaire ; moyenne et
  écart-type des rendements mensuels composés.
- Drawdown : sur l'equity mark-to-market bougie par bougie (pas seulement
  trade par trade), donc les excursions intra-trade comptent.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

TRADING_DAYS = 252
ANNUAL_DAYS = 365.25


@dataclass(frozen=True)
class Metrics:
    start: str
    end: str
    n_days: float
    initial_equity: float
    final_equity: float
    total_return: float          # fraction (0.25 = +25 %)
    cagr: float
    monthly_mean: float          # moyenne des rendements mensuels (fraction)
    monthly_std: float
    monthly_median: float
    best_month: float
    worst_month: float
    pct_positive_months: float
    sharpe: float
    sortino: float
    max_drawdown: float          # fraction positive (0.2 = -20 %)
    max_drawdown_duration_days: float
    n_trades: int
    win_rate: float
    profit_factor: float
    expectancy_r: float          # espérance en multiples de R
    expectancy_usd: float
    avg_win_usd: float
    avg_loss_usd: float
    avg_bars_held: float
    exposure: float
    total_swap_paid: float

    def to_dict(self) -> dict[str, float | int | str]:
        return asdict(self)


def _drawdown(equity: pd.Series) -> tuple[pd.Series, float, float]:
    peak = equity.cummax()
    dd = equity / peak - 1.0
    max_dd = float(-dd.min()) if len(dd) else 0.0
    # durée max sous le dernier sommet (vectorisé)
    at_peak = (equity >= peak).to_numpy()
    idx = np.arange(len(equity))
    last_peak_idx = np.maximum.accumulate(np.where(at_peak, idx, 0))
    ts = equity.index.as_unit("ns").asi8
    dur_days = (ts - ts[last_peak_idx]) / 86_400e9
    max_dur = float(dur_days.max()) if len(dur_days) else 0.0
    return dd, max_dd, max_dur


def _annualized_ratio(daily_ret: pd.Series, downside_only: bool) -> float:
    if len(daily_ret) < 2:
        return 0.0
    mean = float(daily_ret.mean())
    std = (
        float(daily_ret[daily_ret < 0].std(ddof=1))
        if downside_only
        else float(daily_ret.std(ddof=1))
    )
    if not std or math.isnan(std) or std == 0.0:
        return 0.0
    return mean / std * math.sqrt(TRADING_DAYS)


def compute_metrics(
    equity: pd.Series,
    trades: pd.DataFrame,
    initial_equity: float,
    exposure: float = 0.0,
) -> Metrics:
    if equity.empty:
        raise ValueError("compute_metrics : equity vide")
    n_days = max((equity.index[-1] - equity.index[0]).total_seconds() / 86400.0, 1e-9)
    final = float(equity.iloc[-1])
    total_return = final / initial_equity - 1.0
    cagr = (
        (final / initial_equity) ** (ANNUAL_DAYS / n_days) - 1.0
        if final > 0
        else -1.0
    )

    daily = equity.resample("1D").last().dropna()
    daily_ret = daily.pct_change().dropna()
    monthly = equity.resample("ME").last().dropna()
    # inclut le premier mois : rendement depuis l'equity initiale
    monthly_ret = (
        pd.concat([pd.Series([initial_equity]), monthly]).pct_change().dropna()
        if len(monthly)
        else pd.Series(dtype=float)
    )

    _, max_dd, max_dd_dur = _drawdown(equity)

    n_trades = len(trades)
    pnl = trades["pnl"] if n_trades else pd.Series(dtype=float)
    wins = pnl[pnl > 0]
    losses = pnl[pnl <= 0]
    gross_win = float(wins.sum())
    gross_loss = float(-losses.sum())
    profit_factor = gross_win / gross_loss if gross_loss > 0 else (math.inf if gross_win > 0 else 0.0)

    return Metrics(
        start=str(equity.index[0]),
        end=str(equity.index[-1]),
        n_days=round(n_days, 1),
        initial_equity=initial_equity,
        final_equity=round(final, 2),
        total_return=total_return,
        cagr=cagr,
        monthly_mean=float(monthly_ret.mean()) if len(monthly_ret) else 0.0,
        monthly_std=float(monthly_ret.std(ddof=1)) if len(monthly_ret) > 1 else 0.0,
        monthly_median=float(monthly_ret.median()) if len(monthly_ret) else 0.0,
        best_month=float(monthly_ret.max()) if len(monthly_ret) else 0.0,
        worst_month=float(monthly_ret.min()) if len(monthly_ret) else 0.0,
        pct_positive_months=float((monthly_ret > 0).mean()) if len(monthly_ret) else 0.0,
        sharpe=_annualized_ratio(daily_ret, downside_only=False),
        sortino=_annualized_ratio(daily_ret, downside_only=True),
        max_drawdown=max_dd,
        max_drawdown_duration_days=round(max_dd_dur, 1),
        n_trades=n_trades,
        win_rate=float((pnl > 0).mean()) if n_trades else 0.0,
        profit_factor=profit_factor,
        expectancy_r=float(trades["r_multiple"].mean()) if n_trades else 0.0,
        expectancy_usd=float(pnl.mean()) if n_trades else 0.0,
        avg_win_usd=float(wins.mean()) if len(wins) else 0.0,
        avg_loss_usd=float(losses.mean()) if len(losses) else 0.0,
        avg_bars_held=float(trades["bars_held"].mean()) if n_trades else 0.0,
        exposure=exposure,
        total_swap_paid=float(trades["swap_paid"].sum()) if n_trades else 0.0,
    )


def monthly_return_table(equity: pd.Series, initial_equity: float) -> pd.DataFrame:
    """Table année x mois des rendements mensuels (fractions), pour le rapport."""
    monthly = equity.resample("ME").last().dropna()
    ret = pd.concat([pd.Series([initial_equity]), monthly]).pct_change().dropna()
    ret.index = monthly.index
    df = pd.DataFrame({
        "year": ret.index.year,
        "month": ret.index.month,
        "ret": ret.to_numpy(),
    })
    return df.pivot(index="year", columns="month", values="ret").sort_index()
