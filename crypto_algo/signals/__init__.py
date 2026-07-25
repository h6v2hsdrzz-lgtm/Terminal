"""Familles de signaux — chacune indépendante, testable isolément, bornée [-1, 1]."""

from .base import SignalContext, SignalFamily  # noqa: F401
from .correlation import CorrelationFamily, dominance_proxy  # noqa: F401
from .momentum import MomentumFamily  # noqa: F401
from .range_detect import RangeFamily, range_strength  # noqa: F401
from .reversal import ReversalFamily  # noqa: F401
from .statarb import StatArbFamily  # noqa: F401
from .trend import BreakoutFamily, TrendFamily  # noqa: F401
from .volume import VolumeFamily  # noqa: F401

FAMILY_REGISTRY = {
    "trend": TrendFamily,
    "breakout": BreakoutFamily,
    "momentum": MomentumFamily,
    "range": RangeFamily,
    "reversal": ReversalFamily,
    "volume": VolumeFamily,
    "correlation": CorrelationFamily,
    "statarb": StatArbFamily,
}


def build_families(cfg, names=None):
    """Instancie les familles demandées (toutes par défaut)."""
    names = names or list(FAMILY_REGISTRY)
    missing = [n for n in names if n not in FAMILY_REGISTRY]
    if missing:
        raise KeyError(f"familles inconnues : {missing}")
    return {n: FAMILY_REGISTRY[n](cfg) for n in names}
