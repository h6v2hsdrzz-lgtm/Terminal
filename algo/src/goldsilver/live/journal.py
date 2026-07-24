"""Journal append-only (JSONL) : chaque décision, ordre, fill, rejet, erreur.

Une ligne JSON par événement — lisible par le rapport de forward test et par
un humain avec ``jq``. Le journal est la source de vérité de l'audit : si ce
n'est pas dedans, ce n'est pas arrivé.

Tracking du slippage : à chaque fill on journalise le coût d'exécution réel
(écart entre le prix théorique de décision et le fill, en fraction du risque
du trade) et on maintient une moyenne glissante comparée à l'hypothèse du
backtest — si l'écart dérive, alerte.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


class Journal:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, event_type: str, **payload: Any) -> None:
        record = {
            "ts": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "type": event_type,
            **payload,
        }
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        log.info("journal %s: %s", event_type,
                 json.dumps(payload, ensure_ascii=False, default=str)[:300])

    def read_all(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                out.append(json.loads(line))
        return out


def record_slippage(state: dict[str, Any], journal: Journal, *,
                    instrument: str, expected_price: float, fill_price: float,
                    units: float, risk_amount: float,
                    alert_threshold_r: float = 0.05) -> float | None:
    """Journalise le coût d'exécution réel d'un fill, en fraction de R.

    ``expected_price`` : prix théorique au moment de la décision (close de la
    bougie de signal côté ask pour un achat). Retourne l'excès moyen glissant
    en R s'il dépasse le seuil d'alerte, sinon None.
    """
    if risk_amount <= 0:
        return None
    excess_r = abs(fill_price - expected_price) * abs(units) / risk_amount
    s = state.setdefault("slippage", {"n": 0, "sum_abs_excess_r": 0.0})
    s["n"] += 1
    s["sum_abs_excess_r"] += excess_r
    mean_r = s["sum_abs_excess_r"] / s["n"]
    journal.write(
        "slippage",
        instrument=instrument, expected=expected_price, fill=fill_price,
        excess_r=round(excess_r, 5), rolling_mean_r=round(mean_r, 5), n=s["n"],
    )
    if s["n"] >= 5 and mean_r > alert_threshold_r:
        return mean_r
    return None
