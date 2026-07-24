"""PaperBroker : fills aux vrais prix cotés, SL/TP simulés comme le backtest."""

from __future__ import annotations

import math

import pandas as pd

from goldsilver.live.broker.paper import PaperBroker, default_paper_state
from tests.live_fakes import FakeDataSource, hourly_candles


def _mk(quote=(99.9, 100.1)) -> tuple[PaperBroker, dict, FakeDataSource]:
    candles = {"XAU_USD": hourly_candles(50)}
    src = FakeDataSource(candles, {"XAU_USD": quote})
    state = default_paper_state(10_000.0)
    return PaperBroker(src, state), state, src


def test_long_fills_at_ask_short_at_bid() -> None:
    broker, state, _ = _mk()
    r = broker.place_market_order("XAU_USD", 20, 95.1, 115.1, "t")
    assert r.accepted and math.isclose(r.fill_price, 100.1)   # ask
    broker.close_position("XAU_USD")
    r2 = broker.place_market_order("XAU_USD", -20, 105.0, 85.0, "t")
    assert math.isclose(r2.fill_price, 99.9)                  # bid


def test_no_pyramiding() -> None:
    broker, _, _ = _mk()
    assert broker.place_market_order("XAU_USD", 10, 95, 115, "t").accepted
    r = broker.place_market_order("XAU_USD", 10, 95, 115, "t")
    assert not r.accepted


def test_simulate_sl_hit_exact(monkeypatch) -> None:
    broker, state, _ = _mk()
    broker.place_market_order("XAU_USD", 20, 95.0, 115.0, "t")
    entry_time = pd.Timestamp(state["positions"]["XAU_USD"]["entry_time"])
    after = hourly_candles(3, price=97.0, start=str(entry_time.floor("1h")))
    after.iloc[1, after.columns.get_loc("low")] = 94.5        # touche le SL 95
    closed = broker.simulate_fills("XAU_USD", after)
    assert len(closed) == 1
    c = closed[0]
    assert math.isclose(c.close_price, 95.0)                  # stop au prix du stop
    assert math.isclose(c.realized_pnl, 20 * (95.0 - 100.1))
    assert math.isclose(state["cash"], 10_000.0 + c.realized_pnl)
    assert state["positions"] == {}


def test_simulate_gap_through_sl_fills_at_open() -> None:
    broker, state, _ = _mk()
    broker.place_market_order("XAU_USD", 20, 95.0, 115.0, "t")
    entry_time = pd.Timestamp(state["positions"]["XAU_USD"]["entry_time"])
    after = hourly_candles(2, price=90.0, start=str(entry_time.floor("1h")))
    after.iloc[0, after.columns.get_loc("open")] = 92.0       # gap sous le stop
    closed = broker.simulate_fills("XAU_USD", after)
    assert math.isclose(closed[0].close_price, 92.0)          # pire que le stop


def test_simulate_tp_hit() -> None:
    broker, state, _ = _mk()
    broker.place_market_order("XAU_USD", 20, 95.0, 115.0, "t")
    entry_time = pd.Timestamp(state["positions"]["XAU_USD"]["entry_time"])
    after = hourly_candles(2, price=113.0, start=str(entry_time.floor("1h")))
    after.iloc[1, after.columns.get_loc("high")] = 115.5
    closed = broker.simulate_fills("XAU_USD", after)
    assert math.isclose(closed[0].close_price, 115.0)
    assert math.isclose(closed[0].realized_pnl, 20 * (115.0 - 100.1))


def test_short_exit_uses_ask_side() -> None:
    broker, state, _ = _mk()
    broker.place_market_order("XAU_USD", -20, 105.0, 85.0, "t")   # short @ 99.9
    entry_time = pd.Timestamp(state["positions"]["XAU_USD"]["entry_time"])
    after = hourly_candles(2, price=104.5, start=str(entry_time.floor("1h")),
                           spread=0.4)
    after.iloc[1, after.columns.get_loc("high")] = 104.7          # ask = 105.1 >= SL
    closed = broker.simulate_fills("XAU_USD", after)
    assert closed and math.isclose(closed[0].close_price, 105.0)
    assert math.isclose(closed[0].realized_pnl, -20 * (105.0 - 99.9))


def test_account_equity_marks_open_position() -> None:
    broker, state, src = _mk()
    broker.place_market_order("XAU_USD", 20, 95.0, 115.0, "t")    # entry 100.1
    src.quotes["XAU_USD"] = (103.0, 103.2)
    acct = broker.get_account()
    assert math.isclose(acct.equity, 10_000.0 + 20 * (103.0 - 100.1))
