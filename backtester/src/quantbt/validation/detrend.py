"""Detrending test: remove the underlying drift and check the edge survives.

A long-only strategy on a bull market can look brilliant while capturing
nothing but beta. We remove the exponential (log-linear) trend from prices,
re-run the identical strategy, and compare expectancy. A real timing edge
keeps a meaningful share of its expectancy on detrended data.
"""

from __future__ import annotations

import numpy as np

from quantbt.config import CostConfig, DetrendConfig, RiskConfig
from quantbt.data.loader import MarketData
from quantbt.strategy.base import Strategy
from quantbt.validation.common import Flag, ValidationOutcome, evaluate


def detrend_prices(data: MarketData) -> MarketData:
    """Divide OHLC by the fitted exponential trend of the close.

    Fitting log(close) ~ a + b*t and dividing all price columns by exp(b*t)
    preserves relative bar shapes (and thus most signal geometry) while
    flattening the long-run drift to zero.
    """
    df = data.frame
    t = np.arange(len(df), dtype=float)
    logc = np.log(df["close"].to_numpy(float))
    b, a = np.polyfit(t, logc, 1)
    trend = np.exp(b * t)  # keep intercept so price scale is preserved
    _ = a

    out = df.copy()
    for col in ["open", "high", "low", "close"]:
        out[col] = df[col].to_numpy(float) / trend

    from quantbt.data.resample import align_multi_tf, resample_ohlcv

    base = out[["open", "high", "low", "close", "volume"]]
    frame = base.copy()
    for tf in data.extra_timeframes:
        ht = resample_ohlcv(base, tf)
        frame = align_multi_tf(frame, ht, tf, suffix=f"_{tf}")
    return MarketData(frame, data.base_timeframe, data.extra_timeframes)


def run_detrend(
    data: MarketData,
    strategy: Strategy,
    costs: CostConfig,
    risk: RiskConfig,
    cfg: DetrendConfig,
) -> ValidationOutcome:
    raw = evaluate(data, strategy, costs, risk)
    det = evaluate(detrend_prices(data), strategy, costs, risk)

    edge_ratio = (det.expectancy_r / raw.expectancy_r) if raw.expectancy_r > 0 else float("nan")

    flags: list[Flag] = []
    if raw.expectancy_r <= 0:
        flags.append(Flag("detrend.baseline", "warn",
                          "raw expectancy is non-positive; detrend test not informative",
                          raw.expectancy_r))
    elif det.expectancy_r <= 0:
        flags.append(Flag("detrend.beta", "fail",
                          f"edge vanishes on detrended data ({det.expectancy_r:.2f}R vs "
                          f"{raw.expectancy_r:.2f}R) — performance is market beta, not alpha",
                          edge_ratio))
    elif edge_ratio < cfg.min_edge_ratio:
        flags.append(Flag("detrend.beta", "warn",
                          f"only {edge_ratio:.0%} of expectancy survives detrending "
                          f"(threshold {cfg.min_edge_ratio:.0%})", edge_ratio))
    else:
        flags.append(Flag("detrend.beta", "pass",
                          f"{edge_ratio:.0%} of expectancy survives detrending", edge_ratio))

    return ValidationOutcome(
        module="detrend",
        flags=flags,
        payload={"raw": raw.as_dict(), "detrended": det.as_dict(), "edge_ratio": edge_ratio},
    )
