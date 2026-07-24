from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest
import yaml

from goldsilver.config import Config, load_config

BASE_CFG: dict[str, Any] = {
    "seed": 42,
    "data": {
        "base_timeframe": "1h",
        "timeframes": ["1h", "1d"],
        "start": None,
        "end": None,
        "session_day_offset_hours": -2,
        "warmup_days": 30,
        "assets": {
            "XAUUSD": {"csv": "data/raw/XAUUSD_1h.csv", "contract_size": 1.0,
                        "min_size": 1.0, "size_step": 1.0},
            "XAGUSD": {"csv": "data/raw/XAGUSD_1h.csv", "contract_size": 1.0,
                        "min_size": 1.0, "size_step": 1.0},
        },
    },
    "fetch": {"source": "dukascopy", "symbols": ["XAUUSD"], "start": "2024-01-01",
              "end": None, "out_dir": "data/raw", "price_scale": 1000.0,
              "pause_seconds": 0.0},
    "strategy": {
        "name": "trend_pullback",
        "params": {"trend_timeframe": "1d", "trend_ema": 10, "rsi_period": 14,
                    "rsi_buy": 40.0, "atr_period": 14, "sl_atr_mult": 2.0,
                    "tp_rr": 3.0, "max_bars_held": 120, "direction": "both"},
    },
    "engine": {
        "initial_equity": 10000.0,
        "risk_pct": 0.01,
        "max_open_risk_pct": 0.10,
        "corr_risk_factor": 0.5,
        "max_leverage": 100.0,
        "intrabar_worst_case": True,
        "costs": {
            "spread_mode": "fixed",
            "pessimistic_spread_mult": 1.0,
            "rollover_hour_utc": 21,
            "triple_swap_weekday": 2,
            "per_asset": {
                "XAUUSD": {"fixed_spread": 0.0, "slippage": 0.0,
                            "swap_long": 0.0, "swap_short": 0.0},
                "XAGUSD": {"fixed_spread": 0.0, "slippage": 0.0,
                            "swap_long": 0.0, "swap_short": 0.0},
            },
        },
    },
    "validation": {
        "objective": "sharpe",
        "min_trades": 5,
        "grid": {"trend_ema": [5, 10]},
        "oos": {"train_frac": 0.7},
        "walk_forward": {"train_months": 6, "test_months": 2, "anchored": False},
        "monte_carlo": {"n_runs": 200, "ruin_drawdown": 0.3},
        "noise": {"n_runs": 5, "atr_frac": 0.1},
        "sensitivity": {"metric": "sharpe", "pairs": [["trend_ema", "rsi_buy"]],
                         "ranges": {"trend_ema": [5, 10, 20],
                                    "rsi_buy": [35.0, 40.0, 45.0]}},
    },
    "report": {
        "out_dir": "reports",
        "plotlyjs": "cdn",
        "monthly_benchmark_pct": [5.0, 6.0],
        "thresholds": {
            "oos_sharpe_retention": 0.5, "wfe_min": 0.5,
            "wf_profitable_folds_min": 0.5, "mc_ruin_prob_max": 0.05,
            "mc_p5_total_return_min": -0.10, "noise_profitable_frac_min": 0.6,
            "noise_sharpe_retention": 0.5, "sensitivity_plateau_min": 0.5,
        },
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in override.items():
        out[k] = _deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


@pytest.fixture
def make_cfg(tmp_path: Path):
    """Fabrique une Config réelle (via le vrai loader YAML) avec surcharges."""

    def _make(**overrides: Any) -> Config:
        cfg_dict = _deep_merge(BASE_CFG, overrides)
        cfg_dir = tmp_path / "config"
        cfg_dir.mkdir(exist_ok=True)
        p = cfg_dir / "test.yaml"
        p.write_text(yaml.safe_dump(cfg_dict), encoding="utf-8")
        return load_config(p)

    return _make


def make_bars(
    prices: list[tuple[float, float, float, float]],
    start: str = "2024-01-01 00:00",
    freq: str = "1h",
    signal: list[int] | None = None,
    sl_dist: float = 5.0,
    tp_dist: float = 15.0,
) -> pd.DataFrame:
    """Construit un DataFrame de signaux prêt pour le Backtester."""
    idx = pd.date_range(start, periods=len(prices), freq=freq, tz="UTC")
    o, h, l, c = zip(*prices)
    df = pd.DataFrame(
        {"open": o, "high": h, "low": l, "close": c,
         "volume": np.ones(len(prices))},
        index=idx,
    )
    df["signal"] = signal if signal is not None else [0] * len(prices)
    df["sl_dist"] = sl_dist
    df["tp_dist"] = tp_dist
    return df


def random_walk_ohlcv(
    n: int = 2000,
    start: str = "2024-01-01",
    seed: int = 7,
    s0: float = 2000.0,
    vol: float = 0.002,
) -> pd.DataFrame:
    """OHLCV horaire synthétique cohérent (pour les tests d'intégration)."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=n, freq="1h", tz="UTC")
    ret = rng.normal(0.0, vol, n)
    close = s0 * np.exp(np.cumsum(ret))
    open_ = np.concatenate([[s0], close[:-1]])
    spread_wick = np.abs(rng.normal(0.0, vol / 2, n)) * close
    high = np.maximum(open_, close) + spread_wick
    low = np.minimum(open_, close) - spread_wick
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close,
         "volume": np.full(n, 100.0), "spread": np.full(n, 0.3)},
        index=idx,
    )
