"""Routage strict des familles de signaux par régime (§5).

Le code doit **interdire** un signal de mean reversion en tendance forte, et
inversement. Ce n'est pas une pondération douce : une famille non autorisée
dans le régime courant voit son score forcé à zéro, et la décision est
journalisée.

Contraintes de direction :

* ``trend_up``       -> long uniquement
* ``trend_down``     -> short uniquement
* ``range``          -> les deux sens
* ``high_vol_chaos`` -> plat, aucune position
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import Config
from ..utils import get_logger
from .classifier import CHAOS, RANGE, REGIMES, TREND_DOWN, TREND_UP

log = get_logger("regime.router")


class RoutingViolation(RuntimeError):
    """Une famille interdite a produit une contribution non nulle."""


@dataclass
class RoutingResult:
    score: pd.Series                      # score agrégé après routage
    direction_mask: pd.Series             # -1 short only, +1 long only, 0 flat, 2 = les deux
    contributions: pd.DataFrame           # score de chaque famille après filtrage
    allowed: pd.DataFrame                 # booléen famille x barre
    families_used: pd.Series              # noms des familles actives, pour l'audit
    log_frame: pd.DataFrame = field(default_factory=pd.DataFrame)


class SignalRouter:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.rules = {r: cfg.sub(f"routing.{r}") for r in REGIMES}
        self.weights = dict(cfg.sub("signals.weights"))
        self.log_decisions = bool(cfg.get_path("regime.log_routing_decisions"))

    # ------------------------------------------------------------------ règles
    def allowed_families(self, regime: str) -> list[str]:
        return list(self.rules[regime]["allow"])

    def direction_of(self, regime: str) -> str:
        return str(self.rules[regime]["direction"])

    def _direction_code(self, regime: str) -> float:
        return {"long_only": 1.0, "short_only": -1.0, "both": 2.0, "flat": 0.0}[
            self.direction_of(regime)
        ]

    # ------------------------------------------------------------------ routage
    def route(self, regimes: pd.Series, scores: dict[str, pd.Series]) -> RoutingResult:
        idx = regimes.index
        families = list(scores)
        allowed = pd.DataFrame(False, index=idx, columns=families)
        for regime in REGIMES:
            mask = (regimes == regime).to_numpy()
            if not mask.any():
                continue
            for fam in self.allowed_families(regime):
                if fam in allowed.columns:
                    allowed.loc[mask, fam] = True

        contributions = pd.DataFrame(index=idx, columns=families, dtype=float)
        for fam in families:
            weight = float(self.weights.get(fam, 1.0))
            contributions[fam] = scores[fam].reindex(idx).fillna(0.0) * weight * allowed[fam].astype(float)

        weight_sum = pd.Series(0.0, index=idx)
        for fam in families:
            weight_sum += allowed[fam].astype(float) * abs(float(self.weights.get(fam, 1.0)))
        score = contributions.sum(axis=1) / weight_sum.replace(0.0, np.nan)
        score = score.fillna(0.0).clip(-1.0, 1.0)

        direction_mask = regimes.map(self._direction_code).astype(float)

        # --- application de la contrainte de direction ---
        long_only = direction_mask == 1.0
        short_only = direction_mask == -1.0
        flat = direction_mask == 0.0
        score = score.where(~long_only, score.clip(lower=0.0))
        score = score.where(~short_only, score.clip(upper=0.0))
        score = score.where(~flat, 0.0)

        families_used = allowed.apply(lambda row: "|".join(row.index[row.to_numpy()]), axis=1)

        log_frame = pd.DataFrame()
        if self.log_decisions:
            changes = regimes != regimes.shift(1)
            log_frame = pd.DataFrame(
                {
                    "ts": idx[changes],
                    "regime": regimes[changes].to_numpy(),
                    "direction": [self.direction_of(r) for r in regimes[changes]],
                    "families": [", ".join(self.allowed_families(r)) for r in regimes[changes]],
                }
            )
        return RoutingResult(
            score=score, direction_mask=direction_mask, contributions=contributions,
            allowed=allowed, families_used=families_used, log_frame=log_frame,
        )

    # --------------------------------------------------------------- contrôles
    def assert_no_forbidden_contribution(self, result: RoutingResult, regimes: pd.Series) -> None:
        """Vérifie a posteriori qu'aucune famille interdite n'a contribué."""
        for regime in REGIMES:
            mask = regimes == regime
            if not mask.any():
                continue
            permitted = set(self.allowed_families(regime))
            for fam in result.contributions.columns:
                if fam in permitted:
                    continue
                contribution = result.contributions.loc[mask, fam]
                if (contribution.abs() > 1e-12).any():
                    raise RoutingViolation(
                        f"la famille {fam!r} a contribué en régime {regime!r} "
                        "alors qu'elle y est interdite"
                    )
        # aucune position en chaos
        chaos_mask = regimes == CHAOS
        if chaos_mask.any() and (result.score[chaos_mask].abs() > 1e-12).any():
            raise RoutingViolation("score non nul en régime high_vol_chaos")
        # direction respectée
        up = regimes == TREND_UP
        if up.any() and (result.score[up] < -1e-12).any():
            raise RoutingViolation("score short en régime trend_up")
        down = regimes == TREND_DOWN
        if down.any() and (result.score[down] > 1e-12).any():
            raise RoutingViolation("score long en régime trend_down")
