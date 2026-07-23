"""Filtre de régime : tendance nette autorisée, chop et baisse en pause."""

from __future__ import annotations

import numpy as np
import pandas as pd

from goldsilver.live.regime import RegimeConfig, assess_regime, efficiency_ratio

CFG = RegimeConfig(trend_ema=20, slope_lookback_bars=5, min_slope_pct=0.0,
                   use_efficiency_ratio=True, er_window_bars=20, er_min=0.20)


def _candles(close: np.ndarray) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=len(close), freq="4h", tz="UTC")
    return pd.DataFrame({"open": close, "high": close + 1,
                         "low": close - 1, "close": close}, index=idx)


def test_clean_uptrend_allowed() -> None:
    close = 100.0 + np.arange(200) * 0.5
    st = assess_regime("XAUUSD", _candles(close), CFG)
    assert st.trading_allowed and st.trend_ok and st.er_ok
    assert st.slope_pct > 0


def test_downtrend_paused() -> None:
    close = 200.0 - np.arange(200) * 0.5
    st = assess_regime("XAUUSD", _candles(close), CFG)
    assert not st.trading_allowed
    assert not st.trend_ok            # close < EMA et pente négative


def test_chop_paused_by_efficiency_ratio() -> None:
    # oscillation serrée autour d'un niveau : beaucoup de chemin, zéro net
    close = 100.0 + np.sin(np.arange(300) / 3.0) * 2.0
    st = assess_regime("XAUUSD", _candles(close), CFG)
    assert st.er_value < 0.2
    assert not st.trading_allowed


def test_insufficient_history_paused() -> None:
    close = 100.0 + np.arange(10) * 0.5
    st = assess_regime("XAUUSD", _candles(close), CFG)
    assert not st.trading_allowed
    assert "insuffisant" in st.detail


def test_efficiency_ratio_bounds() -> None:
    straight = pd.Series(np.arange(50, dtype=float))
    assert efficiency_ratio(straight, 20) == 1.0     # ligne droite : ER max
    flat = pd.Series(np.tile([1.0, 2.0], 30))
    assert efficiency_ratio(flat, 20) < 0.1          # aller-retour : ER ~ 0
