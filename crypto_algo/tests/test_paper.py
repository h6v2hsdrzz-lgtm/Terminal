"""Paper trading (phase 7) : état persistant et parité avec le backtest.

Aucun accès réseau : les données sont injectées, comme en backtest. Ce qui est
vérifié ici, c'est que le compte papier reprend exactement là où il s'est
arrêté — un redémarrage ne doit ni perdre une position, ni rejouer une bougie.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crypto_algo.config import load_config
from crypto_algo.data.loader import synthetic_market_data
from crypto_algo.live.paper import PaperState, PaperTrader, compare_live_vs_backtest


@pytest.fixture()
def cfg():
    return load_config(
        overrides={
            "universe.symbols": ["BTC/USDT:USDT"],
            "data.signal_timeframes": ["15m", "1h", "4h"],
            "data.execution_timeframe": "15m",
            "backtest.warmup_bars": 50,
            "backtest.auto_warmup": False,
            "execution.rejects.enabled": False,
            "execution.latency.enabled": False,
        }
    )


@pytest.fixture()
def md():
    return synthetic_market_data(
        symbols=["BTC/USDT:USDT"], timeframes=["15m", "1h", "4h"],
        n_bars=4000, exec_timeframe="15m", seed=41,
    )


def test_paper_state_round_trip(tmp_path):
    state = PaperState(started_at="2026-01-01", cash=9_000.0, equity=9_500.0, bars_processed=42)
    path = tmp_path / "state.json"
    state.save(path)
    loaded = PaperState.load(path)
    assert loaded.cash == 9_000.0 and loaded.bars_processed == 42


def test_cold_start_does_not_replay_history(cfg, md, tmp_path):
    """Les 60 jours de paper trading doivent être intégralement prospectifs."""
    trader = PaperTrader(cfg, state_path=tmp_path)
    status = trader.step(md)
    assert status["processed"] == 0
    assert not trader.portfolio.trades
    assert trader.state.last_bar_ts is not None
    assert (tmp_path / "state.json").exists()


def test_paper_step_processes_new_bars_only(cfg, md, tmp_path):
    """Après le démarrage à froid, seules les bougies nouvelles sont traitées."""
    trader = PaperTrader(cfg, state_path=tmp_path)
    exec_tf = cfg.get_path("data.execution_timeframe")
    key = ("BTC/USDT:USDT", exec_tf)
    full = md.ohlcv[key]
    cut = len(full) - 200

    partial = md.slice(end=full.index[cut])
    trader.step(partial)                      # démarrage à froid sur l'historique tronqué
    assert trader.state.bars_processed == 0

    status = trader.step(md)                  # 200 nouvelles bougies
    assert status["processed"] == 200
    assert (tmp_path / "state.json").exists()


def test_paper_step_is_idempotent(cfg, md, tmp_path):
    """Rejouer la même fenêtre ne doit traiter aucune bougie déjà vue."""
    trader = PaperTrader(cfg, state_path=tmp_path)
    exec_tf = cfg.get_path("data.execution_timeframe")
    full = md.ohlcv[("BTC/USDT:USDT", exec_tf)]
    trader.step(md.slice(end=full.index[len(full) - 200]))
    first = trader.step(md)
    second = trader.step(md)
    assert first["processed"] == 200
    assert second["processed"] == 0


def test_paper_restores_positions_after_restart(cfg, md, tmp_path):
    trader = PaperTrader(cfg, state_path=tmp_path)
    exec_tf = cfg.get_path("data.execution_timeframe")
    full = md.ohlcv[("BTC/USDT:USDT", exec_tf)]
    trader.step(md.slice(end=full.index[len(full) - 400]))
    trader.step(md)
    equity_before = trader.portfolio.equity({})
    n_positions = len(trader.portfolio.positions)
    n_trades = len(trader.portfolio.trades)

    revived = PaperTrader(cfg, state_path=tmp_path)
    assert len(revived.portfolio.positions) == n_positions
    assert revived.state.bars_processed == trader.state.bars_processed
    assert revived.portfolio.cash == pytest.approx(trader.portfolio.cash)
    assert len(revived.state.trades) == n_trades
    assert revived.risk.hwm_global == pytest.approx(trader.risk.hwm_global)


def test_paper_respects_risk_invariants(cfg, md, tmp_path):
    trader = PaperTrader(cfg, state_path=tmp_path)
    exec_tf = cfg.get_path("data.execution_timeframe")
    full = md.ohlcv[("BTC/USDT:USDT", exec_tf)]
    trader.step(md.slice(end=full.index[len(full) - 400]))
    trader.step(md)
    assert len(trader.portfolio.positions) <= int(cfg.get_path("risk.max_concurrent_positions"))
    for pos in trader.portfolio.positions.values():
        assert pos.stop_loss > 0
        assert pos.leverage <= float(cfg.get_path("risk.leverage_max")) + 1e-9


def test_live_vs_backtest_comparison_reports_gaps():
    idx = pd.date_range("2026-01-01", periods=30, freq="D", tz="UTC")
    equity = pd.Series(np.linspace(10_000, 10_500, 30), index=idx)
    trades = pd.DataFrame(
        {
            "net_pnl": [10.0, -5.0] * 15,
            "gross_pnl": [12.0, -3.0] * 15,
            "fees": [1.0] * 30, "funding": [-0.5] * 30, "slippage": [0.5] * 30,
            "r_multiple": [0.1, -0.05] * 15,
            "exit_reason": ["signal"] * 30,
            "resolved_with": [""] * 30,
            "holding_hours": [5.0] * 30,
        }
    )
    table = compare_live_vs_backtest(trades, equity, {"sharpe": 1.2, "win_rate": 0.55, "trades": 400})
    assert set(table.columns) == {"métrique", "backtest", "paper", "écart"}
    row = table[table["métrique"] == "win_rate"].iloc[0]
    assert row["paper"] == pytest.approx(0.5)
    assert row["écart"] == pytest.approx(0.5 - 0.55)
