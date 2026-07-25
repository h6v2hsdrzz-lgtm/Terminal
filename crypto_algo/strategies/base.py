"""Interface des stratégies.

Une stratégie prépare, en vectorisé, un tableau de décisions par symbole,
indexé sur les barres du timeframe d'exécution :

===========  =========================================================
colonne      signification
===========  =========================================================
signal       -1 (short) / 0 (plat) / +1 (long) — décision prise **sur la
             clôture** de la barre, exécutée à l'ouverture de la suivante
stop_price   niveau de stop obligatoire (prix absolu)
take_profit  objectif optionnel (prix absolu)
atr_pct      volatilité de la barre, utilisée par le modèle de slippage
regime       régime détecté, pour la journalisation
families     familles de signaux ayant contribué, pour la journalisation
===========  =========================================================
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd

from ..config import Config
from ..data.loader import MarketData

DECISION_COLUMNS = ["signal", "stop_price", "take_profit", "atr_pct", "regime", "families"]


class Strategy(ABC):
    name: str = "strategy"

    def __init__(self, cfg: Config | None = None, **params):
        self.cfg = cfg
        self.params = params
        self._decisions: dict[str, pd.DataFrame] = {}

    @abstractmethod
    def prepare(self, md: MarketData, cfg: Config) -> None:
        """Précalcule les décisions (vectorisé, sans information future)."""

    def decisions(self, symbol: str) -> pd.DataFrame | None:
        return self._decisions.get(symbol)

    @staticmethod
    def empty_decisions(index: pd.DatetimeIndex) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "signal": 0.0,
                "stop_price": float("nan"),
                "take_profit": float("nan"),
                "atr_pct": 0.0,
                "regime": "",
                "families": "",
            },
            index=index,
        )
