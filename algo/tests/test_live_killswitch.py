"""Kill switches : chaque condition d'arrêt, testée isolément."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

from goldsilver.live.killswitch import (
    KillConfig,
    check_kill_switches,
    register_closed_trade,
    update_daily_anchor,
)
from goldsilver.live.state import default_state

CFG = KillConfig(daily_loss_limit_pct=0.05, max_drawdown_pct=0.20,
                 max_consecutive_losses=3, kill_file="KILL")
NOW = dt.datetime(2026, 7, 23, 8, 0, tzinfo=dt.timezone.utc)


def test_no_trip_in_normal_conditions(tmp_path: Path) -> None:
    state = default_state()
    update_daily_anchor(state, NOW, 10_000.0)
    d = check_kill_switches(state, 10_000.0, CFG, tmp_path)
    assert not d.tripped


def test_daily_loss_trips(tmp_path: Path) -> None:
    state = default_state()
    update_daily_anchor(state, NOW, 10_000.0)
    d = check_kill_switches(state, 9_490.0, CFG, tmp_path)   # -5.1 % sur la journée
    assert d.tripped and "journalière" in d.reason


def test_daily_anchor_resets_next_day(tmp_path: Path) -> None:
    state = default_state()
    update_daily_anchor(state, NOW, 10_000.0)
    update_daily_anchor(state, NOW + dt.timedelta(days=1), 9_600.0)
    # nouveau jour : l'ancre repart de 9600, une equity 9500 ne fait que -1 %
    d = check_kill_switches(state, 9_500.0, CFG, tmp_path)
    assert not d.tripped


def test_max_drawdown_trips_from_high_water_mark(tmp_path: Path) -> None:
    state = default_state()
    update_daily_anchor(state, NOW, 12_500.0)
    check_kill_switches(state, 12_500.0, CFG, tmp_path)      # pose le HWM
    update_daily_anchor(state, NOW + dt.timedelta(days=1), 10_100.0)
    d = check_kill_switches(state, 10_000.0, CFG, tmp_path)  # -20 % depuis 12 500
    assert d.tripped and "drawdown" in d.reason


def test_consecutive_losses_trip_and_reset(tmp_path: Path) -> None:
    state = default_state()
    update_daily_anchor(state, NOW, 10_000.0)
    for _ in range(2):
        register_closed_trade(state, -50.0)
    assert not check_kill_switches(state, 9_900.0, CFG, tmp_path).tripped
    register_closed_trade(state, +80.0)                      # un gain remet à zéro
    assert state["consecutive_losses"] == 0
    for _ in range(3):
        register_closed_trade(state, -50.0)
    d = check_kill_switches(state, 9_800.0, CFG, tmp_path)
    assert d.tripped and "consécutives" in d.reason


def test_kill_file_trips_immediately(tmp_path: Path) -> None:
    state = default_state()
    (tmp_path / "KILL").touch()
    d = check_kill_switches(state, 10_000.0, CFG, tmp_path)
    assert d.tripped and "KILL" in d.reason
