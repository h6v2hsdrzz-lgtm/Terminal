"""Generate seeded synthetic OHLCV data for demos and tests.

Produces a 15-minute regime-switching series (trend + mean-reversion + jumps)
loosely calibrated to XAG/USD volatility. Deterministic for a given seed.

Usage: python scripts/make_sample_data.py [out_csv] [n_bars] [seed]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd


def make_ohlcv(
    n_bars: int = 20_000,
    seed: int = 42,
    start_price: float = 30.0,
    start: str = "2024-01-01",
    freq: str = "15min",
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=n_bars, freq=freq, tz="UTC")

    # Regime-switching drift + stochastic volatility.
    regime_len = rng.integers(300, 1500, size=n_bars // 300 + 2)
    drifts = rng.normal(0.0, 0.00006, size=len(regime_len))
    drift = np.repeat(drifts, regime_len)[:n_bars]
    vol = 0.0012 * np.exp(rng.normal(0.0, 0.3, n_bars).cumsum() * 0.01)
    vol = np.clip(vol, 0.0004, 0.004)

    rets = drift + rng.standard_t(df=4, size=n_bars) * vol / np.sqrt(2)
    jumps = rng.random(n_bars) < 0.001
    rets = rets + jumps * rng.normal(0.0, 0.008, n_bars)

    close = start_price * np.exp(np.cumsum(rets))
    open_ = np.empty(n_bars)
    open_[0] = start_price
    open_[1:] = close[:-1] * (1 + rng.normal(0.0, 0.0001, n_bars - 1))
    wick = np.abs(rng.normal(0.0, 1.0, n_bars)) * vol * close
    high = np.maximum(open_, close) + wick
    low = np.minimum(open_, close) - np.abs(rng.normal(0.0, 1.0, n_bars)) * vol * close
    volume = rng.lognormal(10.0, 0.5, n_bars)

    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=pd.Index(idx, name="timestamp"),
    )


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/samples/synthetic_15m.csv")
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 20_000
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 42
    df = make_ohlcv(n_bars=n, seed=seed)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out)
    print(f"wrote {len(df)} bars to {out}")


if __name__ == "__main__":
    main()
