"""Contrat commun aux briques.

Chaque brique est independante : elle ne connait ni les autres briques, ni le
compte, ni le levier. Elle produit, pour chaque barre et chaque actif :

  * `weight`  : position cible normalisee dans [-1, +1] ;
  * `stop`    : prix de stop associe (NaN => le moteur derive un stop ATR) ;
  * `exit_by` : index de barre d'une sortie temporelle imposee (-1 = aucune).

Le calcul est entierement vectorise et decale d'une barre. Une brique ne voit
jamais la barre qu'elle est en train de declencher : `weights[i]` n'utilise que
l'information disponible a la cloture de la barre i-1.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np

from ..data.panel import Panel


@dataclass
class BrickOutput:
    weights: np.ndarray        # (n_bars, n_symbols) dans [-1, 1]
    stops: np.ndarray          # (n_bars, n_symbols) prix, NaN si non impose
    exit_by: np.ndarray        # (n_bars, n_symbols) index de barre, -1 si aucun
    kind: str                  # 'core' ou 'cascade'
    diagnostics: dict


class Brick(ABC):
    name: str = "brick"
    kind: str = "core"

    def __init__(self, params: dict):
        self.params = params

    @abstractmethod
    def compute(self, panel: Panel) -> BrickOutput:
        """Retourne les positions cibles sur toute la periode du panel."""

    # ------------------------------------------------------------------
    @staticmethod
    def empty(panel: Panel, kind: str = "core") -> BrickOutput:
        shape = (panel.n, len(panel.symbols))
        return BrickOutput(
            weights=np.zeros(shape),
            stops=np.full(shape, np.nan),
            exit_by=np.full(shape, -1, dtype=np.int64),
            kind=kind,
            diagnostics={},
        )

    @staticmethod
    def hold_on_grid(weights: np.ndarray, index, timeframe: str) -> np.ndarray:
        """Ne met a jour la cible qu'aux frontieres de `timeframe`.

        Le mandat fixe une execution en H1/H4 pour la brique 1 et quotidienne
        pour la brique 2. Sans ce maintien, une cible continue recalculee a
        chaque barre 15m produit un churn qui detruit la strategie par les
        frais bien avant que le signal ait une chance de payer.
        """
        import pandas as pd
        tf = str(timeframe).upper()
        minute = index.minute.to_numpy()
        hour = index.hour.to_numpy()
        if tf in ("1M", "15M"):
            return weights
        if tf == "1H":
            is_reset = minute == 0
        elif tf == "4H":
            is_reset = (minute == 0) & (hour % 4 == 0)
        elif tf in ("1D", "D"):
            is_reset = (minute == 0) & (hour == 0)
        elif tf in ("1W", "W"):
            # lundi 00:00 UTC, aligne sur les cycles de funding
            is_reset = (minute == 0) & (hour == 0) & (index.dayofweek.to_numpy() == 0)
        else:
            return weights
        held = np.where(is_reset[:, None], weights, np.nan)
        return pd.DataFrame(held).ffill().fillna(0.0).to_numpy()

    @staticmethod
    def sanitize(weights: np.ndarray, panel: Panel, max_abs: float = 1.0) -> np.ndarray:
        """Borne dans [-max_abs, max_abs] et annule sur les barres non cotees."""
        valid = panel.valid_matrix()
        w = np.where(np.isfinite(weights), weights, 0.0)
        w = np.clip(w, -max_abs, max_abs)
        return np.where(valid, w, 0.0)
