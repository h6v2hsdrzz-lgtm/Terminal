"""Verdict final : ROBUSTE / FRAGILE / OVERFIT, à partir de seuils explicites.

Les seuils viennent de la config et servent à CLASSER, jamais à optimiser.
Le chiffre mis en avant est le rendement mensuel RÉELLEMENT MESURÉ
out-of-sample avec les paramètres par défaut — pas un objectif, pas un
chiffre in-sample, pas le meilleur fold.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from goldsilver.config import ReportConfig
from goldsilver.validation.detrend import DetrendResult
from goldsilver.validation.monte_carlo import MonteCarloResult
from goldsilver.validation.noise import NoiseResult
from goldsilver.validation.oos import OOSResult
from goldsilver.validation.sensitivity import SensitivityResult
from goldsilver.validation.walk_forward import WalkForwardResult

LABEL_ROBUST = "ROBUSTE"
LABEL_FRAGILE = "FRAGILE"
LABEL_OVERFIT = "OVERFIT / PAS D'EDGE"


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    core: bool
    value: str        # ce qui a été mesuré
    threshold: str    # ce qui était exigé


@dataclass(frozen=True)
class Verdict:
    label: str
    checks: list[Check]
    n_passed: int
    n_total: int
    oos_monthly_mean: float       # LE chiffre honnête (défaut, OOS)
    oos_monthly_std: float
    oos_n_months: float
    wf_oos_annual_return: float   # rendement annualisé des segments 100 % OOS
    benchmark_pct: tuple[float, float]
    benchmark_verdict: str        # phrase factuelle sur la cible 5-6 %/mois

    @property
    def n_core_passed(self) -> int:
        return sum(1 for c in self.checks if c.core and c.passed)


def _fmt_pct(x: float) -> str:
    return "n/a" if x is None or not math.isfinite(x) else f"{100 * x:+.2f} %"


def _fmt(x: float, nd: int = 2) -> str:
    return "n/a" if x is None or not math.isfinite(x) else f"{x:.{nd}f}"


def build_verdict(
    oos: OOSResult,
    wf: WalkForwardResult,
    mc: MonteCarloResult,
    noise: NoiseResult,
    detrend: DetrendResult,
    sens: SensitivityResult,
    report_cfg: ReportConfig,
) -> Verdict:
    th = report_cfg.thresholds
    checks: list[Check] = []

    d_oos = oos.default_oos.metrics
    d_is = oos.default_is.metrics
    t_ret = oos.tuned_retention["sharpe_retention"]

    # 1 — profitabilité OOS pure (paramètres par défaut, jamais optimisés)
    c1 = d_oos.total_return > 0 and d_oos.profit_factor > 1.0 and d_oos.sharpe > 0
    checks.append(Check(
        name="OOS profitable (paramètres par défaut)",
        passed=c1, core=True,
        value=(f"rendement {_fmt_pct(d_oos.total_return)}, Sharpe {_fmt(d_oos.sharpe)}, "
               f"PF {_fmt(d_oos.profit_factor)}, {d_oos.n_trades} trades"),
        threshold="rendement > 0, Sharpe > 0, PF > 1",
    ))

    # 2 — la sélection de paramètres généralise-t-elle ? (rétention Sharpe IS -> OOS)
    min_ret = th["oos_sharpe_retention"]
    c2 = math.isfinite(t_ret) and t_ret >= min_ret and oos.tuned_oos.metrics.sharpe > 0
    checks.append(Check(
        name="Dégradation IS -> OOS (paramètres optimisés sur le train)",
        passed=c2, core=True,
        value=(f"Sharpe IS {_fmt(oos.tuned_is.metrics.sharpe)} -> "
               f"OOS {_fmt(oos.tuned_oos.metrics.sharpe)} (rétention {_fmt(t_ret)}) ; "
               f"défaut : IS {_fmt(d_is.sharpe)} -> OOS {_fmt(d_oos.sharpe)}"),
        threshold=f"rétention >= {min_ret:.2f} et Sharpe OOS > 0",
    ))

    # 3 — walk-forward
    c3 = (
        math.isfinite(wf.wfe)
        and wf.wfe >= th["wfe_min"]
        and wf.profitable_folds_frac >= th["wf_profitable_folds_min"]
    )
    checks.append(Check(
        name="Walk-forward (fenêtre glissante)",
        passed=c3, core=True,
        value=(f"WFE {_fmt(wf.wfe)}, folds profitables "
               f"{wf.profitable_folds_frac:.0%} ({wf.n_folds} folds)"),
        threshold=(f"WFE >= {th['wfe_min']:.2f} et folds profitables >= "
                   f"{th['wf_profitable_folds_min']:.0%}"),
    ))

    # 4 — Monte-Carlo
    c4 = (
        mc.shuffle.p_ruin <= th["mc_ruin_prob_max"]
        and mc.shuffle.ret_p5 >= th["mc_p5_total_return_min"]
    )
    checks.append(Check(
        name="Monte-Carlo (reshuffle des trades)",
        passed=c4, core=False,
        value=(f"P(DD >= {mc.ruin_drawdown:.0%}) = {mc.shuffle.p_ruin:.1%}, "
               f"rendement p5 {_fmt_pct(mc.shuffle.ret_p5)}, "
               f"DD p95 {_fmt_pct(-mc.shuffle.dd_p95)}"),
        threshold=(f"P(ruine) <= {th['mc_ruin_prob_max']:.0%} et p5 >= "
                   f"{_fmt_pct(th['mc_p5_total_return_min'])}"),
    ))

    # 5 — bruit
    c5 = (
        noise.profitable_frac >= th["noise_profitable_frac_min"]
        and math.isfinite(noise.sharpe_retention)
        and noise.sharpe_retention >= th["noise_sharpe_retention"]
    )
    checks.append(Check(
        name="Noise test (stabilité au bruit de prix)",
        passed=c5, core=False,
        value=(f"{noise.profitable_frac:.0%} des {noise.n_runs} runs profitables, "
               f"Sharpe médian {_fmt(noise.sharpe_median)} vs base {_fmt(noise.base_sharpe)}"),
        threshold=(f">= {th['noise_profitable_frac_min']:.0%} profitables et rétention "
                   f">= {th['noise_sharpe_retention']:.2f}"),
    ))

    # 6 — detrend
    c6 = detrend.residual_sharpe > 0
    checks.append(Check(
        name="Detrending (edge hors tendance de fond)",
        passed=c6, core=False,
        value=(f"Sharpe détendu {_fmt(detrend.residual_sharpe)} "
               f"(base {_fmt(detrend.base.metrics.sharpe)}) ; rendement mensuel détendu "
               f"{_fmt_pct(detrend.residual_monthly_mean)}"),
        threshold="Sharpe détendu > 0",
    ))

    # 7 — sensibilité
    c7 = math.isfinite(sens.plateau_score) and sens.plateau_score >= th["sensitivity_plateau_min"]
    checks.append(Check(
        name="Sensibilité aux paramètres (plateau vs pic)",
        passed=c7, core=False,
        value=f"score de plateau {_fmt(sens.plateau_score)}",
        threshold=f">= {th['sensitivity_plateau_min']:.2f}",
    ))

    n_passed = sum(c.passed for c in checks)
    core_passed = sum(c.passed for c in checks if c.core)
    if not c1:
        label = LABEL_OVERFIT
    elif core_passed == 3 and n_passed >= 6:
        label = LABEL_ROBUST
    elif core_passed >= 2 and n_passed >= 4:
        label = LABEL_FRAGILE
    else:
        label = LABEL_OVERFIT

    lo, hi = report_cfg.monthly_benchmark_pct
    mm = d_oos.monthly_mean * 100.0
    if mm >= lo:
        bench = (f"La cible de {lo:.0f}-{hi:.0f} %/mois est atteinte sur cet "
                 f"échantillon OOS ({mm:+.2f} %/mois) — mais lisez la dispersion "
                 f"et le verdict avant d'y croire.")
    else:
        bench = (f"La cible de {lo:.0f}-{hi:.0f} %/mois N'EST PAS atteinte : "
                 f"le rendement mensuel OOS réellement mesuré est {mm:+.2f} %/mois.")

    n_months = d_oos.n_days / 30.44
    wf_ann = (
        float("nan")
        if len(wf.stitched_equity) == 0
        else (
            float(wf.stitched_equity.iloc[-1])
            ** (365.25 / max((wf.stitched_equity.index[-1] - wf.stitched_equity.index[0]).days, 1))
            - 1.0
        )
    )

    return Verdict(
        label=label,
        checks=checks,
        n_passed=n_passed,
        n_total=len(checks),
        oos_monthly_mean=d_oos.monthly_mean,
        oos_monthly_std=d_oos.monthly_std,
        oos_n_months=n_months,
        wf_oos_annual_return=wf_ann,
        benchmark_pct=report_cfg.monthly_benchmark_pct,
        benchmark_verdict=bench,
    )
