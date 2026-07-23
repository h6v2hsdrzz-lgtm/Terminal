"""Doublures de test pour le moteur live : broker scripté + stratégie triviale."""

from __future__ import annotations

from typing import Any, ClassVar, Mapping

import numpy as np
import pandas as pd

from goldsilver.live.broker.base import (
    AccountState,
    BrokerAdapter,
    BrokerPosition,
    ClosedTrade,
    OrderResult,
    Quote,
)
from goldsilver.strategy.base import Strategy, register


class FakeDataSource(BrokerAdapter):
    """Source de données scriptée : bougies et cotations fixées par le test."""

    name = "fake"

    def __init__(self, candles: dict[str, pd.DataFrame],
                 quotes: dict[str, tuple[float, float]],
                 tradeable: bool = True) -> None:
        self.candles = candles
        self.quotes = quotes
        self.tradeable = tradeable
        self.orders: list[dict[str, Any]] = []

    def get_candles(self, instrument: str, hours: int) -> pd.DataFrame:
        return self.candles[instrument].tail(hours)

    def get_quote(self, instrument: str) -> Quote:
        bid, ask = self.quotes[instrument]
        ts = self.candles[instrument].index[-1] + pd.Timedelta(minutes=5)
        return Quote(instrument, bid, ask, ts, self.tradeable)

    def get_account(self) -> AccountState:
        return AccountState(10_000.0, 10_000.0, 10_000.0, "USD")

    def get_open_positions(self) -> list[BrokerPosition]:
        return []

    def place_market_order(self, instrument: str, units: float, sl_price: float,
                           tp_price: float, client_tag: str) -> OrderResult:
        self.orders.append({"instrument": instrument, "units": units,
                            "sl": sl_price, "tp": tp_price, "tag": client_tag})
        bid, ask = self.quotes[instrument]
        return OrderResult(True, str(len(self.orders)),
                           ask if units > 0 else bid, units, "filled")

    def close_position(self, instrument: str) -> OrderResult:
        return OrderResult(True, None, None, 0.0, "déjà plat")

    def get_closed_trades_since(self, since_trade_id: str | None) -> list[ClosedTrade]:
        return []


@register
class AlwaysLongStrategy(Strategy):
    """Signale un long sur la DERNIÈRE bougie — pour tester le moteur, pas la strat."""

    name: ClassVar[str] = "test_always_long"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {"sl_dist": 5.0, "tp_dist": 15.0, "max_bars_held": 100}

    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        base = next(iter(tfs.values()))
        out = base.copy()
        out["signal"] = np.zeros(len(base), dtype=np.int8)
        out.iloc[-1, out.columns.get_loc("signal")] = 1
        out["sl_dist"] = float(self.params["sl_dist"])
        out["tp_dist"] = float(self.params["tp_dist"])
        return out


def hourly_candles(n: int, price: float = 100.0, rising: float = 0.0,
                   start: str = "2026-06-01", spread: float = 0.2) -> pd.DataFrame:
    idx = pd.date_range(start, periods=n, freq="1h", tz="UTC")
    close = price + rising * np.arange(n)
    open_ = np.concatenate([[close[0]], close[:-1]])
    return pd.DataFrame(
        {"open": open_, "high": np.maximum(open_, close) + 0.3,
         "low": np.minimum(open_, close) - 0.3, "close": close,
         "volume": np.full(n, 10.0), "spread": np.full(n, spread)},
        index=idx,
    )
