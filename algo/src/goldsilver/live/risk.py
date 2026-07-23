"""Plafond de risque DUR du moteur live.

``HARD_MAX_RISK_PCT`` est une constante de module, volontairement codée en
dur : la config ne peut PAS la dépasser. Si ``risk.risk_pct`` dépasse ce
plafond, le moteur refuse de démarrer ; et chaque ordre est re-vérifié au
moment de sa construction (défense en profondeur : même un bug de config ou
de sizing ne doit pas produire un ordre au-dessus du plafond).

La frontière de risque mesurée (reports/risk_frontier_4h.json) montre qu'au
-delà de ~2 % par trade, la probabilité d'un drawdown >= 50 % sur un cycle
complet devient non négligeable. D'où la valeur.
"""

from __future__ import annotations

from typing import Final

HARD_MAX_RISK_PCT: Final[float] = 0.02
_EPS: Final[float] = 1e-9


class RiskCapError(RuntimeError):
    """Config ou ordre au-dessus du plafond dur."""


def validate_configured_risk(risk_pct: float, max_open_risk_pct: float) -> None:
    """À appeler au démarrage. Refuse tout dépassement du plafond dur."""
    if risk_pct > HARD_MAX_RISK_PCT + _EPS:
        raise RiskCapError(
            f"risk_pct={risk_pct:.4f} dépasse le plafond dur "
            f"{HARD_MAX_RISK_PCT:.4f} (2 %/trade). Le moteur live refuse de "
            "démarrer — ce plafond est intentionnel et non configurable."
        )
    if risk_pct <= 0:
        raise RiskCapError(f"risk_pct={risk_pct} invalide (doit être > 0)")
    if max_open_risk_pct < risk_pct:
        raise RiskCapError(
            f"max_open_risk_pct={max_open_risk_pct} < risk_pct={risk_pct} : "
            "aucune position ne pourrait jamais s'ouvrir."
        )


def assert_order_within_cap(risk_amount: float, equity: float) -> None:
    """Garde-fou par ordre : risque engagé <= plafond dur x equity."""
    if equity <= 0:
        raise RiskCapError(f"equity invalide ({equity}) au moment de l'ordre")
    if risk_amount > equity * HARD_MAX_RISK_PCT * (1 + 1e-6):
        raise RiskCapError(
            f"Ordre refusé : risque {risk_amount:.2f} > "
            f"{100 * HARD_MAX_RISK_PCT:.0f} % de l'equity ({equity:.2f}). "
            "Vérifier sizing/config — cet ordre n'aurait jamais dû être construit."
        )
