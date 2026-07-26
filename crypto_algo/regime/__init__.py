"""Classifieur de régime et routage strict des familles de signaux."""

from .classifier import (  # noqa: F401
    CHAOS, RANGE, REGIMES, TREND_DOWN, TREND_UP,
    RegimeClassifier, RegimeDiagnostics, regime_summary,
)
from .router import RoutingResult, RoutingViolation, SignalRouter  # noqa: F401
