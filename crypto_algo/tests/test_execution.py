"""Réalisme d'exécution (§7) : fills, coûts, funding, liquidation, intrabar."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crypto_algo.backtest.engine import BacktestEngine
from crypto_algo.backtest.portfolio import Position
from crypto_algo.config import load_config
from crypto_algo.execution.costs import CostModel, FundingModel
from crypto_algo.execution.simulator import ExecutionSimulator, Order
from crypto_algo.strategies.base import Strategy
from crypto_algo.tests.conftest import make_bars, market_from_bars
from crypto_algo.utils import dt_to_ms


class ScriptedStrategy(Strategy):
    """Signaux fournis explicitement, barre par barre."""

    name = "scripted"

    def __init__(self, signals, stops, take_profits=None, symbol="BTC/USDT:USDT"):
        super().__init__(None)
        self.signals = signals
        self.stops = stops
        self.take_profits = take_profits
        self.symbol = symbol

    def prepare(self, md, cfg):
        tf = cfg.get_path("data.execution_timeframe")
        df = md.get(self.symbol, tf)
        dec = self.empty_decisions(df.index)
        dec["signal"] = self.signals[: len(df)]
        dec["stop_price"] = self.stops[: len(df)]
        if self.take_profits is not None:
            dec["take_profit"] = self.take_profits[: len(df)]
        dec["atr_pct"] = 0.01
        self._decisions[self.symbol] = dec


def base_cfg(**overrides):
    base = {
        "universe.symbols": ["BTC/USDT:USDT"],
        "backtest.warmup_bars": 0,
        "risk.initial_equity": 10_000.0,
        "execution.rejects.enabled": False,
        "execution.latency.enabled": False,
        "execution.slippage.spread_bps": 0.0,
        "execution.slippage.vol_coefficient": 0.0,
        "execution.slippage.impact_coefficient": 0.0,
        "execution.funding.enabled": False,
        "data.execution_timeframe": "5m",
        "data.intrabar_timeframe": "1m",
    }
    base.update(overrides)
    return load_config(overrides=base)


# ------------------------------------------------------------------- fills
def test_fill_happens_at_next_bar_open_not_at_signal_price():
    """Le signal est calculé sur la clôture de N, le fill a lieu à l'ouverture de N+1."""
    bars = make_bars([(100, 101, 99, 100), (102, 103, 101.5, 102), (102, 103, 101.5, 102),
                      (102, 103, 101.5, 102)])
    md = market_from_bars(bars)
    cfg = base_cfg()
    signals = [1.0, 1.0, 1.0, 1.0]
    stops = [95.0, 95.0, 95.0, 95.0]
    engine = BacktestEngine(cfg, md, ScriptedStrategy(signals, stops))
    engine.run()
    trades = engine.portfolio.trades_frame()
    # le signal naît sur la clôture de la barre 0 (100) ; le fill a lieu à
    # l'ouverture de la barre 1 (102), jamais au prix qui a généré le signal.
    assert len(trades) == 1
    assert trades["entry_price"].iloc[0] == pytest.approx(102.0, rel=1e-9)


def test_adverse_gap_invalidates_the_setup_at_fill_time():
    """Si le prix a sauté au point de rendre le stop aberrant, l'ordre est refusé
    à l'exécution — le moteur ne « rattrape » pas le niveau."""
    bars = make_bars([(100, 101, 99, 100), (140, 141, 139, 140), (140, 141, 139, 140)])
    md = market_from_bars(bars)
    engine = BacktestEngine(base_cfg(), md, ScriptedStrategy([1.0] * 3, [95.0] * 3))
    res = engine.run()
    assert len(res.trades) == 0
    assert (res.rejections["code"] == "stop_too_wide").any()


def test_slippage_is_always_adverse():
    cfg = load_config()
    costs = CostModel(cfg)
    buy = costs.apply(100.0, "buy", 1.0, atr_pct=0.02, bar_volume_notional=1e6)
    sell = costs.apply(100.0, "sell", 1.0, atr_pct=0.02, bar_volume_notional=1e6)
    assert buy.fill_price > 100.0
    assert sell.fill_price < 100.0
    assert buy.fee > 0 and sell.fee > 0


