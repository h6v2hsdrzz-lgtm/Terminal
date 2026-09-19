"""Noise test: perturb prices with seeded gaussian noise scaled to ATR,
re-run the backtest N times, and measure metric stability.

A real edge should survive small price perturbations; a strategy whose
expectancy flips sign under noise was fitted to the exact price path.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from quantbt.config import CostConfig, NoiseConfig, RiskConfig
from quantbt.data.loader import MarketData
from quantbt.strategy.base import Strategy
from quantbt.strategy.examples.ema_atr import atr
from quantbt.validation.common import Flag, ValidationOutcome, evaluate


def perturb_prices(data: MarketData, sigma_frac: float, atr_period: int,
                   rng: np.random.Generator) -> MarketData:
    """Add gaussian noise (sigma = sigma_frac * ATR) to OHLC, keeping bars valid.

    Higher-timeframe columns are rebuilt from the noisy base frame so the
    strategy sees a consistent world.
    """
    df = data.frame
    base_cols = ["open", "high", "low", "close"]
    a = atr(df, atr_period).bfill().to_numpy(float)
    noisy = df.copy()
    for col in base_cols:
        noise = rng.normal(0.0, 1.0, len(df)) * a * sigma_frac
        noisy[col] = df[col].to_numpy(float) + noise
    # Restore OHLC consistency after independent perturbation.
    noisy["high"] = noisy[base_cols].max(axis=1)
    noisy["low"] = noisy[base_cols].min(axis=1)

    from quantbt.data.resample import align_multi_tf, resample_ohlcv

    base = noisy[["open", "high", "low", "close", "volume"]]
    frame = base.copy()
    for tf in data.extra_timeframes:
        ht = resample_ohlcv(base, tf)
        frame = align_multi_tf(frame, ht, tf, suffix=f"_{tf}")
    return MarketData(frame, data.base_timeframe, data.extra_timeframes)


def run_noise(
    data: MarketData,
    strategy: Strategy,
    costs: CostConfig,
    risk: RiskConfig,
    cfg: NoiseConfig,
) -> ValidationOutcome:
    rng = np.random.default_rng(cfg.seed)
    base_m = evaluate(data, strategy, costs, risk)

    rows = []
    for _ in range(cfg.n_runs):
        noisy = perturb_prices(data, cfg.noise_atr_frac, cfg.atr_period, rng)
        m = evaluate(noisy, strategy, costs, risk)
        rows.append(m.as_dict())
    dist = pd.DataFrame(rows)

    exp = dist["expectancy_r"]
    sign_stable = float((np.sign(exp) == np.sign(base_m.expectancy_r)).mean()) \
        if base_m.expectancy_r != 0 else 0.0
    mean_exp = float(exp.mean())
    std_exp = float(exp.std())
    cv = abs(std_exp / mean_exp) if mean_exp != 0 else float("inf")

    flags: list[Flag] = []
    if base_m.expectancy_r > 0 and mean_exp <= 0:
        flags.append(Flag("noise.edge", "fail",
                          f"expectancy {base_m.expectancy_r:.2f}R collapses to "
                          f"{mean_exp:.2f}R under noise — fitted to the exact path", mean_exp))
    elif sign_stable < 0.7:
        flags.append(Flag("noise.stability", "warn",
                          f"expectancy keeps its sign in only {sign_stable:.0%} of noisy runs",
                          sign_stable))
    elif cv > cfg.max_metric_cv:
        flags.append(Flag("noise.dispersion", "warn",
                          f"expectancy CV {cv:.2f} exceeds {cfg.max_metric_cv}", cv))
    else:
        flags.append(Flag("noise.stability", "pass",
                          f"sign stable in {sign_stable:.0%} of runs, CV {cv:.2f}", sign_stable))

    return ValidationOutcome(
        module="noise",
        flags=flags,
        payload={
            "baseline": base_m.as_dict(),
            "distribution": dist,
            "sign_stability": sign_stable,
            "cv_expectancy": cv,
        },
    )
