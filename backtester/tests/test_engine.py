from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from quantbt.config import CostConfig, RiskConfig, SpreadConfig
from quantbt.data.loader import MarketData
from quantbt.engine.backtester import run_backtest
from quantbt.engine.costs import fill_price
from quantbt.engine.sizing import position_size
from quantbt.strategy.base import Strategy


class ScriptedStrategy(Strategy):
    """Emits a fixed signal frame — lets tests control the engine exactly."""

    name = "scripted"

    def __init__(self, signals: pd.DataFrame, **params):
        super().__init__(**params)
        self._signals = signals

    def generate_signals(self, data: MarketData) -> pd.DataFrame:
        return self._signals.reindex(data.frame.index).fillna({"signal": 0})


def make_data(prices: list[tuple[float, float, float, float]]) -> MarketData:
    idx = pd.date_range("2024-01-01", periods=len(prices), freq="15min", tz="UTC")
    df = pd.DataFrame(prices, columns=["open", "high", "low", "close"], index=idx)
    df["volume"] = 1.0
    return MarketData(df, "15min", ())


def signals_frame(index, entries: dict[int, tuple[int, float, float]]) -> pd.DataFrame:
    sig = pd.DataFrame({"signal": 0, "sl": np.nan, "tp": np.nan}, index=index)
    for i, (s, sl, tp) in entries.items():
        sig.iloc[i] = [s, sl, tp]
    return sig


def test_entry_executes_next_bar_open(zero_cost_cfg, risk_cfg):
    data = make_data([(100, 101, 99, 100), (102, 103, 101, 102), (102, 103, 101, 102),
                      (102, 103, 101, 102)])
    sig = signals_frame(data.frame.index, {0: (1, 95.0, 115.0)})
    res = run_backtest(data, ScriptedStrategy(sig), zero_cost_cfg, risk_cfg)
    assert len(res.trades) == 1
    # Signal on bar 0 → entry at bar 1 open (102), not at bar 0 close.
    assert res.trades.iloc[0]["entry"] == pytest.approx(102.0)


def test_tp_hit_pays_expected_r_multiple(zero_cost_cfg, risk_cfg):
    # Long from 100, SL 98 (dist 2), TP 106 (3R). TP hit on bar 2.
    data = make_data([(100, 100.5, 99.5, 100), (100, 100.5, 99.0, 100),
                      (100, 107, 99.0, 106), (106, 106, 105, 105.5)])
    sig = signals_frame(data.frame.index, {0: (1, 98.0, 106.0)})
    res = run_backtest(data, ScriptedStrategy(sig), zero_cost_cfg, risk_cfg)
    t = res.trades.iloc[0]
    assert t["reason"] == "tp"
    assert t["r_multiple"] == pytest.approx(3.0, rel=1e-6)
    # 1% risk on 10k = 100 risked, 3R = +300.
    assert t["pnl"] == pytest.approx(300.0, rel=1e-6)


def test_pessimistic_rule_sl_wins_when_both_hit(zero_cost_cfg, risk_cfg):
    # Bar 2 spans both SL (98) and TP (106): the stop must be assumed first.
    data = make_data([(100, 100.5, 99.5, 100), (100, 100.5, 99.0, 100),
                      (100, 107, 97, 100), (100, 101, 99, 100)])
    sig = signals_frame(data.frame.index, {0: (1, 98.0, 106.0)})
    res = run_backtest(data, ScriptedStrategy(sig), zero_cost_cfg, risk_cfg)
    assert res.trades.iloc[0]["reason"] == "sl"
    assert res.trades.iloc[0]["r_multiple"] == pytest.approx(-1.0, rel=1e-6)


def test_gap_through_stop_fills_at_open(zero_cost_cfg, risk_cfg):
    # Price gaps from 100 to 95 — below the 98 stop; fill must be 95, not 98.
    data = make_data([(100, 100.5, 99.5, 100), (100, 100.5, 99.0, 100),
                      (95, 96, 94, 95), (95, 96, 94, 95)])
    sig = signals_frame(data.frame.index, {0: (1, 98.0, 106.0)})
    res = run_backtest(data, ScriptedStrategy(sig), zero_cost_cfg, risk_cfg)
    t = res.trades.iloc[0]
    assert t["reason"] == "sl"
    assert t["exit"] == pytest.approx(95.0)
    assert t["r_multiple"] < -1.0  # worse than planned risk


