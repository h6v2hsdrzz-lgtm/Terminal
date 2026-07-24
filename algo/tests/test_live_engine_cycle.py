"""Cycle complet du moteur en mode PAPER : de la bougie au fill, sans doublon."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import pytest
import yaml

import tests.live_fakes  # noqa: F401 — enregistre la stratégie test_always_long
from goldsilver.live.broker.paper import PaperBroker, default_paper_state
from goldsilver.live.config import load_live_config
from goldsilver.live.engine import LiveEngine
from goldsilver.live.journal import Journal
from goldsilver.live.notify import TelegramNotifier
from goldsilver.live.risk import RiskCapError
from goldsilver.live.state import StateStore
from tests.conftest import BASE_CFG, _deep_merge
from tests.live_fakes import FakeDataSource, hourly_candles

LIVE_CFG = {
    "mode": "paper",
    "strategy_config": "config/strat.yaml",
    "poll": {"granularity_hours": 4, "delay_after_close_seconds": 5,
              "history_hours": 800, "max_signal_age_bars": 4},
    "broker": {"adapter": "ig", "instruments": {"XAUUSD": "XAU_USD"}},
    "risk": {"risk_pct": 0.01, "max_open_risk_pct": 0.02, "min_rr": 3.0},
    "regime": {"trend_ema": 20, "slope_lookback_bars": 5, "min_slope_pct": 0.0,
                "use_efficiency_ratio": True, "er_window_bars": 20, "er_min": 0.2},
    "kill": {"daily_loss_limit_pct": 0.05, "max_drawdown_pct": 0.20,
              "max_consecutive_losses": 3, "kill_file": "KILL"},
    "paths": {"state": "live_state/state.json",
               "journal": "live_state/journal.jsonl"},
    "notify": {"telegram": False},
    "paper": {"initial_equity": 10000.0},
    "expectations_path": None,
}


def _setup(tmp_path: Path, rising: float = 0.05, live_overrides: dict | None = None):
    (tmp_path / "config").mkdir()
    strat_cfg = _deep_merge(BASE_CFG, {"data": {"timeframes": ["1h", "4h", "1d"]}})
    # remplacement complet (un deep-merge garderait les params trend_pullback)
    strat_cfg["strategy"] = {
        "name": "test_always_long",
        "params": {"sl_dist": 5.0, "tp_dist": 15.0, "max_bars_held": 100},
    }
    (tmp_path / "config" / "strat.yaml").write_text(yaml.safe_dump(strat_cfg))
    live_cfg_dict = _deep_merge(LIVE_CFG, live_overrides or {})
    (tmp_path / "config" / "live.yaml").write_text(yaml.safe_dump(live_cfg_dict))
    cfg = load_live_config(tmp_path / "config" / "live.yaml")

    candles = {"XAU_USD": hourly_candles(600, price=100.0, rising=rising)}
    src = FakeDataSource(candles, {"XAU_USD": (129.8, 130.0)})
    store = StateStore(cfg.resolve(cfg.state_path))
    state = store.load()
    state["paper"] = default_paper_state(10_000.0)
    store.save(state)
    broker = PaperBroker(src, state["paper"])

    # le broker paper doit partager le sous-état persisté : on recharge et relie
    def make_engine():
        st = store.load()
        b = PaperBroker(src, st["paper"])
        eng = LiveEngine(cfg, b, store, Journal(cfg.resolve(cfg.journal_path)),
                         TelegramNotifier(enabled=False))
        # store.save doit persister le même dict que celui du broker
        return eng, st, b

    return cfg, store, src, make_engine


def _now(src: FakeDataSource) -> pd.Timestamp:
    return src.candles["XAU_USD"].index[-1] + pd.Timedelta(minutes=10)


def test_cycle_enters_with_sl_tp_and_no_duplicate(tmp_path: Path) -> None:
    cfg, store, src, make_engine = _setup(tmp_path)
    engine, state, broker = make_engine()
    report = engine.run_cycle(now=_now(src))

    assert any("entré" in a for a in report.actions)
    positions = store.load()["paper"]["positions"]
    assert "XAU_USD" in positions
    p = positions["XAU_USD"]
    assert math.isclose(p["entry"], 130.0)               # ask
    assert math.isclose(p["sl"], 130.0 - 5.0)
    assert math.isclose(p["tp"], 130.0 + 15.0)           # R:R = 3 exactement
    # sizing : 1 % de 10 000 = 100 $ sur 5 $ de SL -> 20 unités
    assert math.isclose(p["units"], 20.0)

    # 2e cycle, mêmes bougies : la bougie de signal est déjà traitée
    engine2, _, _ = make_engine()
    report2 = engine2.run_cycle(now=_now(src))
    assert not any("entré" in a for a in report2.actions)
    assert len(store.load()["paper"]["positions"]) == 1

    events = [json.loads(l) for l in
              (cfg.resolve(cfg.journal_path)).read_text().splitlines()]
    types = [e["type"] for e in events]
    assert "decision" in types and "order" in types and "cycle" in types


def test_regime_pause_blocks_entry(tmp_path: Path) -> None:
    # marché en oscillation : ER bas, pente nulle -> aucune entrée
    cfg, store, src, make_engine = _setup(tmp_path, rising=0.0)
    import numpy as np
    df = src.candles["XAU_USD"]
    osc = 100.0 + np.sin(np.arange(len(df)) / 3.0) * 2.0
    for col in ("open", "high", "low", "close"):
        df[col] = osc
    df["high"] += 0.3
    df["low"] -= 0.3
    engine, _, _ = make_engine()
    report = engine.run_cycle(now=_now(src))
    assert any("régime" in a for a in report.actions)
    assert store.load()["paper"]["positions"] == {}


def test_rr_below_minimum_rejected(tmp_path: Path) -> None:
    cfg, store, src, make_engine = _setup(tmp_path)
    strat = yaml.safe_load((tmp_path / "config" / "strat.yaml").read_text())
    strat["strategy"]["params"]["tp_dist"] = 10.0        # R:R 2 < 3
    (tmp_path / "config" / "strat.yaml").write_text(yaml.safe_dump(strat))
    engine, _, _ = make_engine()
    report = engine.run_cycle(now=_now(src))
    assert any("R:R" in a for a in report.actions)
    assert store.load()["paper"]["positions"] == {}


def test_risk_above_hard_cap_refuses_to_start(tmp_path: Path) -> None:
    with pytest.raises(RiskCapError):
        _setup(tmp_path, live_overrides={"risk": {"risk_pct": 0.05,
                                                   "max_open_risk_pct": 0.10,
                                                   "min_rr": 3.0}})[3]()


def test_kill_file_flattens_and_halts_persistently(tmp_path: Path) -> None:
    cfg, store, src, make_engine = _setup(tmp_path)
    engine, _, _ = make_engine()
    engine.run_cycle(now=_now(src))
    assert store.load()["paper"]["positions"]            # position ouverte

    (tmp_path / "KILL").touch()
    engine2, _, _ = make_engine()
    report = engine2.run_cycle(now=_now(src))
    assert report.halted
    st = store.load()
    assert st["halted"] and "KILL" in st["halt_reason"]
    assert st["paper"]["positions"] == {}                # flatten exécuté

    # halte persistante : même sans le fichier, pas de trading
    (tmp_path / "KILL").unlink()
    engine3, _, _ = make_engine()
    report3 = engine3.run_cycle(now=_now(src))
    assert report3.halted
    assert store.load()["paper"]["positions"] == {}


def test_sl_close_registers_consecutive_loss(tmp_path: Path) -> None:
    cfg, store, src, make_engine = _setup(tmp_path)
    engine, _, _ = make_engine()
    engine.run_cycle(now=_now(src))
    # nouvelle bougie qui touche le SL (entry 130.0, sl 125.0)
    df = src.candles["XAU_USD"]
    nxt = hourly_candles(2, price=126.0, start=str(df.index[-1] + pd.Timedelta(hours=1)))
    nxt.iloc[1, nxt.columns.get_loc("low")] = 124.0
    src.candles["XAU_USD"] = pd.concat([df, nxt])
    engine2, _, _ = make_engine()
    report = engine2.run_cycle(now=_now(src))
    st = store.load()
    assert st["consecutive_losses"] >= 1
    assert any("fermé" in a for a in report.actions)
    closed = st["paper"]["closed"]
    assert len(closed) == 1 and closed[0]["reason"] == "sl"
    assert math.isclose(closed[0]["pnl"], 20 * (125.0 - 130.0))
