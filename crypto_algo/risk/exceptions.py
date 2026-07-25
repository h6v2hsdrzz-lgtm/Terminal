"""Exceptions du moteur de risque.

Distinction volontaire :

* ``RiskInvariantViolation`` — un invariant du système a été rompu (levier au-delà
  du maximum, position sans stop, marge négative…). C'est un **bug du moteur** :
  le backtest s'arrête, on ne « continue quand même ».
* ``OrderRejected`` — le moteur refuse un ordre (budget de risque épuisé, halte
  active, trop de positions). C'est un fonctionnement **normal**, journalisé.
"""

from __future__ import annotations


class RiskError(RuntimeError):
    pass


class RiskInvariantViolation(RiskError):
    """Invariant dur violé — arrêt immédiat du backtest."""


class OrderRejected(RiskError):
    """Ordre refusé par le moteur de risque (comportement attendu)."""

    def __init__(self, reason: str, code: str = "rejected"):
        super().__init__(reason)
        self.reason = reason
        self.code = code


class KillSwitchTriggered(RiskError):
    """Kill switch global : arrêt définitif, reset manuel obligatoire."""
