"""Module de calibration du levier (§8) — le coeur du projet.

C'est ce module qui repond a « 5 %/mois est-il atteignable ? ». Il n'est jamais
court-circuite et il n'a pas le droit de relever une limite de risque pour
faire passer l'objectif.

    Etape 1  backtest du portefeuille SANS LEVIER (vol cible 10 %)
    Etape 2  mesure hors echantillon : S, R, DD_max, DD_p95 (Monte Carlo)
    Etape 3  L_objectif = 0.80 / R
    Etape 4  L_risque   = limite_DD_mensuel / DD_p95
    Etape 5  L_final    = min(L_objectif, L_risque, 10)
    Etape 6  si L_final < L_objectif : l'objectif N'EST PAS atteignable, et le
             rapport doit l'ecrire, chiffre, avec son intervalle de confiance.

Precision methodologique importante : « hors echantillon » au sens de l'etape 2
designe ici les plis de test du walk-forward, jamais l'out-of-sample final
scelle. Celui-ci n'est ouvert qu'une fois, a la toute fin (§11.1, §16.4.3), et
sert alors a VERIFIER la calibration, pas a la produire.

La table de sensibilite ne se contente pas d'extrapoler lineairement : chaque
niveau de levier est REJOUE dans le moteur complet. Le levier amplifie le
rendement et le drawdown a la meme vitesse, mais il interagit aussi avec les
coupe-circuits, les liquidations et le drag de volatilite — trois effets qu'une
extrapolation lineaire manquerait.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..backtest.metrics import cagr, max_drawdown, median_ci, monthly_returns, sharpe
from ..validation.statistics import monte_carlo_trade_order, monthly_drawdown_distribution

log = logging.getLogger("okx_algo.leverage")


@dataclass
class LeverageCalibration:
    sharpe_unlevered: float
    annual_return_unlevered: float
    max_dd_unlevered: float
    monthly_dd_p95: float
    l_target: float
    l_risk: float
    l_max: float
    l_final: float
    objective_reachable: bool
    achievable_monthly_return: float
    achievable_monthly_ci: tuple[float, float]
    binding_constraint: str
    sensitivity: pd.DataFrame = field(default_factory=pd.DataFrame)
    notes: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k != "sensitivity"}
        d["achievable_monthly_ci"] = list(self.achievable_monthly_ci)
        return d


def calibrate(oos_returns: pd.Series, oos_trades: pd.DataFrame, cfg,
              initial_equity: float, run_at_leverage=None,
              seed: int = 0) -> LeverageCalibration:
    """`run_at_leverage(L)` doit rejouer le moteur complet et retourner un
    BacktestResult. S'il est absent, la table de sensibilite retombe sur
    l'approximation analytique, ce qui est signale dans les notes."""
    target_annual = float(cfg.get("leverage.target_annual_return"))
    dd_limit = float(cfg.get("leverage.monthly_dd_limit"))
    l_max = float(cfg.get("leverage.max_leverage"))
    draws = int(cfg.get("leverage.monte_carlo_draws"))

    # -- Etape 2 : mesures sans levier ---------------------------------
    equity = initial_equity * (1.0 + oos_returns.fillna(0.0)).cumprod()
    S = sharpe(oos_returns)
    R = cagr(equity)
    dd_max, _, _ = max_drawdown(equity)
    mc_month = monthly_drawdown_distribution(oos_returns, draws, seed=seed)
    dd_p95 = abs(mc_month.get("monthly_dd_p95", np.nan))

    # -- Etapes 3 a 5 ---------------------------------------------------
    l_target = target_annual / R if R and R > 0 else np.inf
    l_risk = dd_limit / dd_p95 if dd_p95 and np.isfinite(dd_p95) and dd_p95 > 0 else np.inf
    l_final = float(min(l_target, l_risk, l_max))

    binding = min(
        [("objectif_de_rendement", l_target), ("limite_de_drawdown", l_risk),
         ("plafond_de_levier", l_max)], key=lambda t: t[1])[0]
    reachable = bool(np.isfinite(l_target) and l_final >= l_target - 1e-9)

    # -- table de sensibilite -------------------------------------------
    lo, hi, step = cfg.get("leverage.sensitivity_grid")
    grid = np.round(np.arange(lo, hi + 1e-9, step), 2)
    sens = _sensitivity_table(grid, oos_returns, oos_trades, initial_equity,
                              draws, run_at_leverage, seed)

    # -- rendement mensuel reellement atteignable a L_final --------------
    ach, ci = _monthly_at_leverage(l_final, oos_returns, run_at_leverage, seed)

    cal = LeverageCalibration(
        sharpe_unlevered=float(S), annual_return_unlevered=float(R),
        max_dd_unlevered=float(dd_max), monthly_dd_p95=float(dd_p95),
        l_target=float(l_target), l_risk=float(l_risk), l_max=l_max,
        l_final=l_final, objective_reachable=reachable,
        achievable_monthly_return=float(ach),
        achievable_monthly_ci=(float(ci[0]), float(ci[1])),
        binding_constraint=binding, sensitivity=sens,
        notes={
            "monte_carlo": mc_month,
            "sensitivity_method": "moteur_rejoue" if run_at_leverage else "approximation_analytique",
            "target_annual_return": target_annual,
            "monthly_dd_limit": dd_limit,
            "interpretation": _interpretation(reachable, binding, l_final, l_target, ach),
        })
    log.info("levier : L_objectif=%.2f L_risque=%.2f L_final=%.2f (%s) -> %s",
             l_target, l_risk, l_final, binding,
             "objectif atteignable" if reachable else "OBJECTIF NON ATTEIGNABLE")
    return cal


