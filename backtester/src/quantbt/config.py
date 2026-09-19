"""Typed configuration loaded from YAML. No hard-coded parameters anywhere else."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class DataConfig:
    source: str = "csv"  # "csv" | "ccxt"
    csv_path: str = ""
    symbol: str = "XAG/USD"
    exchange: str = "okx"  # for ccxt source
    base_timeframe: str = "15min"
    extra_timeframes: tuple[str, ...] = ("1h", "1D")
    start: str | None = None  # ISO date, optional slice
    end: str | None = None
    tz: str = "UTC"


@dataclass(frozen=True)
class SpreadConfig:
    mode: str = "pct"  # "pct" (fraction of price) | "abs" (price units)
    value: float = 0.0002
    pessimistic_mult: float = 1.0  # >1 => pessimistic spread (e.g. 1.5x the mean)


@dataclass(frozen=True)
class CostConfig:
    spread: SpreadConfig = field(default_factory=SpreadConfig)
    slippage_pct: float = 0.0001  # per fill, fraction of price, always adverse
    commission_pct: float = 0.0005  # per side, fraction of notional
    funding_daily_pct: float = 0.0  # daily funding on open notional (crypto perps)


@dataclass(frozen=True)
class RiskConfig:
    initial_capital: float = 10_000.0
    risk_pct: float = 0.01  # fraction of equity risked per trade
    max_leverage: float = 5.0
    min_rr: float = 3.0  # reject signals whose TP/SL ratio is below this


@dataclass(frozen=True)
class StrategyConfig:
    name: str = "ema_atr"
    params: dict[str, Any] = field(default_factory=dict)
    param_grid: dict[str, list[Any]] = field(default_factory=dict)  # for optimization


@dataclass(frozen=True)
class OOSConfig:
    enabled: bool = True
    train_ratio: float = 0.7
    optimize: bool = True  # grid-optimize on train before judging OOS
    objective: str = "sharpe"
    degradation_warn: float = 0.5  # OOS metric < warn * IS metric => degradation flag


@dataclass(frozen=True)
class WalkForwardConfig:
    enabled: bool = True
    n_folds: int = 5
    train_bars: int = 4000
    test_bars: int = 1000
    anchored: bool = False
    objective: str = "sharpe"
    min_wfe: float = 0.5  # walk-forward efficiency threshold


@dataclass(frozen=True)
class MonteCarloConfig:
    enabled: bool = True
    n_runs: int = 2000
    method: str = "both"  # "shuffle" | "bootstrap" | "both"
    ruin_threshold: float = 0.5  # equity fraction considered ruin
    seed: int = 42


@dataclass(frozen=True)
class NoiseConfig:
    enabled: bool = True
    n_runs: int = 50
    noise_atr_frac: float = 0.1  # gaussian sigma as fraction of ATR
    atr_period: int = 14
    seed: int = 42
    max_metric_cv: float = 1.0  # coefficient of variation threshold on expectancy


@dataclass(frozen=True)
class DetrendConfig:
    enabled: bool = True
    min_edge_ratio: float = 0.3  # detrended expectancy must keep this share of raw


@dataclass(frozen=True)
class SensitivityConfig:
    enabled: bool = True
    metric: str = "sharpe"
    params: tuple[str, ...] = ()  # 2 params to scan; empty = first 2 of param_grid
    peak_ratio: float = 2.0  # best > peak_ratio * median(neighbors) => fragile peak


@dataclass(frozen=True)
class ValidationConfig:
    oos: OOSConfig = field(default_factory=OOSConfig)
    walkforward: WalkForwardConfig = field(default_factory=WalkForwardConfig)
    montecarlo: MonteCarloConfig = field(default_factory=MonteCarloConfig)
    noise: NoiseConfig = field(default_factory=NoiseConfig)
    detrend: DetrendConfig = field(default_factory=DetrendConfig)
    sensitivity: SensitivityConfig = field(default_factory=SensitivityConfig)


@dataclass(frozen=True)
class ReportConfig:
    output_dir: str = "reports"
    title: str = "Backtest report"
    plotlyjs: str = "cdn"  # "cdn" | "inline"


@dataclass(frozen=True)
class RunConfig:
    data: DataConfig = field(default_factory=DataConfig)
    costs: CostConfig = field(default_factory=CostConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    validation: ValidationConfig = field(default_factory=ValidationConfig)
    report: ReportConfig = field(default_factory=ReportConfig)
    seed: int = 42


def _build(cls: type, raw: dict[str, Any]) -> Any:
    """Recursively build a dataclass from a dict, tolerating missing keys."""
    kwargs: dict[str, Any] = {}
    for name, f in cls.__dataclass_fields__.items():  # type: ignore[attr-defined]
        if name not in raw:
            continue
        val = raw[name]
        ftype = f.type if isinstance(f.type, type) else None
        target = _DATACLASS_FIELDS.get((cls, name))
        if target is not None and isinstance(val, dict):
            kwargs[name] = _build(target, val)
        elif isinstance(val, list) and _TUPLE_FIELDS.get((cls, name)):
            kwargs[name] = tuple(val)
        else:
            kwargs[name] = val
        _ = ftype
    return cls(**kwargs)


_DATACLASS_FIELDS: dict[tuple[type, str], type] = {
    (RunConfig, "data"): DataConfig,
    (RunConfig, "costs"): CostConfig,
    (RunConfig, "risk"): RiskConfig,
    (RunConfig, "strategy"): StrategyConfig,
    (RunConfig, "validation"): ValidationConfig,
    (RunConfig, "report"): ReportConfig,
    (CostConfig, "spread"): SpreadConfig,
    (ValidationConfig, "oos"): OOSConfig,
    (ValidationConfig, "walkforward"): WalkForwardConfig,
    (ValidationConfig, "montecarlo"): MonteCarloConfig,
    (ValidationConfig, "noise"): NoiseConfig,
    (ValidationConfig, "detrend"): DetrendConfig,
    (ValidationConfig, "sensitivity"): SensitivityConfig,
}

_TUPLE_FIELDS: dict[tuple[type, str], bool] = {
    (DataConfig, "extra_timeframes"): True,
    (SensitivityConfig, "params"): True,
}


def load_config(path: str | Path) -> RunConfig:
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    return _build(RunConfig, raw)
