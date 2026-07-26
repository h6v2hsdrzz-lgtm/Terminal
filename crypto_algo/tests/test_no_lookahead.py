"""Tests anti-lookahead (§7, critère d'acceptation §12).

Principe : on injecte du bruit **dans le futur** et on vérifie que rien de ce
qui a été calculé dans le passé ne bouge. Si un seul indicateur, un seul signal
ou un seul trade change, il y a fuite d'information.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crypto_algo.backtest.engine import BacktestEngine
from crypto_algo.config import load_config
from crypto_algo.data.loader import resample_ohlcv, synthetic_market_data, synthetic_ohlcv
from crypto_algo.features.pipeline import align_to_execution, compute_features
from crypto_algo.strategies.trivial import RandomEntryStrategy
from crypto_algo.utils import dt_to_ms, utc_index

CUT = 0.6   # on perturbe les 40 % finaux


def _corrupt_future(df: pd.DataFrame, cut_ratio: float = CUT, seed: int = 99) -> pd.DataFrame:
    """Remplace la fin de la série par du bruit violent (chocs jusqu'à ±30 %)."""
    rng = np.random.default_rng(seed)
    out = df.copy()
    cut = int(len(out) * cut_ratio)
    n = len(out) - cut
    shock = np.exp(rng.normal(0, 0.30, n)).cumprod()
    for col in ("open", "high", "low", "close"):
        out.iloc[cut:, out.columns.get_loc(col)] = out[col].iloc[cut:].to_numpy() * shock
    out.iloc[cut:, out.columns.get_loc("volume")] = (
        out["volume"].iloc[cut:].to_numpy() * rng.uniform(0.1, 10.0, n)
    )
    return out


def test_indicators_are_causal():
    """Chaque indicateur calculé sur la série complète est identique à celui
    calculé sur la série tronquée."""
    cfg = load_config()
    df = utc_index(synthetic_ohlcv(n_bars=1200, timeframe="15m", seed=17))
    cut = int(len(df) * CUT)

    full = compute_features(df, cfg, "15m")
    corrupted = compute_features(_corrupt_future(df), cfg, "15m")

    past_full = full.iloc[:cut]
    past_corrupt = corrupted.iloc[:cut]
    diffs = []
    for col in past_full.columns:
        a, b = past_full[col], past_corrupt[col]
        if a.dtype.kind in "biufc":
            if not np.allclose(a.to_numpy(float), b.to_numpy(float), rtol=1e-9, atol=1e-12, equal_nan=True):
                diffs.append(col)
        elif not a.equals(b):
            diffs.append(col)
    assert not diffs, f"fuite d'information détectée sur : {diffs}"


def test_higher_timeframe_features_are_not_visible_before_bar_close():
    """Une bougie 4h close à 12:00 ne doit rien apporter aux barres 15m de
    08:00 à 11:45."""
    base = utc_index(synthetic_ohlcv(n_bars=400, timeframe="15m", seed=3,
                                     start="2024-01-01T00:00:00Z"))
    h4 = utc_index(resample_ohlcv(base.reset_index(drop=True), "15m", "4h"))
    feats_4h = pd.DataFrame({"marker": np.arange(len(h4), dtype=float)}, index=h4.index)

    aligned = align_to_execution(feats_4h, "4h", base.index, "15m")

    for i, ts in enumerate(h4.index[:-1]):
        window_start = ts
        window_end = ts + pd.Timedelta(hours=4)
        inside = aligned.loc[(aligned.index >= window_start) & (aligned.index < window_end), "marker"]
        # pendant la bougie 4h ouverte à ts, seule l'information de la bougie
        # **précédente** (i-1) est disponible ; la valeur i n'apparaît qu'à la
        # dernière barre 15m, dont la clôture coïncide avec la clôture 4h.
        assert inside.iloc[:-1].max() <= i - 1 if i > 0 else np.isnan(inside.iloc[0])
        assert inside.iloc[-1] == i


def test_alignment_never_uses_a_bar_that_has_not_closed():
    """Vérification directe : pour chaque barre d'exécution, la valeur alignée
    provient d'une barre source close avant l'instant de décision."""
    base = utc_index(synthetic_ohlcv(n_bars=600, timeframe="15m", seed=8,
                                     start="2024-01-01T00:00:00Z"))
    h1 = utc_index(resample_ohlcv(base.reset_index(drop=True), "15m", "1h"))
    feats = pd.DataFrame({"open_ts": dt_to_ms(h1.index)}, index=h1.index)
    aligned = align_to_execution(feats, "1h", base.index, "15m").dropna()

    source_open = pd.to_datetime(aligned["open_ts"].astype("int64"), unit="ms", utc=True)
    source_close = source_open + pd.Timedelta(hours=1)
    decision_time = aligned.index + pd.Timedelta(minutes=15)
    assert (source_close <= decision_time).all()


def test_strategy_decisions_do_not_change_when_the_future_changes():
    """Test de bout en bout : mêmes trades avant la coupure malgré un futur
    entièrement différent."""
    cfg = load_config(
        overrides={
            "universe.symbols": ["BTC/USDT:USDT"],
            "backtest.warmup_bars": 50,
            "backtest.auto_warmup": False,
            "execution.rejects.enabled": False,
            "execution.latency.enabled": False,
            "data.execution_timeframe": "15m",
            "data.intrabar_timeframe": "5m",
        }
    )
    md = synthetic_market_data(
        symbols=["BTC/USDT:USDT"], timeframes=["15m"], n_bars=2000,
        exec_timeframe="15m", seed=23,
    )
    cut_index = int(2000 * CUT)
    cut_ts = md.get("BTC/USDT:USDT", "15m").index[cut_index]

    res_clean = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.02)).run()

    md2 = synthetic_market_data(
        symbols=["BTC/USDT:USDT"], timeframes=["15m"], n_bars=2000,
        exec_timeframe="15m", seed=23,
    )
    key = ("BTC/USDT:USDT", "15m")
    md2.ohlcv[key] = _corrupt_future(md2.ohlcv[key])
    md2.mark["BTC/USDT:USDT"] = md2.ohlcv[key].copy()
    res_dirty = BacktestEngine(cfg, md2, RandomEntryStrategy(cfg, entry_probability=0.02)).run()

    a = res_clean.trades[res_clean.trades["closed_at"] < cut_ts]
    b = res_dirty.trades[res_dirty.trades["closed_at"] < cut_ts]
    assert len(a) > 3, "scénario trop pauvre pour conclure"
    assert len(a) == len(b)
    cols = ["symbol", "side", "entry_price", "exit_price", "net_pnl", "exit_reason"]
    pd.testing.assert_frame_equal(
        a[cols].reset_index(drop=True), b[cols].reset_index(drop=True), rtol=1e-9
    )
    # l'equity aussi doit être identique avant la coupure
    e1 = res_clean.equity.loc[res_clean.equity.index < cut_ts, "equity"]
    e2 = res_dirty.equity.loc[res_dirty.equity.index < cut_ts, "equity"]
    assert np.allclose(e1.to_numpy(), e2.to_numpy(), rtol=1e-9)


def test_execution_never_fills_at_the_signal_price():
    """Contrôle structurel : aucun fill d'ouverture ne peut se faire au prix de
    clôture ayant généré le signal, sauf coïncidence open == close."""
    cfg = load_config(
        overrides={
            "universe.symbols": ["BTC/USDT:USDT"],
            "backtest.warmup_bars": 20,
            "backtest.auto_warmup": False,
            "execution.rejects.enabled": False,
            "execution.latency.enabled": False,
            "execution.slippage.spread_bps": 0.0,
            "execution.slippage.vol_coefficient": 0.0,
            "execution.slippage.impact_coefficient": 0.0,
            "data.execution_timeframe": "15m",
        }
    )
    md = synthetic_market_data(
        symbols=["BTC/USDT:USDT"], timeframes=["15m"], n_bars=1500, exec_timeframe="15m", seed=31
    )
    df = md.get("BTC/USDT:USDT", "15m")
    res = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.03)).run()
    assert len(res.trades) > 5
    for _, trade in res.trades.iterrows():
        opened = pd.Timestamp(trade["opened_at"])
        assert trade["entry_price"] == pytest.approx(float(df.loc[opened, "open"]), rel=1e-9)