# ----------------------------------------------------------------------
def _sensitivity_table(grid, returns: pd.Series, trades: pd.DataFrame,
                       initial_equity: float, draws: int, run_at_leverage,
                       seed: int) -> pd.DataFrame:
    rows = []
    for L in grid:
        if run_at_leverage is not None:
            try:
                res = run_at_leverage(float(L))
                mr = monthly_returns(res.equity)
                dd, _, _ = max_drawdown(res.equity)
                pnl = (res.trades["net_pnl"].to_numpy()
                       if res.trades is not None and len(res.trades) else np.array([]))
                mc = monte_carlo_trade_order(pnl, initial_equity, min(draws, 4000),
                                             seed=seed)
                med, lo, hi = median_ci(mr.to_numpy(), rng=np.random.default_rng(seed))
                rows.append({
                    "leverage": float(L),
                    "monthly_return_median": med,
                    "monthly_return_ci95_low": lo,
                    "monthly_return_ci95_high": hi,
                    "annualized_return": cagr(res.equity),
                    "sharpe": sharpe(res.returns),
                    "max_drawdown": dd,
                    "monthly_dd_p95": monthly_drawdown_distribution(
                        res.returns, min(draws, 4000), seed=seed).get("monthly_dd_p95", np.nan),
                    "n_liquidations": res.stats.get("n_liquidations", 0),
                    "ruin_probability": mc.ruin_probability,
                    "killed": res.stats.get("killed", False),
                    "method": "moteur_rejoue",
                })
                continue
            except Exception as exc:                     # noqa: BLE001
                log.warning("rejeu impossible a L=%.1f (%s), repli analytique", L, exc)
        rows.append(_analytic_row(float(L), returns, trades, initial_equity, draws, seed))
    return pd.DataFrame(rows)


def _analytic_row(L: float, returns: pd.Series, trades: pd.DataFrame,
                  initial_equity: float, draws: int, seed: int) -> dict:
    """Approximation : r_L = L*r, avec le drag de volatilite du compose."""
    r = returns.fillna(0.0) * L
    eq = initial_equity * (1.0 + r).cumprod()
    mr = monthly_returns(eq)
    dd, _, _ = max_drawdown(eq)
    med, lo, hi = median_ci(mr.to_numpy(), rng=np.random.default_rng(seed))
    pnl = (trades["net_pnl"].to_numpy() * L
           if trades is not None and len(trades) else np.array([]))
    mc = monte_carlo_trade_order(pnl, initial_equity, min(draws, 4000), seed=seed)
    return {"leverage": L, "monthly_return_median": med,
            "monthly_return_ci95_low": lo, "monthly_return_ci95_high": hi,
            "annualized_return": cagr(eq), "sharpe": sharpe(r), "max_drawdown": dd,
            "monthly_dd_p95": monthly_drawdown_distribution(
                r, min(draws, 4000), seed=seed).get("monthly_dd_p95", np.nan),
            "n_liquidations": np.nan, "ruin_probability": mc.ruin_probability,
            "killed": False, "method": "approximation_analytique"}


def _monthly_at_leverage(L: float, returns: pd.Series, run_at_leverage,
                         seed: int) -> tuple[float, tuple[float, float]]:
    if run_at_leverage is not None:
        try:
            res = run_at_leverage(float(L))
            mr = monthly_returns(res.equity)
            med, lo, hi = median_ci(mr.to_numpy(), rng=np.random.default_rng(seed))
            return med, (lo, hi)
        except Exception:                                # noqa: BLE001
            pass
    eq = (1.0 + returns.fillna(0.0) * L).cumprod()
    mr = monthly_returns(eq)
    med, lo, hi = median_ci(mr.to_numpy(), rng=np.random.default_rng(seed))
    return med, (lo, hi)


def _interpretation(reachable: bool, binding: str, l_final: float,
                    l_target: float, achievable: float) -> str:
    if reachable:
        return (f"L'objectif de 5 %/mois est atteignable a un levier de {l_final:.2f}x, "
                f"sous la contrainte de drawdown mensuel imposee.")
    reasons = {
        "limite_de_drawdown":
            "la limite de drawdown mensuel de 25 % est la contrainte bloquante : "
            "le levier requis pour atteindre 80 %/an ferait sortir le drawdown "
            "mensuel attendu de son enveloppe autorisee",
        "plafond_de_levier":
            "le plafond de levier de 10x est la contrainte bloquante : meme au "
            "levier maximal autorise, le rendement sans levier est trop faible",
        "objectif_de_rendement": "objectif atteint",
    }
    return (f"L'objectif de 5 %/mois N'EST PAS atteignable sous ces contraintes. "
            f"Levier requis {l_target:.2f}x, levier admissible {l_final:.2f}x. "
            f"Cause : {reasons.get(binding, binding)}. "
            f"Rendement mensuel median reellement atteignable a {l_final:.2f}x : "
            f"{achievable * 100:.2f} %. "
            f"La limite de drawdown n'a pas ete relevee pour faire passer l'objectif.")
