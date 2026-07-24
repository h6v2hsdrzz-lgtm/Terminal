"""Contrat de base d'une stratégie : données multi-timeframe -> signaux datés.

Une stratégie produit, pour chaque actif, le DataFrame de base augmenté de :

- ``signal``  : +1 (long), -1 (short), 0 — évalué à la CLÔTURE de la bougie ;
  le moteur exécute à l'OUVERTURE de la bougie suivante (pas de look-ahead).
- ``sl_dist`` : distance du stop en unités de prix (> 0), fixée au signal.
- ``tp_dist`` : distance du take-profit (> 0) — R:R = tp_dist / sl_dist.

La stratégie ne connaît ni l'equity, ni les coûts, ni le sizing : c'est le
rôle du moteur. Elle reste ainsi testable et interchangeable.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar, Mapping

import pandas as pd

SIGNAL_COLUMNS = ("signal", "sl_dist", "tp_dist")


class Strategy(ABC):
    """Classe de base : ``generate`` transforme les données en signaux."""

    name: ClassVar[str] = "base"

    def __init__(self, params: Mapping[str, Any] | None = None) -> None:
        merged = dict(self.default_params())
        unknown = set(params or {}) - set(merged)
        if unknown:
            raise ValueError(f"{self.name} : paramètres inconnus {sorted(unknown)}")
        merged.update(params or {})
        self.params: dict[str, Any] = merged

    @classmethod
    @abstractmethod
    def default_params(cls) -> dict[str, Any]:
        """Paramètres par défaut (tous surchargés par la config YAML)."""

    @abstractmethod
    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        """Retourne le DataFrame de base + colonnes ``SIGNAL_COLUMNS``.

        ``tfs`` : {timeframe: OHLCV}, contient au moins le timeframe de base.
        Colonne optionnelle ``exit_signal`` (0/1) : clôture au marché à
        l'ouverture de la bougie suivante.
        """

    def generate_all(
        self, tfs_by_asset: Mapping[str, Mapping[str, pd.DataFrame]]
    ) -> dict[str, pd.DataFrame]:
        """Signaux pour tous les actifs. Par défaut : actif par actif.

        Les stratégies CROSS-ACTIFS (ex. pair trading sur le ratio or/argent)
        surchargent cette méthode — elles voient toutes les données à la fois.
        """
        return {a: self.generate(a, tfs) for a, tfs in tfs_by_asset.items()}

    def with_params(self, override: Mapping[str, Any]) -> "Strategy":
        """Nouvelle instance avec des paramètres surchargés (grid-search)."""
        merged = {**self.params, **override}
        return type(self)(merged)


STRATEGIES: dict[str, type[Strategy]] = {}


def register(cls: type[Strategy]) -> type[Strategy]:
    STRATEGIES[cls.name] = cls
    return cls


def get_strategy(name: str, params: Mapping[str, Any] | None = None) -> Strategy:
    if name not in STRATEGIES:
        raise KeyError(f"Stratégie inconnue : {name} (disponibles : {sorted(STRATEGIES)})")
    return STRATEGIES[name](params)
