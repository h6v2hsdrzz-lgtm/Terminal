"""Kill switches : conditions qui arrêtent le trading, immédiatement.

Trois automatiques + un manuel :
- perte journalière > ``daily_loss_limit_pct`` de l'equity de début de jour ;
- drawdown depuis le plus-haut d'equity (HWM) > ``max_drawdown_pct`` ;
- ``max_consecutive_losses`` pertes consécutives ;
- fichier ``kill_file`` présent sur le disque (arrêt manuel instantané).

Effet : flatten (fermeture de toutes les positions) + halte persistée.
La halte SURVIT aux redémarrages : elle ne se lève que par l'action humaine
explicite ``goldsilver-live reset-halt`` (ou suppression du fichier kill).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class KillConfig:
    daily_loss_limit_pct: float = 0.05
    max_drawdown_pct: float = 0.20
    max_consecutive_losses: int = 6
    kill_file: str = "KILL"


@dataclass(frozen=True)
class KillDecision:
    tripped: bool
    reason: str


def update_daily_anchor(state: dict[str, Any], now_utc: dt.datetime,
                        equity: float) -> None:
    """Réinitialise l'ancre de perte journalière au premier cycle du jour UTC."""
    today = now_utc.date().isoformat()
    day = state.setdefault("day", {})
    if day.get("date") != today:
        day["date"] = today
        day["start_equity"] = equity


def register_closed_trade(state: dict[str, Any], realized_pnl: float) -> None:
    if realized_pnl < 0:
        state["consecutive_losses"] = int(state.get("consecutive_losses", 0)) + 1
    else:
        state["consecutive_losses"] = 0


def check_kill_switches(state: dict[str, Any], equity: float,
                        cfg: KillConfig, root: Path) -> KillDecision:
    """À appeler chaque cycle APRÈS réconciliation, AVANT toute décision."""
    if (root / cfg.kill_file).exists():
        return KillDecision(True, f"fichier {cfg.kill_file} présent (arrêt manuel)")

    eps = 1e-12
    hwm = float(state.get("hwm_equity") or equity)
    hwm = max(hwm, equity)
    state["hwm_equity"] = hwm
    if hwm > 0 and (1.0 - equity / hwm) >= cfg.max_drawdown_pct - eps:
        return KillDecision(
            True,
            f"drawdown {100 * (1 - equity / hwm):.1f} % >= "
            f"{100 * cfg.max_drawdown_pct:.0f} % depuis le plus-haut ({hwm:.2f})",
        )

    day = state.get("day", {})
    start = float(day.get("start_equity") or equity)
    if start > 0 and (start - equity) / start >= cfg.daily_loss_limit_pct - eps:
        return KillDecision(
            True,
            f"perte journalière {100 * (start - equity) / start:.1f} % >= "
            f"{100 * cfg.daily_loss_limit_pct:.0f} %",
        )

    losses = int(state.get("consecutive_losses", 0))
    if losses >= cfg.max_consecutive_losses:
        return KillDecision(
            True, f"{losses} pertes consécutives >= {cfg.max_consecutive_losses}"
        )
    return KillDecision(False, "")