def test_short_side_symmetric(zero_cost_cfg, risk_cfg):
    data = make_data([(100, 100.5, 99.5, 100), (100, 100.5, 99.0, 100),
                      (100, 100.5, 93, 94), (94, 95, 93, 94)])
    sig = signals_frame(data.frame.index, {0: (-1, 102.0, 94.0)})
    res = run_backtest(data, ScriptedStrategy(sig), zero_cost_cfg, risk_cfg)
    t = res.trades.iloc[0]
    assert t["side"] == -1
    assert t["reason"] == "tp"
    assert t["pnl"] > 0


def test_costs_reduce_pnl(risk_cfg, cost_cfg, zero_cost_cfg):
    data = make_data([(100, 100.5, 99.5, 100), (100, 100.5, 99.0, 100),
                      (100, 107, 99.0, 106), (106, 106, 105, 105.5)])
    sig = signals_frame(data.frame.index, {0: (1, 98.0, 106.0)})
    free = run_backtest(data, ScriptedStrategy(sig), zero_cost_cfg, risk_cfg)
    paid = run_backtest(data, ScriptedStrategy(sig), cost_cfg, risk_cfg)
    assert paid.trades.iloc[0]["pnl"] < free.trades.iloc[0]["pnl"]


def test_pessimistic_spread_multiplier_worsens_fill():
    cfg1 = CostConfig(spread=SpreadConfig("pct", 0.001, 1.0))
    cfg2 = CostConfig(spread=SpreadConfig("pct", 0.001, 2.0))
    assert fill_price(100.0, 1, cfg2) > fill_price(100.0, 1, cfg1)
    assert fill_price(100.0, -1, cfg2) < fill_price(100.0, -1, cfg1)


def test_min_rr_filter_rejects_low_rr_entries(zero_cost_cfg):
    risk = RiskConfig(initial_capital=10_000, risk_pct=0.01, max_leverage=10, min_rr=3.0)
    data = make_data([(100, 101, 99, 100)] * 5)
    # RR = (104-100)/(100-98) = 2 < 3 → rejected.
    sig = signals_frame(data.frame.index, {0: (1, 98.0, 104.0)})
    res = run_backtest(data, ScriptedStrategy(sig), zero_cost_cfg, risk)
    assert len(res.trades) == 0


def test_position_size_risks_fixed_fraction():
    cfg = RiskConfig(initial_capital=10_000, risk_pct=0.02, max_leverage=100, min_rr=0)
    qty = position_size(10_000, 100.0, 98.0, cfg)
    assert qty * 2.0 == pytest.approx(200.0)  # 2% of 10k


def test_position_size_leverage_cap():
    cfg = RiskConfig(initial_capital=10_000, risk_pct=0.05, max_leverage=2, min_rr=0)
    qty = position_size(10_000, 100.0, 99.9, cfg)  # tiny stop → huge raw size
    assert qty * 100.0 <= 10_000 * 2 + 1e-9


def test_equity_curve_consistent_with_trades(market_data, cost_cfg, risk_cfg):
    from quantbt.strategy.examples.ema_atr import EmaAtrStrategy

    res = run_backtest(market_data, EmaAtrStrategy(rr=2.0), cost_cfg, risk_cfg)
    assert len(res.trades) > 3
    final = res.equity.iloc[-1]
    assert final == pytest.approx(risk_cfg.initial_capital + res.trades["pnl"].sum(), rel=1e-9)


def test_no_lookahead_signals_after_data_truncation(market_data, cost_cfg, risk_cfg):
    """Signals on the common prefix must be identical when future data is removed."""
    from quantbt.strategy.examples.ema_atr import EmaAtrStrategy

    strat = EmaAtrStrategy()
    full = strat.generate_signals(market_data)
    cut = market_data.with_frame(market_data.frame.iloc[:4000])
    partial = strat.generate_signals(cut)
    pd.testing.assert_frame_equal(full.iloc[:4000], partial)
