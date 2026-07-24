"""État persistant du bot : reprise propre après redémarrage.

Un seul fichier JSON, écrit de façon ATOMIQUE (tmp + rename) à chaque cycle.
Contenu : halte et sa raison, plus-haut d'equity, ancre journalière, pertes
consécutives, dernière bougie traitée par instrument (anti-double-entrée),
sous-état du PaperBroker, stats de slippage.

Le fichier est la mémoire du bot, PAS la vérité sur le compte : en demo/live
la vérité vient du broker à chaque réconciliation.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1


def default_state() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "halted": False,
        "halt_reason": "",
        "hwm_equity": None,
        "day": {},
        "consecutive_losses": 0,
        "last_signal_bar": {},        # instrument -> iso ts de la dernière bougie traitée
        "known_trades": {},           # instrument -> trade_id broker ouvert connu
        "last_closed_trade_id": None,
        "paper": None,
        "slippage": {"n": 0, "sum_abs_excess_r": 0.0},
    }


class StateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return default_state()
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if data.get("schema_version") != SCHEMA_VERSION:
            raise RuntimeError(
                f"{self.path} : schema_version={data.get('schema_version')} "
                f"incompatible (attendu {SCHEMA_VERSION}). Migration manuelle requise."
            )
        base = default_state()
        base.update(data)
        return base

    def save(self, state: dict[str, Any]) -> None:
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
