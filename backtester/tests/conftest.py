from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from make_sample_data import make_ohlcv  # noqa: E402

from quantbt.config import CostConfig, DataConfig, RiskConfig, SpreadConfig  # noqa: E402
from quantbt.data.loader import MarketData, build_market_data  # noqa: E402


@pytest.fixture(scope="session")
def ohlcv():
    return make_ohlcv(n_bars=6000, seed=7)


@pytest.fixture(scope="session")
def market_data(ohlcv) -> MarketData:
    cfg = DataConfig(base_timeframe="15min", extra_timeframes=("1h",))
    return build_market_data(ohlcv, cfg)


@pytest.fixture()
def cost_cfg() -> CostConfig:
    return CostConfig(
        spread=SpreadConfig(mode="pct", value=0.0002, pessimistic_mult=1.0),
        slippage_pct=0.0001,
        commission_pct=0.0005,
    )


@pytest.fixture()
def zero_cost_cfg() -> CostConfig:
    return CostConfig(
        spread=SpreadConfig(mode="pct", value=0.0, pessimistic_mult=1.0),
        slippage_pct=0.0,
        commission_pct=0.0,
    )


@pytest.fixture()
def risk_cfg() -> RiskConfig:
    return RiskConfig(initial_capital=10_000.0, risk_pct=0.01, max_leverage=10.0, min_rr=0.0)
