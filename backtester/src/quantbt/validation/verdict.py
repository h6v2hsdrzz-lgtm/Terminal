"""Aggregate validation flags into one clear verdict: ROBUST / FRAGILE / OVERFIT."""

from __future__ import annotations

from dataclasses import dataclass, field

from quantbt.validation.common import Flag, ValidationOutcome

#: Modules whose failure means the backtest performance is illusory.
_CRITICAL_MODULES = {"oos", "walkforward", "detrend"}


@dataclass(frozen=True)
class Verdict:
    label: str  # "ROBUST" | "FRAGILE" | "OVERFIT"
    score: float  # 0..1, share of passing checks (weighted)
    reasons: list[str] = field(default_factory=list)


def compute_verdict(outcomes: list[ValidationOutcome]) -> Verdict:
    flags: list[tuple[str, Flag]] = [
        (o.module, f) for o in outcomes for f in o.flags
    ]
    if not flags:
        return Verdict("FRAGILE", 0.0, ["no validation was run"])

    n_fail = sum(1 for _, f in flags if f.status == "fail")
    n_warn = sum(1 for _, f in flags if f.status == "warn")
    n_pass = sum(1 for _, f in flags if f.status == "pass")
    total = n_fail + n_warn + n_pass
    score = (n_pass + 0.5 * n_warn) / total

    critical_fail = any(
        f.status == "fail" and module in _CRITICAL_MODULES for module, f in flags
    )

    reasons = [f"[{f.status.upper()}] {f.name}: {f.detail}" for _, f in flags
               if f.status != "pass"]

    if critical_fail or n_fail >= 2:
        label = "OVERFIT"
    elif n_fail == 1 or n_warn >= 2 or score < 0.7:
        label = "FRAGILE"
    else:
        label = "ROBUST"
        if not reasons:
            reasons = ["all validation checks passed"]
    return Verdict(label, round(score, 3), reasons)