def test_slippage_components_are_additive_and_capped():
    cfg = load_config()
    costs = CostModel(cfg)
    spread_only = costs.slippage_pct(atr_pct=0.0, size_notional=0.0, bar_volume_notional=0.0)
    with_vol = costs.slippage_pct(atr_pct=0.05, size_notional=0.0, bar_volume_notional=0.0)
    with_impact = costs.slippage_pct(atr_pct=0.05, size_notional=1e6, bar_volume_notional=1e6)
    assert spread_only < with_vol < with_impact
    assert with_impact <= costs.max_slippage


def test_cost_stress_multiplier_scales_fees_and_slippage():
    cfg = load_config()
    normal, stressed = CostModel(cfg, 1.0), CostModel(cfg, 2.0)
    assert stressed.taker == pytest.approx(2 * normal.taker)
    assert stressed.slippage_pct(0.01, 0, 0) == pytest.approx(2 * normal.slippage_pct(0.01, 0, 0))


def test_order_rejects_are_simulated():
    cfg = load_config(overrides={"execution.rejects.enabled": True, "execution.rejects.probability": 1.0})
    sim = ExecutionSimulator(cfg, rng=np.random.default_rng(0))
    bar = pd.Series({"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 10.0})
    order = Order(ts=pd.Timestamp("2024-01-01", tz="UTC"), symbol="BTC", side="buy",
                  quantity=1.0, intent="open_long", stop_loss=95.0)
    assert sim.execute(order, bar) is None


def test_latency_pushes_fill_against_the_order():
    cfg = load_config(overrides={"execution.rejects.enabled": False,
                                 "execution.slippage.spread_bps": 0.0,
                                 "execution.slippage.vol_coefficient": 0.0,
                                 "execution.slippage.impact_coefficient": 0.0})
    sim = ExecutionSimulator(cfg, rng=np.random.default_rng(0))
    bar = pd.Series({"open": 100.0, "high": 110.0, "low": 90.0, "close": 100.0, "volume": 10.0})
    order = Order(ts=pd.Timestamp("2024-01-01", tz="UTC"), symbol="BTC", side="buy",
                  quantity=1.0, intent="open_long", stop_loss=95.0)
    fill = sim.execute(order, bar)
    assert fill.latency_ms >= 200.0
    assert fill.price > 100.0


# ----------------------------------------------------------------- funding
def test_funding_is_charged_every_8h_with_correct_sign():
    cfg = load_config()
    idx = pd.date_range("2024-01-01", periods=6, freq="8h", tz="UTC")
    funding = {
        "BTC": pd.DataFrame(
            {"timestamp": dt_to_ms(idx), "funding_rate": 0.0005},
            index=idx,
        )
    }
    fm = FundingModel(cfg, funding)
    stamps = fm.settlements_between(pd.Timestamp("2024-01-01 00:00", tz="UTC"),
                                    pd.Timestamp("2024-01-02 00:00", tz="UTC"))
    assert len(stamps) == 3
    # funding positif : le long paie, le short reçoit
    assert fm.payment("BTC", stamps[0], "long", 10_000) == pytest.approx(-5.0)
    assert fm.payment("BTC", stamps[0], "short", 10_000) == pytest.approx(5.0)


def test_funding_cost_appears_in_backtest_pnl():
    """Une position tenue plusieurs cycles paie effectivement le funding."""
    n = 60
    bars = make_bars([(100, 100.5, 99.5, 100)] * n, timeframe_ms=3_600_000)
    md = market_from_bars(bars, timeframe="1h", funding_rate=0.001)
    cfg = base_cfg(**{"execution.funding.enabled": True, "data.execution_timeframe": "1h"})
    signals = [1.0] * n
    stops = [90.0] * n
    engine = BacktestEngine(cfg, md, ScriptedStrategy(signals, stops))
    res = engine.run()
    assert res.stats["total_funding"] < 0
    assert res.final_equity < 10_000.0


# ------------------------------------------------------------- liquidation
def test_liquidation_price_formula_long_and_short():
    cfg = load_config()
    from crypto_algo.risk.engine import RiskEngine

    eng = RiskEngine(cfg)
    entry, qty = 100.0, 10.0
    margin = qty * entry / 10.0                      # levier 10
    liq_long = eng.liquidation_price("long", entry, qty, margin)
    liq_short = eng.liquidation_price("short", entry, qty, margin)
    assert 88.0 < liq_long < 91.0                    # ~ -10 % ajusté mmr/frais
    assert 109.0 < liq_short < 112.0


def test_liquidation_happens_even_when_stop_is_further():
    """Gap violent : le mark price traverse le prix de liquidation. Le stop ne
    protège pas — le backtest doit enregistrer une liquidation."""
    from crypto_algo.execution.simulator import ExecutionSimulator

    cfg = load_config()
    sim = ExecutionSimulator(cfg)
    pos = Position(
        symbol="BTC", side="long", quantity=10.0, entry_price=100.0, margin=100.0,
        leverage=10.0, stop_loss=85.0, take_profit=120.0, liquidation_price=90.5,
        opened_at=pd.Timestamp("2024-01-01", tz="UTC"),
    )
    bar = pd.Series({"open": 100.0, "high": 100.0, "low": 86.0, "close": 88.0, "volume": 10.0})
    event = sim.resolve_exit(pos, bar, bar, pd.Timestamp("2024-01-01 00:05", tz="UTC"))
    assert event is not None and event.kind == "liquidation"


def test_liquidation_loses_the_isolated_margin():
    from crypto_algo.backtest.portfolio import Portfolio

    pf = Portfolio(10_000.0)
    pos = Position(
        symbol="BTC", side="long", quantity=10.0, entry_price=100.0, margin=100.0,
        leverage=10.0, stop_loss=85.0, take_profit=None, liquidation_price=90.5,
        opened_at=pd.Timestamp("2024-01-01", tz="UTC"), risk_amount=50.0,
    )
    pf.open_position(pos, fee=0.5, slippage_cost=0.0)
    trade = pf.close_position("BTC", 90.5, pd.Timestamp("2024-01-01 01:00", tz="UTC"),
                              fee=0.45, slippage_cost=0.0, reason="liquidation",
                              lose_full_margin=True)
    assert pf.liquidations == 1
    assert pf.cash == pytest.approx(10_000.0 - 100.0 - 0.5)   # marge intégralement perdue
    assert trade.net_pnl < 0


# --------------------------------------------------------- résolution intrabar
def _position_with_sl_tp():
    return Position(
        symbol="BTC", side="long", quantity=1.0, entry_price=100.0, margin=10.0,
        leverage=10.0, stop_loss=98.0, take_profit=102.0, liquidation_price=80.0,
        opened_at=pd.Timestamp("2024-01-01", tz="UTC"),
    )


def test_ambiguous_bar_falls_back_to_stop_loss_first():
    cfg = load_config(overrides={"execution.intrabar.resolve_with_intrabar": False})
    sim = ExecutionSimulator(cfg)
    bar = pd.Series({"open": 100.0, "high": 103.0, "low": 97.0, "close": 101.0, "volume": 5.0})
    event = sim.resolve_exit(_position_with_sl_tp(), bar, bar, pd.Timestamp("2024-01-01 00:05", tz="UTC"))
    assert event.kind == "stop_loss" and event.resolved_with == "assumption"


def test_ambiguous_bar_is_resolved_with_1m_data_when_available():
    cfg = load_config(overrides={"execution.intrabar.resolve_with_intrabar": True})
    start = pd.Timestamp("2024-01-01 00:05", tz="UTC")
    minutes = make_bars(
        [(100, 103, 100, 102), (102, 103, 97, 98), (98, 99, 97, 98),
         (98, 99, 97, 98), (98, 99, 97, 98)],
        timeframe_ms=60_000, start_ms=int(start.value // 1_000_000),
    )
    sim = ExecutionSimulator(cfg, intrabar={"BTC": minutes})
    bar = pd.Series({"open": 100.0, "high": 103.0, "low": 97.0, "close": 98.0, "volume": 5.0})
    event = sim.resolve_exit(_position_with_sl_tp(), bar, bar, start)
    # en 1m le TP est touché avant le SL : l'hypothèse pessimiste est corrigée
    assert event.kind == "take_profit" and event.resolved_with == "intrabar"


def test_single_touch_is_not_counted_as_ambiguous():
    cfg = load_config()
    sim = ExecutionSimulator(cfg)
    bar = pd.Series({"open": 100.0, "high": 101.0, "low": 97.0, "close": 98.0, "volume": 5.0})
    event = sim.resolve_exit(_position_with_sl_tp(), bar, bar, pd.Timestamp("2024-01-01 00:05", tz="UTC"))
    assert event.kind == "stop_loss" and event.resolved_with == "single_touch"
    assert sim.stats["ambiguous_bars"] == 0
