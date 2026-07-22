"""Detrending : que reste-t-il de l'edge une fois la tendance de fond retirée ?

L'or a fortement monté sur la période d'étude. N'importe quelle stratégie
« long quand ça monte » paraît géniale dans ce régime. On retire la dérive
moyenne (drift log-linéaire estimé sur TOUTE la période, par actif) :

    p_detrended(t) = p(t) * exp(-mu * t)

puis on relance la stratégie avec les paramètres par défaut. Si la
performance vient d'un vrai timing (achats de replis mieux que le hasard),
il doit rester un edge positif ; si elle ne faisait que surfer la tendance,
la version détendue tombe à zéro ou en négatif.

À titre de contexte, le buy & hold de chaque actif est aussi mesuré sur les
données brutes ET détendues (le second doit être ~0 par construction).
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Mapping

import numpy as np
import pandas as pd

from goldsilver.config import Config
from goldsilver.pipeline import RunResult, run_backtest

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class DetrendResult:
    base: RunResult
    detrended: RunResult
    drift_annual_pct: dict[str, float]      # dérive retirée, par actif (% / an)
    buy_hold_return: dict[str, float]       # B&H brut par actif (fraction)
    buy_hold_detrended_return: dict[str, float]
    sharpe_drop: float                      # base - detrended
    residual_sharpe: float                  # Sharpe après detrend
    residual_monthly_mean: float


def detrend_ohlcv(df: pd.DataFrame) -> tuple[pd.DataFrame, float]:
    """Retire la dérive log-moyenne close-to-close ; retourne (df, mu_par_bougie)."""
    close = df["close"].to_numpy()
    log_ret = np.diff(np.log(close))
    mu = float(log_ret.mean()) if len(log_ret) else 0.0
    t = np.arange(len(df), dtype=np.float64)
    factor = np.exp(-mu * t)
    out = df.copy()
    for col in ("open", "high", "low", "close"):
        out[col] = df[col].to_numpy() * factor
    return out, mu


def run_detrend_test(market: Mapping[str, pd.DataFrame], cfg: Config) -> DetrendResult:
    base = run_backtest(market, cfg)

    detrended_market: dict[str, pd.DataFrame] = {}
    drift_annual: dict[str, float] = {}
    bh: dict[str, float] = {}
    bh_dt: dict[str, float] = {}
    for a, df in market.items():
        dt_df, mu = detrend_ohlcv(df)
        detrended_market[a] = dt_df
        days = max((df.index[-1] - df.index[0]).total_seconds() / 86400.0, 1e-9)
        bars_per_day = len(df) / days
        drift_annual[a] = (math.exp(mu * bars_per_day * 365.25) - 1.0) * 100.0
        bh[a] = float(df["close"].iloc[-1] / df["close"].iloc[0] - 1.0)
        bh_dt[a] = float(dt_df["close"].iloc[-1] / dt_df["close"].iloc[0] - 1.0)
        log.info("Detrend %s : dérive retirée %.1f %%/an (B&H brut %+.1f %%)",
                 a, drift_annual[a], 100 * bh[a])

    detrended = run_backtest(detrended_market, cfg)

    return DetrendResult(
        base=base,
        detrended=detrended,
        drift_annual_pct=drift_annual,
        buy_hold_return=bh,
        buy_hold_detrended_return=bh_dt,
        sharpe_drop=base.metrics.sharpe - detrended.metrics.sharpe,
        residual_sharpe=detrended.metrics.sharpe,
        residual_monthly_mean=detrended.metrics.monthly_mean,
    )
