"""Fixtures partagées des tests."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crypto_algo.config import load_config
from crypto_algo.data.loader import MarketData, synthetic_market_data, synthetic_ohlcv
from crypto_algo.utils import dt_to_ms


@pytest.fixture()
def cfg():
    """Configuration de test : coûts réels, univers réduit, warmup court."""
    return load_config(
        overrides={
            "universe.symbols": ["BTC/USDT:USDT"],
            "backtest.warmup_bars": 50,
            "risk.initial_equity": 10_000.0,
            "execution.rejects.enabled": False,   # déterminisme des tests
            "execution.latency.enabled": False,
        }
    )


@pytest.fixture()
def md(cfg):
    return synthetic_market_data(
        symbols=["BTC/USDT:USDT"], timeframes=["5m"], n_bars=3000, exec_timeframe="5m", seed=11
    )


@pytest.fixture()
def ohlcv():
    return synthetic_ohlcv(n_bars=1500, timeframe="5m", seed=5)


def make_bars(prices, timeframe_ms=300_000, start_ms=1_600_000_000_000, volume=1000.0):
    """Construit un DataFrame OHLCV depuis une liste de (o, h, l, c)."""
    rows = []
    for i, (o, h, l, c) in enumerate(prices):
        rows.append(
            {
                "timestamp": start_ms + i * timeframe_ms,
                "open": o, "high": h, "low": l, "close": c, "volume": volume,
            }
        )
    df = pd.DataFrame(rows)
    df.index = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df.index.name = "dt"
    return df


def market_from_bars(df, symbol="BTC/USDT:USDT", timeframe="5m", funding_rate=0.0):
    md = MarketData(symbols=[symbol], split="test")
    md.ohlcv[(symbol, timeframe)] = df
    md.mark[symbol] = df.copy()
    md.index[symbol] = df.copy()
    f_idx = pd.date_range(df.index.min().floor("8h"), df.index.max(), freq="8h", tz="UTC")
    md.funding[symbol] = pd.DataFrame(
        {
            "timestamp": dt_to_ms(f_idx),
            "funding_rate": np.full(len(f_idx), funding_rate),
        },
        index=f_idx,
    )
    md.open_interest[symbol] = pd.DataFrame()
    return md
