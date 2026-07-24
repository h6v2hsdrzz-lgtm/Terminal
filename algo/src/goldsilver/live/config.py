"""Chargement typé de config/live.yaml (mêmes principes que goldsilver.config)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import yaml

from goldsilver.live.killswitch import KillConfig
from goldsilver.live.modes import TradingMode
from goldsilver.live.regime import RegimeConfig


@dataclass(frozen=True)
class PollConfig:
    granularity_hours: int
    delay_after_close_seconds: int
    history_hours: int
    max_signal_age_bars: int


@dataclass(frozen=True)
class IgContractSpec:
    """Spécification d'un CFD IG : conversion onces <-> contrats.

    Chez IG, la taille d'ordre est en CONTRATS (ex. or : 1 contrat = 100 oz),
    alors que la stratégie et le sizing raisonnent en onces. Vérifier ces
    valeurs sur votre compte via ``goldsilver-live find-epic or`` puis
    ``GET /markets/{epic}`` (contractSize, decimalPlacesFactor).
    """

    oz_per_contract: float
    min_contracts: float
    contract_step: float
    level_decimals: int               # décimales des niveaux SL/TP acceptées


@dataclass(frozen=True)
class LiveBrokerConfig:
    adapter: str                      # "ig"
    instruments: dict[str, str]       # actif interne -> epic IG
    ig_contracts: dict[str, IgContractSpec]  # epic -> spécification contrat


@dataclass(frozen=True)
class LiveRiskConfig:
    risk_pct: float
    max_open_risk_pct: float
    min_rr: float


@dataclass(frozen=True)
class LiveConfig:
    mode: TradingMode
    strategy_config: str
    poll: PollConfig
    broker: LiveBrokerConfig
    risk: LiveRiskConfig
    regime: RegimeConfig
    kill: KillConfig
    state_path: str
    journal_path: str
    telegram_enabled: bool
    paper_initial_equity: float
    slippage_alert_r: float
    expectations_path: str | None     # summary JSON du backtest pour le rapport
    root: Path = field(default_factory=Path.cwd)

    def resolve(self, rel: str) -> Path:
        p = Path(rel)
        return p if p.is_absolute() else self.root / p


def _req(d: Mapping[str, Any], key: str, ctx: str) -> Any:
    if key not in d:
        raise KeyError(f"Clé manquante dans la config live : {ctx}.{key}")
    return d[key]


def load_live_config(path: str | Path) -> LiveConfig:
    path = Path(path)
    raw: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8"))
    root = path.resolve().parent.parent

    poll = _req(raw, "poll", "")
    broker = _req(raw, "broker", "")
    risk = _req(raw, "risk", "")
    regime = raw.get("regime", {})
    kill = raw.get("kill", {})
    paths = _req(raw, "paths", "")

    return LiveConfig(
        mode=TradingMode(str(_req(raw, "mode", ""))),
        strategy_config=str(_req(raw, "strategy_config", "")),
        poll=PollConfig(
            granularity_hours=int(_req(poll, "granularity_hours", "poll")),
            delay_after_close_seconds=int(_req(poll, "delay_after_close_seconds", "poll")),
            history_hours=int(_req(poll, "history_hours", "poll")),
            max_signal_age_bars=int(poll.get("max_signal_age_bars",
                                             poll["granularity_hours"])),
        ),
        broker=LiveBrokerConfig(
            adapter=str(_req(broker, "adapter", "broker")),
            instruments={str(k): str(v)
                         for k, v in _req(broker, "instruments", "broker").items()},
            ig_contracts={
                str(epic): IgContractSpec(
                    oz_per_contract=float(_req(spec, "oz_per_contract", f"ig.{epic}")),
                    min_contracts=float(_req(spec, "min_contracts", f"ig.{epic}")),
                    contract_step=float(_req(spec, "contract_step", f"ig.{epic}")),
                    level_decimals=int(_req(spec, "level_decimals", f"ig.{epic}")),
                )
                for epic, spec in broker.get("ig", {}).get("contracts", {}).items()
            },
        ),
        risk=LiveRiskConfig(
            risk_pct=float(_req(risk, "risk_pct", "risk")),
            max_open_risk_pct=float(_req(risk, "max_open_risk_pct", "risk")),
            min_rr=float(_req(risk, "min_rr", "risk")),
        ),
        regime=RegimeConfig(
            trend_ema=int(regime.get("trend_ema", 100)),
            slope_lookback_bars=int(regime.get("slope_lookback_bars", 30)),
            min_slope_pct=float(regime.get("min_slope_pct", 0.0)),
            use_efficiency_ratio=bool(regime.get("use_efficiency_ratio", True)),
            er_window_bars=int(regime.get("er_window_bars", 60)),
            er_min=float(regime.get("er_min", 0.20)),
        ),
        kill=KillConfig(
            daily_loss_limit_pct=float(kill.get("daily_loss_limit_pct", 0.05)),
            max_drawdown_pct=float(kill.get("max_drawdown_pct", 0.20)),
            max_consecutive_losses=int(kill.get("max_consecutive_losses", 6)),
            kill_file=str(kill.get("kill_file", "KILL")),
        ),
        state_path=str(_req(paths, "state", "paths")),
        journal_path=str(_req(paths, "journal", "paths")),
        telegram_enabled=bool(raw.get("notify", {}).get("telegram", True)),
        paper_initial_equity=float(raw.get("paper", {}).get("initial_equity", 10000.0)),
        slippage_alert_r=float(raw.get("slippage_alert_r", 0.05)),
        expectations_path=raw.get("expectations_path"),
        root=root,
    )
