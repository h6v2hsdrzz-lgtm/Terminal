"""Noise test : la stratégie survit-elle à un bruit de prix minuscule ?

On ajoute à chaque O/H/L/C un bruit gaussien d'écart-type ``atr_frac`` x ATR
(par défaut 10 % de l'ATR — bien plus petit que le moindre mouvement
exploitable), on répare la cohérence OHLC, et on relance le backtest avec
les paramètres PAR DÉFAUT. Une stratégie qui a un vrai edge doit rester
grossièrement profitable sur la quasi-totalité des runs bruités ; une
stratégie qui vit d'accidents précis de la série historique s'écroule.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Mapping

import numpy as np
import pandas as pd

from goldsilver.config import Config
from goldsilver.pipeline import run_backtest
from goldsilver.strategy.indicators import atr as atr_indicator

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class NoiseResult:
    base_sharpe: float
    base_total_return: float
    sharpes: np.ndarray
    total_returns: np.ndarray
    max_drawdowns: np.ndarray
    profitable_frac: float
    sharpe_median: float
    sharpe_retention: float      # médiane bruitée / base (nan si base <= 0)
    atr_frac: float
    n_runs: int


def perturb_ohlcv(df: pd.DataFrame, atr_frac: float, rng: np.random.Generator,
                  atr_period: int = 14) -> pd.DataFrame:
    """Bruite O/H/L/C puis restaure la cohérence high >= max(o,c), low <= min(o,c)."""
    a = atr_indicator(df, atr_period).bfill().to_numpy()
    sigma = atr_frac * a
    out = df.copy()
    o = df["open"].to_numpy() + rng.normal(0.0, sigma)
    c = df["close"].to_numpy() + rng.normal(0.0, sigma)
    h = df["high"].to_numpy() + rng.normal(0.0, sigma)
    l = df["low"].to_numpy() + rng.normal(0.0, sigma)
    h = np.maximum.reduce([h, o, c])
    l = np.minimum.reduce([l, o, c])
    floor = 1e-6
    out["open"], out["high"], out["low"], out["close"] = (
        np.maximum(o, floor), np.maximum(h, floor),
        np.maximum(l, floor), np.maximum(c, floor),
    )
    return out


def run_noise_test(market: Mapping[str, pd.DataFrame], cfg: Config) -> NoiseResult:
    base = run_backtest(market, cfg)
    n_cfg = cfg.validation.noise
    rng = np.random.default_rng(cfg.seed)
    sharpes, rets, dds = [], [], []
    atr_period = int(cfg.strategy.params.get("atr_period", 14))
    for k in range(n_cfg.n_runs):
        noisy = {
            a: perturb_ohlcv(df, n_cfg.atr_frac, rng, atr_period)
            for a, df in market.items()
        }
        rr = run_backtest(noisy, cfg)
        sharpes.append(rr.metrics.sharpe)
        rets.append(rr.metrics.total_return)
        dds.append(rr.metrics.max_drawdown)
        if (k + 1) % 20 == 0:
            log.info("Noise test : %d/%d runs", k + 1, n_cfg.n_runs)

    sharpes_a = np.asarray(sharpes)
    rets_a = np.asarray(rets)
    med = float(np.median(sharpes_a))
    return NoiseResult(
        base_sharpe=base.metrics.sharpe,
        base_total_return=base.metrics.total_return,
        sharpes=sharpes_a,
        total_returns=rets_a,
        max_drawdowns=np.asarray(dds),
        profitable_frac=float((rets_a > 0).mean()),
        sharpe_median=med,
        sharpe_retention=med / base.metrics.sharpe if base.metrics.sharpe > 0 else float("nan"),
        atr_frac=n_cfg.atr_frac,
        n_runs=n_cfg.n_runs,
    )
