"""Chargement du YAML de configuration vers des dataclasses typées.

Aucune valeur par défaut métier ici : la source de vérité est le fichier YAML.
Les dataclasses valident la présence et le type des champs au chargement.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import yaml


@dataclass(frozen=True)
class AssetSpec:
    csv: str
    contract_size: float
    min_size: float
    size_step: float
    max_leverage: float | None = None  # plafond de levier propre à l'actif
    # (ex. courtier : or x20, argent x10) ; None = plafond global seulement


@dataclass(frozen=True)
class DataConfig:
    base_timeframe: str
    timeframes: tuple[str, ...]
    start: str | None
    end: str | None
    session_day_offset_hours: int
    warmup_days: int
    assets: dict[str, AssetSpec]


@dataclass(frozen=True)
class FetchConfig:
    source: str
    symbols: tuple[str, ...]
    start: str
    end: str | None
    out_dir: str
    price_scale: float
    pause_seconds: float


@dataclass(frozen=True)
class StrategyConfig:
    name: str
    params: dict[str, Any]


@dataclass(frozen=True)
class AssetCosts:
    fixed_spread: float
    slippage: float
    swap_long: float
    swap_short: float


@dataclass(frozen=True)
class CostsConfig:
    spread_mode: str  # "from_data" | "fixed"
    pessimistic_spread_mult: float
    rollover_hour_utc: int
    triple_swap_weekday: int
    per_asset: dict[str, AssetCosts]


@dataclass(frozen=True)
class EngineConfig:
    initial_equity: float
    risk_pct: float
    max_open_risk_pct: float
    corr_risk_factor: float
    max_leverage: float
    intrabar_worst_case: bool
    costs: CostsConfig


@dataclass(frozen=True)
class OOSConfig:
    train_frac: float


@dataclass(frozen=True)
class WalkForwardConfig:
    train_months: int
    test_months: int
    anchored: bool


@dataclass(frozen=True)
class MonteCarloConfig:
    n_runs: int
    ruin_drawdown: float


@dataclass(frozen=True)
class NoiseConfig:
    n_runs: int
    atr_frac: float


@dataclass(frozen=True)
class SensitivityConfig:
    metric: str
    pairs: tuple[tuple[str, str], ...]
    ranges: dict[str, list[Any]]


@dataclass(frozen=True)
class ValidationConfig:
    objective: str
    min_trades: int
    grid: dict[str, list[Any]]
    oos: OOSConfig
    walk_forward: WalkForwardConfig
    monte_carlo: MonteCarloConfig
    noise: NoiseConfig
    sensitivity: SensitivityConfig


@dataclass(frozen=True)
class ReportConfig:
    out_dir: str
    plotlyjs: str
    monthly_benchmark_pct: tuple[float, float]
    thresholds: dict[str, float]


@dataclass(frozen=True)
class Config:
    seed: int
    data: DataConfig
    fetch: FetchConfig
    strategy: StrategyConfig
    engine: EngineConfig
    validation: ValidationConfig
    report: ReportConfig
    root: Path = field(default_factory=Path.cwd)

    def resolve(self, rel: str) -> Path:
        """Chemin relatif à la racine du projet (dossier du fichier config)."""
        p = Path(rel)
        return p if p.is_absolute() else self.root / p


def _require(d: Mapping[str, Any], key: str, ctx: str) -> Any:
    if key not in d:
        raise KeyError(f"Clé manquante dans la config : {ctx}.{key}")
    return d[key]


def load_config(path: str | Path) -> Config:
    path = Path(path)
    raw: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8"))
    root = path.resolve().parent.parent  # config/default.yaml -> racine du projet

    d = _require(raw, "data", "")
    data = DataConfig(
        base_timeframe=str(_require(d, "base_timeframe", "data")),
        timeframes=tuple(_require(d, "timeframes", "data")),
        start=d.get("start"),
        end=d.get("end"),
        session_day_offset_hours=int(_require(d, "session_day_offset_hours", "data")),
        warmup_days=int(_require(d, "warmup_days", "data")),
        assets={
            name: AssetSpec(
                csv=str(_require(a, "csv", f"data.assets.{name}")),
                contract_size=float(_require(a, "contract_size", f"data.assets.{name}")),
                min_size=float(_require(a, "min_size", f"data.assets.{name}")),
                size_step=float(_require(a, "size_step", f"data.assets.{name}")),
                max_leverage=(
                    float(a["max_leverage"]) if a.get("max_leverage") is not None else None
                ),
            )
            for name, a in _require(d, "assets", "data").items()
        },
    )

    f = _require(raw, "fetch", "")
    fetch = FetchConfig(
        source=str(f.get("source", "dukascopy")),
        symbols=tuple(_require(f, "symbols", "fetch")),
        start=str(_require(f, "start", "fetch")),
        end=f.get("end"),
        out_dir=str(_require(f, "out_dir", "fetch")),
        price_scale=float(_require(f, "price_scale", "fetch")),
        pause_seconds=float(f.get("pause_seconds", 0.15)),
    )

    s = _require(raw, "strategy", "")
    strategy = StrategyConfig(name=str(_require(s, "name", "strategy")),
                              params=dict(_require(s, "params", "strategy")))

    e = _require(raw, "engine", "")
    c = _require(e, "costs", "engine")
    costs = CostsConfig(
        spread_mode=str(_require(c, "spread_mode", "engine.costs")),
        pessimistic_spread_mult=float(_require(c, "pessimistic_spread_mult", "engine.costs")),
        rollover_hour_utc=int(_require(c, "rollover_hour_utc", "engine.costs")),
        triple_swap_weekday=int(_require(c, "triple_swap_weekday", "engine.costs")),
        per_asset={
            name: AssetCosts(
                fixed_spread=float(_require(a, "fixed_spread", f"costs.{name}")),
                slippage=float(_require(a, "slippage", f"costs.{name}")),
                swap_long=float(_require(a, "swap_long", f"costs.{name}")),
                swap_short=float(_require(a, "swap_short", f"costs.{name}")),
            )
            for name, a in _require(c, "per_asset", "engine.costs").items()
        },
    )
    engine = EngineConfig(
        initial_equity=float(_require(e, "initial_equity", "engine")),
        risk_pct=float(_require(e, "risk_pct", "engine")),
        max_open_risk_pct=float(_require(e, "max_open_risk_pct", "engine")),
        corr_risk_factor=float(_require(e, "corr_risk_factor", "engine")),
        max_leverage=float(_require(e, "max_leverage", "engine")),
        intrabar_worst_case=bool(_require(e, "intrabar_worst_case", "engine")),
        costs=costs,
    )

    v = _require(raw, "validation", "")
    sens = _require(v, "sensitivity", "validation")
    validation = ValidationConfig(
        objective=str(_require(v, "objective", "validation")),
        min_trades=int(_require(v, "min_trades", "validation")),
        grid={k: list(vv) for k, vv in _require(v, "grid", "validation").items()},
        oos=OOSConfig(train_frac=float(_require(_require(v, "oos", "validation"), "train_frac", "oos"))),
        walk_forward=WalkForwardConfig(
            train_months=int(_require(_require(v, "walk_forward", "validation"), "train_months", "wf")),
            test_months=int(_require(v["walk_forward"], "test_months", "wf")),
            anchored=bool(v["walk_forward"].get("anchored", False)),
        ),
        monte_carlo=MonteCarloConfig(
            n_runs=int(_require(_require(v, "monte_carlo", "validation"), "n_runs", "mc")),
            ruin_drawdown=float(_require(v["monte_carlo"], "ruin_drawdown", "mc")),
        ),
        noise=NoiseConfig(
            n_runs=int(_require(_require(v, "noise", "validation"), "n_runs", "noise")),
            atr_frac=float(_require(v["noise"], "atr_frac", "noise")),
        ),
        sensitivity=SensitivityConfig(
            metric=str(sens.get("metric", "sharpe")),
            pairs=tuple((str(a), str(b)) for a, b in _require(sens, "pairs", "sensitivity")),
            ranges={k: list(vv) for k, vv in _require(sens, "ranges", "sensitivity").items()},
        ),
    )

    r = _require(raw, "report", "")
    bench = _require(r, "monthly_benchmark_pct", "report")
    report = ReportConfig(
        out_dir=str(_require(r, "out_dir", "report")),
        plotlyjs=str(r.get("plotlyjs", "inline")),
        monthly_benchmark_pct=(float(bench[0]), float(bench[1])),
        thresholds={k: float(vv) for k, vv in _require(r, "thresholds", "report").items()},
    )

    return Config(
        seed=int(raw.get("seed", 42)),
        data=data,
        fetch=fetch,
        strategy=strategy,
        engine=engine,
        validation=validation,
        report=report,
        root=root,
    )
