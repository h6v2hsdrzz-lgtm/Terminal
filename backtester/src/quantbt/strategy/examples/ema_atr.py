"""Example strategy to exercise the pipeline — not investment advice.

EMA cross on the base timeframe, optional higher-TF trend filter,
ATR-based stop-loss and take-profit at a fixed R:R multiple.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from quantbt.data.loader import MarketData
from quantbt.strategy.base import Signals, Strategy
from quantbt.strategy.registry import register


def atr(df: pd.DataFrame, period: int) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


@register
class EmaAtrStrategy(Strategy):
    name = "ema_atr"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {
            "fast": 20,
            "slow": 50,
            "atr_period": 14,
            "sl_atr_mult": 1.5,
            "rr": 3.0,
            "trend_tf": "1h",  # "" disables the higher-TF filter
            "trend_ema": 50,
        }

    @classmethod
    def default_param_grid(cls) -> dict[str, list[Any]]:
        return {
            "fast": [10, 15, 20, 30, 40],
            "slow": [40, 50, 75, 100, 150],
            "sl_atr_mult": [1.0, 1.5, 2.0, 2.5],
        }

    def generate_signals(self, data: MarketData) -> Signals:
        p = self.params
        df = data.frame
        fast = df["close"].ewm(span=int(p["fast"]), adjust=False).mean()
        slow = df["close"].ewm(span=int(p["slow"]), adjust=False).mean()
        cross_up = (fast > slow) & (fast.shift(1) <= slow.shift(1))
        cross_dn = (fast < slow) & (fast.shift(1) >= slow.shift(1))

        long_ok = pd.Series(True, index=df.index)
        short_ok = pd.Series(True, index=df.index)
        tf = str(p["trend_tf"])
        htf_close = f"close_{tf}"
        if tf and htf_close in df.columns:
            trend = df[htf_close].ewm(span=int(p["trend_ema"]), adjust=False).mean()
            long_ok = df[htf_close] > trend
            short_ok = df[htf_close] < trend

        a = atr(df, int(p["atr_period"]))
        sl_dist = a * float(p["sl_atr_mult"])
        rr = float(p["rr"])

        signal = np.where(cross_up & long_ok, 1, np.where(cross_dn & short_ok, -1, 0))
        close = df["close"]
        sl = np.where(signal == 1, close - sl_dist, np.where(signal == -1, close + sl_dist, np.nan))
        tp = np.where(
            signal == 1, close + rr * sl_dist, np.where(signal == -1, close - rr * sl_dist, np.nan)
        )
        out = pd.DataFrame({"signal": signal, "sl": sl, "tp": tp}, index=df.index)
        # No signal while indicators warm up.
        warmup = max(int(p["slow"]), int(p["atr_period"])) + 1
        out.iloc[:warmup, out.columns.get_loc("signal")] = 0
        return out
