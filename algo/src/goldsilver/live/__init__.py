"""Exécution automatique (paper -> demo -> live) de la stratégie validée.

Phase 1 obligatoire : paper trading — ordres fictifs sur données réelles,
journal complet, comparaison continue avec les attentes du backtest.
Le mode LIVE est physiquement verrouillé (voir ``modes.py``).
"""

from __future__ import annotations

from goldsilver.live.modes import TradingMode
from goldsilver.live.risk import HARD_MAX_RISK_PCT

__all__ = ["TradingMode", "HARD_MAX_RISK_PCT"]
