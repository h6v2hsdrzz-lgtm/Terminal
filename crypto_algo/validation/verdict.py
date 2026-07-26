"""Verdict d'audit : une liste de contrôles explicites, passés ou non.

Un rapport qui se termine par un paragraphe nuancé se lit comme on veut. Une
liste de contrôles binaires, dont trois désignés comme **contrôles cœur**, ne
laisse pas cette latitude : soit l'out-of-sample est positif, soit il ne l'est
pas.

Trois contrôles cœur — s'ils ne passent pas tous les trois, aucun verdict
favorable n'est possible, quel que soit le score global :

1. l'out-of-sample est positif ;
2. la dégradation in-sample -> out-of-sample reste contenue ;
3. le walk-forward est positif en médiane.

Les quatre autres qualifient la solidité : plateau de paramètres, résistance au
doublement des coûts, comparaison au benchmark, taille d'échantillon.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd


@dataclass
class Check:
    key: str
    label: str
    passed: bool
    core: bool
    observed: str
    threshold: str

    def as_row(self) -> dict[str, Any]:
        return {
            "contrôle": self.label,
            "cœur": "oui" if self.core else "non",
            "observé": self.observed,
            "seuil": self.threshold,
            "résultat": "passé" if self.passed else "échoué",
        }


@dataclass
class Verdict:
    checks: list[Check] = field(default_factory=list)

    @property
    def core(self) -> list[Check]:
        return [c for c in self.checks if c.core]

    @property
    def n_passed(self) -> int:
        return sum(1 for c in self.checks if c.passed)

    @property
    def n_core_passed(self) -> int:
        return sum(1 for c in self.core if c.passed)

    @property
    def label(self) -> str:
        if self.n_core_passed < len(self.core):
            return "NON VALIDÉ"
        if self.n_passed == len(self.checks):
            return "ROBUSTE"
        if self.n_passed >= len(self.checks) - 1:
            return "ROBUSTE SOUS RÉSERVE"
        return "FRAGILE"

    @property
    def summary(self) -> str:
        core_names = ", ".join(c.key for c in self.core)
        return (f"{self.n_passed}/{len(self.checks)} contrôles passés "
                f"({self.n_core_passed}/{len(self.core)} contrôles cœur : {core_names})")

    def to_frame(self) -> pd.DataFrame:
        return pd.DataFrame([c.as_row() for c in self.checks])


def _finite(x, default=float("nan")) -> float:
    try:
        v = float(x)
        return v if np.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def build_verdict(
    is_metrics: dict[str, Any],
    oos_metrics: dict[str, Any] | None,
    walk_forward: dict[str, Any] | None,
    plateau: dict[str, Any] | None,
    cost_stress: pd.DataFrame | None,
    benchmark_cagr: float | None,
    min_trades: int = 200,
    max_degradation: float = 0.5,
    min_cost_retention: float = 0.5,
    min_plateau_ratio: float = 0.6,
) -> Verdict:
    checks: list[Check] = []

    # --- contrôle cœur 1 : out-of-sample positif ---
    oos_return = _finite((oos_metrics or {}).get("total_return"))
    checks.append(Check(
        key="OOS", label="Out-of-sample positif", core=True,
        passed=bool(np.isfinite(oos_return) and oos_return > 0),
        observed="non ouvert" if oos_metrics is None else f"{oos_return * 100:+.1f} %",
        threshold="> 0 %",
    ))

    # --- contrôle cœur 2 : dégradation contenue ---
    is_sharpe = _finite(is_metrics.get("sharpe"))
    oos_sharpe = _finite((oos_metrics or {}).get("sharpe"))
    degradation = oos_sharpe - is_sharpe if np.isfinite(oos_sharpe) and np.isfinite(is_sharpe) else float("nan")
    checks.append(Check(
        key="dégradation", label="Dégradation in-sample -> out-of-sample", core=True,
        passed=bool(np.isfinite(degradation) and degradation >= -max_degradation),
        observed="—" if not np.isfinite(degradation) else f"{degradation:+.2f} de Sharpe",
        threshold=f">= {-max_degradation:+.2f}",
    ))

    # --- contrôle cœur 3 : walk-forward positif ---
    wf_median = float("nan")
    if walk_forward:
        medians = []
        for data in walk_forward.values():
            table = data.get("windows") if isinstance(data, dict) else None
            if table is not None and len(table) and "test_sharpe" in table:
                medians.append(float(pd.to_numeric(table["test_sharpe"], errors="coerce").median()))
        if medians:
            wf_median = float(np.median(medians))
    checks.append(Check(
        key="walk-forward", label="Walk-forward positif (Sharpe médian de test)", core=True,
        passed=bool(np.isfinite(wf_median) and wf_median > 0),
        observed="—" if not np.isfinite(wf_median) else f"{wf_median:+.2f}",
        threshold="> 0",
    ))

    # --- plateau de paramètres ---
    ratio = _finite((plateau or {}).get("plateau_ratio"))
    has_positive = bool((plateau or {}).get("has_positive_region", False))
    checks.append(Check(
        key="plateau", label="Zone de performance en plateau, pas en pic", core=False,
        passed=bool(has_positive and np.isfinite(ratio) and ratio >= min_plateau_ratio),
        observed="aucune zone positive" if not has_positive else f"{ratio:.2f}",
        threshold=f">= {min_plateau_ratio:.2f}",
    ))

    # --- résistance au doublement des coûts ---
    retention = float("nan")
    if cost_stress is not None and len(cost_stress) and "sharpe_retention" in cost_stress:
        row = cost_stress[cost_stress["cost_multiplier"] >= 2.0]
        if len(row):
            retention = _finite(row.iloc[-1]["sharpe_retention"])
    checks.append(Check(
        key="coûts x2", label="Edge survivant au doublement des coûts", core=False,
        passed=bool(np.isfinite(retention) and retention >= min_cost_retention),
        observed="—" if not np.isfinite(retention) else f"{retention * 100:.0f} % du Sharpe conservé",
        threshold=f">= {min_cost_retention * 100:.0f} %",
    ))

    # --- comparaison au benchmark ---
    strat_cagr = _finite(is_metrics.get("cagr"))
    bench = _finite(benchmark_cagr)
    checks.append(Check(
        key="benchmark", label="Bat l'achat-conservation du benchmark", core=False,
        passed=bool(np.isfinite(strat_cagr) and np.isfinite(bench) and strat_cagr > bench),
        observed="—" if not np.isfinite(strat_cagr) else f"CAGR {strat_cagr * 100:+.1f} % vs {bench * 100:+.1f} %",
        threshold="CAGR supérieur",
    ))

    # --- taille d'échantillon ---
    trades = int(is_metrics.get("trades") or 0)
    checks.append(Check(
        key="échantillon", label="Échantillon suffisant pour conclure", core=False,
        passed=trades >= min_trades,
        observed=f"{trades} trades",
        threshold=f">= {min_trades}",
    ))

    return Verdict(checks=checks)


def monthly_statement(metrics: dict[str, Any], target: float | None = None) -> str:
    """Phrase de rendement mensuel réellement observé, cible comparée sans complaisance."""
    median = _finite(metrics.get("monthly_median"))
    mean = _finite(metrics.get("monthly_mean"))
    std = _finite(metrics.get("monthly_std"))
    months = int(metrics.get("months") or 0)
    lines = [
        f"Rendement mensuel réellement observé : **{mean * 100:+.2f} %** en moyenne "
        f"(médiane {median * 100:+.2f} %), écart-type {std * 100:.2f} % sur ~{months} mois."
    ]
    if target is not None and np.isfinite(mean):
        atteinte = "atteinte" if mean >= target else "**n'est pas atteinte**"
        lines.append(
            f"Cible affichée : {target * 100:.0f} %/mois — traitée comme un repère à mesurer, "
            f"jamais comme une contrainte. Elle {atteinte} : le rendement mensuel mesuré "
            f"est de {mean * 100:+.2f} %/mois."
        )
    return " ".join(lines)
