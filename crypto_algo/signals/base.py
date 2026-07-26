"""Interface commune des familles de signaux.

Chaque famille est un module indépendant, testable isolément, qui produit un
score normalisé dans ``[-1, +1]`` :

* ``+1`` conviction longue maximale,
* ``0``  aucune information exploitable,
* ``-1`` conviction courte maximale.

Un score n'est **pas** une prédiction de rendement : c'est une mesure de
conviction relative. Il ne devient une position qu'après passage par le
classifieur de régime (qui autorise ou interdit la famille), le moteur de
risque (qui dimensionne) et le simulateur d'exécution (qui facture).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import Config
from ..utils import clip_score, get_logger

log = get_logger("signals.base")


@dataclass
class SignalContext:
    """Tout ce qu'une famille peut consulter, et rien de plus."""

    cfg: Config
    symbol: str
    features: dict[str, pd.DataFrame]           # features alignées par symbole
    funding: dict[str, pd.DataFrame] = field(default_factory=dict)
    index_price: dict[str, pd.DataFrame] = field(default_factory=dict)
    benchmark: str = "BTC/USDT:USDT"

    @property
    def own(self) -> pd.DataFrame:
        return self.features[self.symbol]

    def col(self, name: str, timeframe: str | None = None, default=np.nan) -> pd.Series:
        """Colonne du frame aligné, éventuellement suffixée par timeframe."""
        df = self.own
        key = f"{name}_{timeframe}" if timeframe else name
        if key in df.columns:
            return df[key]
        return pd.Series(default, index=df.index, dtype=float)

    def has(self, name: str, timeframe: str | None = None) -> bool:
        key = f"{name}_{timeframe}" if timeframe else name
        return key in self.own.columns


class SignalFamily(ABC):
    """Famille de signaux. ``score`` doit être causal et borné."""

    name: str = "family"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.timeframes = list(cfg.get_path("data.signal_timeframes"))

    @abstractmethod
    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        """Composantes élémentaires, chacune déjà dans ``[-1, 1]``."""

    def score(self, ctx: SignalContext) -> pd.Series:
        components = self.raw_components(ctx)
        if not components:
            return pd.Series(0.0, index=ctx.own.index)
        frame = pd.DataFrame(components)
        out = frame.mean(axis=1, skipna=True).fillna(0.0)
        out = clip_score(out)
        if (out.abs() > 1.0 + 1e-9).any():
            raise ValueError(f"{self.name}: score hors de [-1, 1]")
        return out.rename(self.name)

    def detail(self, ctx: SignalContext) -> pd.DataFrame:
        """Composantes + score agrégé, pour l'analyse et les tests."""
        components = self.raw_components(ctx)
        frame = pd.DataFrame(components)
        frame[self.name] = self.score(ctx)
        return frame


# --------------------------------------------------------------------------
# Aides de normalisation
# --------------------------------------------------------------------------
def squash(series: pd.Series, scale: float) -> pd.Series:
    """Normalisation douce d'une grandeur non bornée vers [-1, 1]."""
    return pd.Series(np.tanh(series.astype(float) / scale), index=series.index)


def sign_score(condition_up: pd.Series, condition_down: pd.Series) -> pd.Series:
    """+1 si condition haussière, -1 si baissière, 0 sinon."""
    up = condition_up.fillna(False).astype(float)
    down = condition_down.fillna(False).astype(float)
    return (up - down).clip(-1.0, 1.0)


def gate(score: pd.Series, gate_series: pd.Series) -> pd.Series:
    """Atténue un score par une porte dans [0, 1] (force de tendance, etc.)."""
    g = gate_series.clip(0.0, 1.0).fillna(0.0)
    return score * g


def mean_of(components: dict[str, pd.Series], index: pd.Index) -> pd.Series:
    if not components:
        return pd.Series(0.0, index=index)
    return pd.DataFrame(components).mean(axis=1, skipna=True).fillna(0.0)
