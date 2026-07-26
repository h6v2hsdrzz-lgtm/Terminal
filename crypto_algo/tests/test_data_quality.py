"""Contrôle qualité des données (§2) : chaque défaut doit être détecté."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crypto_algo.config import load_config
from crypto_algo.data.loader import resample_ohlcv, synthetic_ohlcv
from crypto_algo.data.quality import check_dataset, check_funding, check_mark_vs_close
from crypto_algo.utils import dt_to_ms, timeframe_to_ms, utc_index


@pytest.fixture()
def cfg():
    return load_config()


@pytest.fixture()
def clean():
    return synthetic_ohlcv(n_bars=1200, timeframe="15m", seed=21)


def test_clean_series_passes(cfg, clean):
    rep = check_dataset(clean, "BTC/USDT:USDT", "15m", cfg)
    assert rep.passed, rep.failures
    assert rep.gap_ratio == 0.0
    assert rep.duplicate_bars == 0


def test_gaps_are_detected(cfg, clean):
    holed = clean.drop(index=range(300, 340)).reset_index(drop=True)
    rep = check_dataset(holed, "BTC/USDT:USDT", "15m", cfg)
    assert rep.missing_bars == 40
    assert rep.gap_ratio > 0
    assert rep.maintenance_windows, "la fenêtre de maintenance n'a pas été signalée"
    assert rep.maintenance_windows[0]["missing_bars"] == 40


def test_duplicates_are_detected(cfg, clean):
    duped = pd.concat([clean, clean.iloc[100:110]], ignore_index=True)
    rep = check_dataset(duped, "BTC/USDT:USDT", "15m", cfg)
    assert rep.duplicate_bars == 10
    assert not rep.passed


def test_zero_volume_bars_are_flagged(cfg, clean):
    modified = clean.copy()
    modified.loc[0:200, "volume"] = 0.0
    rep = check_dataset(modified, "BTC/USDT:USDT", "15m", cfg)
    assert rep.zero_volume_bars >= 200
    assert any("volume nul" in w for w in rep.warnings)


def test_price_outliers_are_flagged(cfg, clean):
    modified = clean.copy()
    modified.loc[500, ["open", "high", "low", "close"]] *= 8.0
    rep = check_dataset(modified, "BTC/USDT:USDT", "15m", cfg)
    assert rep.outliers >= 1
    assert rep.max_abs_return > 1.0


def test_ohlc_inconsistency_fails(cfg, clean):
    modified = clean.copy()
    modified.loc[10, "high"] = modified.loc[10, "low"] - 1.0
    rep = check_dataset(modified, "BTC/USDT:USDT", "15m", cfg)
    assert rep.ohlc_violations >= 1
    assert not rep.passed


def test_empty_series_fails(cfg):
    rep = check_dataset(pd.DataFrame(), "BTC/USDT:USDT", "15m", cfg)
    assert not rep.passed and "vide" in rep.failures[0]


def test_missing_funding_is_a_failure(cfg):
    rep = check_funding(pd.DataFrame(), "BTC/USDT:USDT", cfg)
    assert not rep.passed
    assert "funding" in rep.failures[0]


def test_funding_gaps_are_detected(cfg):
    idx = pd.date_range("2024-01-01", periods=200, freq="8h", tz="UTC")
    df = pd.DataFrame({"timestamp": dt_to_ms(idx), "funding_rate": 0.0001})
    holed = df.drop(index=range(50, 90)).reset_index(drop=True)
    rep = check_funding(holed, "BTC/USDT:USDT", cfg)
    assert rep.missing_bars == 40
    assert not rep.passed


def test_mark_vs_close_divergence_is_detected(cfg, clean):
    mark = clean.copy()
    mark["close"] = mark["close"] * 1.20          # 20 % d'écart : anormal
    rep = check_mark_vs_close(mark, clean, "BTC/USDT:USDT", cfg)
    assert not rep.passed
    assert rep.max_abs_return > 0.1


def test_resample_preserves_ohlc_semantics(clean):
    """L'agrégation 15m -> 1h doit respecter open/high/low/close/volume."""
    hourly = resample_ohlcv(clean, "15m", "1h")
    src = utc_index(clean)
    agg = utc_index(hourly)
    for ts in agg.index[:20]:
        window = src[(src.index >= ts) & (src.index < ts + pd.Timedelta(hours=1))]
        assert agg.loc[ts, "open"] == pytest.approx(window["open"].iloc[0])
        assert agg.loc[ts, "close"] == pytest.approx(window["close"].iloc[-1])
        assert agg.loc[ts, "high"] == pytest.approx(window["high"].max())
        assert agg.loc[ts, "low"] == pytest.approx(window["low"].min())
        assert agg.loc[ts, "volume"] == pytest.approx(window["volume"].sum())


def test_timestamps_round_trip_in_milliseconds():
    """Garde-fou du bug de résolution : ms -> datetime -> ms doit être stable."""
    idx = pd.date_range("2021-03-01", periods=50, freq="15min", tz="UTC")
    ms = dt_to_ms(idx)
    back = pd.to_datetime(ms, unit="ms", utc=True)
    assert (back == idx).all()
    assert int(ms[1] - ms[0]) == timeframe_to_ms("15m")


# --------------------------------------------------------- verrou out-of-sample
def test_out_of_sample_is_locked_by_default(cfg):
    """La discipline « on ne regarde l'OOS qu'une fois » est appliquée par le code."""
    from crypto_algo.data.loader import OutOfSampleLocked, load_market_data

    assert cfg.get_path("splits.oos_unlocked") is False
    with pytest.raises(OutOfSampleLocked):
        load_market_data(cfg, split="out_of_sample")
    with pytest.raises(OutOfSampleLocked):
        load_market_data(cfg, split="full")


def test_in_sample_is_always_readable(cfg):
    from crypto_algo.data.loader import assert_split_allowed

    assert_split_allowed(cfg, "in_sample")     # ne lève pas


def test_unlocking_requires_an_explicit_flag(cfg):
    from crypto_algo.data.loader import assert_split_allowed

    unlocked = cfg.with_overrides({"splits.oos_unlocked": True,
                                   "splits.oos_unlock_reason": "audit terminé"})
    assert_split_allowed(unlocked, "out_of_sample")   # ne lève pas
