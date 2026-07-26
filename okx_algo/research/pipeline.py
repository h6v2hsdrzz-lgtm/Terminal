"""Orchestration de la recherche (§14, §16).

Regles structurantes appliquees ici :

  * toute la recherche se fait sur l'in-sample (2020-2024) ;
  * chaque configuration testee ecrit une ligne dans le registre, qui alimente
    la penalite du Deflated Sharpe ;
  * l'out-of-sample n'est ouvert qu'une seule fois, par `run_oos_validation`,
    qui refuse de s'executer deux fois et scelle l'evenement dans l'etat.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..backtest import benchmarks as bm
from ..backtest.engine import BacktestEngine, Targets
from ..backtest.metrics import alpha_beta, monthly_returns, regime_breakdown, summarize
from ..core.config import Config
from ..core.persist import ComputeCache, RunState, atomic_write_json
from ..data.panel import build_panel
from ..portfolio.combine import combine
from ..strategies.cascade_reversal import CascadeReversal
from ..strategies.cross_sectional import CrossSectionalMomentum
from ..strategies.positioning import PositioningContrarian
from ..strategies.ts_momentum import TSMomentum
from ..validation.statistics import (deflated_sharpe, market_regimes,
                                     monte_carlo_trade_order, sharpe_degradation,
                                     walk_forward_splits)
from .registry import ResearchRegistry, TrialBudgetExhausted

log = logging.getLogger("okx_algo.pipeline")

BRICKS = {"ts_momentum": TSMomentum,
          "cross_sectional": CrossSectionalMomentum,
          "cascade_reversal": CascadeReversal,
          "positioning": PositioningContrarian}


# ----------------------------------------------------------------------
def get_panel(cfg: Config, symbols: list[str] | None = None):
    return build_panel(cfg, symbols=symbols,
                       timeframe=cfg.get("data.signal_timeframe"),
                       with_minute=cfg.get("data.use_minute_resolution", True))


def brick_params(cfg: Config, name: str) -> dict:
    """Parametres d'une brique, enrichis des reglages de portefeuille dont elle
    a besoin pour normaliser sa taille (vol cible, fenetre d'estimation)."""
    p = dict(cfg.get(f"strategies.{name}"))
    p["target_vol_annualized"] = cfg.get("portfolio.target_vol_annualized")
    p["vol_estimator_window_days"] = cfg.get("portfolio.vol_estimator_window_days")
    if name == "ts_momentum":
        p["deadband"] = cfg.get("strategies.ts_momentum.deadband")
    return p


def build_bricks(cfg: Config, panel, names: list[str] | None = None) -> dict:
    names = names or [n for n in BRICKS if cfg.get(f"strategies.{n}.enabled", True)]
    out = {}
    for n in names:
        out[n] = BRICKS[n](brick_params(cfg, n)).compute(panel)
    return out


def make_targets(cfg: Config, panel, names: list[str] | None = None,
                 apply_modulator: bool = True) -> tuple[Targets, dict]:
    bricks = build_bricks(cfg, panel, names)
    return combine(bricks, panel, cfg, apply_modulator=apply_modulator)


def run_engine(cfg: Config, panel, targets: Targets, i0: int, i1: int,
               leverage: float = 1.0, cost_stress: float = 1.0,
               seed: int | None = None, label: str = "run"):
    eng = BacktestEngine(cfg, panel, leverage=leverage, cost_stress=cost_stress,
                         seed=seed)
    return eng.run(targets, i0, i1, label=label)


def window(cfg: Config, panel, which: str) -> tuple[int, int]:
    if which == "is":
        a, b = cfg.is_bounds()
    elif which == "oos":
        a, b = cfg.oos_bounds()
    else:
        return 0, panel.n
    return panel.slice(a, b)


# ----------------------------------------------------------------------
@dataclass
class EvalOutcome:
    metrics: dict
    result: object
    diagnostics: dict


def evaluate(cfg: Config, panel, names: list[str] | None, which: str = "is",
             leverage: float = 1.0, cost_stress: float = 1.0,
             seed: int | None = None, label: str = "eval") -> EvalOutcome:
    targets, diag = make_targets(cfg, panel, names)
    i0, i1 = window(cfg, panel, which)
    res = run_engine(cfg, panel, targets, i0, i1, leverage, cost_stress, seed, label)
    bench = bm.btc_hold(panel, res.stats["initial_equity"], i0=i0, i1=i1)
    m = summarize(res, benchmark_monthly=monthly_returns(bench))
    return EvalOutcome(metrics=m, result=res, diagnostics=diag)


# ======================================================================
# Etapes du pipeline
# ======================================================================
def run_brick_baseline(cfg: Config, state: RunState, brick: str) -> dict:
    """Une brique seule, parametres du mandat, testee in-sample (§14.3-4)."""
    panel = get_panel(cfg)
    reg = ResearchRegistry(cfg.research_root / "research_log.jsonl",
                           cfg.get("research.max_trials"))
    out = evaluate(cfg, panel, [brick], which="is", label=f"baseline_{brick}")
    reg.record("baseline", {"brick": brick, "params": brick_params(cfg, brick)},
               out.metrics, status="baseline",
               note=f"brique {brick} seule, parametres du mandat, in-sample")

    payload = {"brick": brick, "metrics": out.metrics,
               "portfolio_diagnostics": out.diagnostics,
               "per_symbol": _per_symbol(out.result)}
    atomic_write_json(cfg.artifacts_root / f"baseline_{brick}.json", payload)
    state.mark_done(f"baseline:{brick}", sharpe=out.metrics.get("sharpe"),
                    n_trades=out.metrics.get("n_trades"))
    log.info("baseline %s: sharpe=%.3f mensuel_median=%.4f trades=%d",
             brick, out.metrics.get("sharpe", 0), out.metrics.get("monthly_return_median", 0),
             out.metrics.get("n_trades", 0))
    return payload


def run_portfolio_baseline(cfg: Config, state: RunState) -> dict:
    panel = get_panel(cfg)
    reg = ResearchRegistry(cfg.research_root / "research_log.jsonl",
                           cfg.get("research.max_trials"))
    out = evaluate(cfg, panel, None, which="is", label="baseline_portfolio")
    reg.record("baseline", {"scope": "portfolio", "config": _config_fingerprint(cfg)},
               out.metrics, status="baseline",
               note="portefeuille complet, parametres du mandat, in-sample, sans levier")
    payload = {"metrics": out.metrics, "diagnostics": out.diagnostics,
               "per_symbol": _per_symbol(out.result)}
    atomic_write_json(cfg.artifacts_root / "baseline_portfolio.json", payload)
    state.mark_done("baseline:portfolio", sharpe=out.metrics.get("sharpe"))
    return payload


# ----------------------------------------------------------------------
def run_research_loop(cfg: Config, state: RunState) -> dict:
    """Boucle §16 : hypotheses pre-enregistrees, budget strict, registre automatique."""
    from .hypotheses import HYPOTHESIS_ORDER, build_variants

    panel = get_panel(cfg)
    reg = ResearchRegistry(cfg.research_root / "research_log.jsonl",
                           cfg.get("research.max_trials"))
    target_monthly = float(cfg.get("research.target_monthly_return"))
    results: list[dict] = []
    stop_reason = "hypotheses_epuisees"

    for hyp in HYPOTHESIS_ORDER:
        if reg.remaining <= 0:
            stop_reason = "budget_epuise"
            break
        state.set("current_hypothesis", hyp)
        variants = build_variants(cfg, hyp, panel)
        log.info("=== %s : %d configurations ===", hyp, len(variants))
        best_for_hyp = None

        for label, cfg_variant, names in variants:
            if reg.remaining <= 0:
                stop_reason = "budget_epuise"
                break
            params = {"label": label, "overrides": cfg_variant["overrides"],
                      "bricks": names}
            prior = reg.already_run(hyp, params)
            if prior is not None:
                log.info("%s deja evalue, reutilise", label)
                results.append({"hypothesis": hyp, **prior})
                continue

            c = cfg.copy()
            for k, v in cfg_variant["overrides"].items():
                c.set(k, v)
            try:
                out = evaluate(c, panel, names, which="is", label=label)
            except Exception as exc:                       # noqa: BLE001
                log.warning("%s a echoue: %s", label, exc)
                reg.record(hyp, params, {}, status="error", note=str(exc)[:300])
                continue

            m = out.metrics
            status = _status(m, target_monthly)
            try:
                row = reg.record(hyp, params, m, status=status, note=label)
            except TrialBudgetExhausted as exc:
                log.warning(str(exc))
                stop_reason = "budget_epuise"
                break
            results.append({"hypothesis": hyp, **row})
            if best_for_hyp is None or (m.get("sharpe") or -9) > best_for_hyp[1]:
                best_for_hyp = (label, m.get("sharpe") or -9, dict(cfg_variant["overrides"]))

        if best_for_hyp:
            log.info("%s : meilleure config %s (sharpe %.3f)", hyp, best_for_hyp[0],
                     best_for_hyp[1])

    summary = {"stop_reason": stop_reason, "registry": reg.summary(),
               "best": reg.best("is_sharpe"), "n_results": len(results)}
    atomic_write_json(cfg.artifacts_root / "research_summary.json", summary)
    state.set("current_hypothesis", None)
    state.mark_done("research_loop", **{k: v for k, v in summary["registry"].items()
                                        if k != "by_hypothesis"})
    return summary


def _status(m: dict, target_monthly: float) -> str:
    if not np.isfinite(m.get("sharpe", np.nan)):
        return "invalid"
    if (m.get("monthly_return_median") or 0) > target_monthly and (m.get("n_trades") or 0) >= 300:
        return "candidate"
    return "rejected"


# ----------------------------------------------------------------------
def run_leverage_calibration(cfg: Config, state: RunState) -> dict:
    """Module §8, calibre sur les plis de test du walk-forward.

    L'out-of-sample final reste scelle : il servira a VERIFIER cette
    calibration, jamais a la produire.
    """
    from ..leverage.calibrate import calibrate

    panel = get_panel(cfg)
    best = _best_config(cfg)
    c = cfg.copy()
    for k, v in best["overrides"].items():
        c.set(k, v)

    targets, diag = make_targets(c, panel)
    i0, i1 = window(c, panel, "is")
    wf = _walk_forward_returns(c, panel, targets, i0, i1)
    if not len(wf["returns"]):
        raise RuntimeError("walk-forward vide : calibration du levier impossible")

    def run_at(L: float):
        return run_engine(c, panel, targets, i0, i1, leverage=L, label=f"lev_{L}")

    cal = calibrate(wf["returns"], wf["trades"], c,
                    initial_equity=c.get("backtest.initial_equity"),
                    run_at_leverage=run_at, seed=c.get("project.seed"))

    payload = cal.to_dict()
    payload["walk_forward"] = wf["summary"]
    payload["config_used"] = best
    cal.sensitivity.to_csv(cfg.artifacts_root / "leverage_sensitivity.csv", index=False)
    atomic_write_json(cfg.artifacts_root / "leverage_calibration.json", payload)
    state.set("leverage_final", cal.l_final)
    state.mark_done("leverage_calibration", l_final=cal.l_final,
                    reachable=cal.objective_reachable)
    return payload


def _walk_forward_returns(cfg: Config, panel, targets, i0: int, i1: int) -> dict:
    """Concatene les plis de TEST du walk-forward : pseudo hors-echantillon."""
    idx = panel.index[i0:i1]
    splits = []
    for mode in cfg.get("validation.walk_forward.modes"):
        splits += walk_forward_splits(idx, cfg.get("validation.walk_forward.train_months"),
                                      cfg.get("validation.walk_forward.test_months"),
                                      mode=mode)
    anchored = [s for s in splits if s["mode"] == "anchored"]
    parts, trades, rows = [], [], []
    for s in anchored:
        a, b = panel.slice(s["test_start"], s["test_end"])
        if b - a < 100:
            continue
        res = run_engine(cfg, panel, targets, a, b, label="wf")
        parts.append(res.returns)
        if res.trades is not None and len(res.trades):
            trades.append(res.trades)
        m = summarize(res)
        rows.append({"test_start": str(s["test_start"]), "test_end": str(s["test_end"]),
                     "sharpe": m["sharpe"], "monthly_median": m["monthly_return_median"],
                     "max_dd": m["max_drawdown"], "n_trades": m["n_trades"]})
    returns = pd.concat(parts) if parts else pd.Series(dtype=float)
    return {"returns": returns,
            "trades": pd.concat(trades, ignore_index=True) if trades else pd.DataFrame(),
            "summary": {"folds": rows, "n_folds": len(rows),
                        "mean_fold_sharpe": float(np.nanmean([r["sharpe"] for r in rows]))
                        if rows else np.nan,
                        "pct_folds_positive": float(np.mean([r["monthly_median"] > 0
                                                             for r in rows])) if rows else np.nan}}


def _best_config(cfg: Config) -> dict:
    reg = ResearchRegistry(cfg.research_root / "research_log.jsonl",
                           cfg.get("research.max_trials"))
    # Seules les configurations issues de la recherche sont eligibles : une
    # baseline de brique isolee n'est pas une configuration de portefeuille et
    # ne doit pas pouvoir etre retenue comme configuration finale.
    candidates = [r for r in reg.rows()
                  if isinstance(r.get("params"), dict) and "overrides" in r["params"]
                  and r.get("is_sharpe") is not None and r.get("status") != "invalid"]
    if not candidates:
        return {"label": "mandat", "overrides": {}, "source": "parametres_du_mandat"}
    best = max(candidates, key=lambda r: r["is_sharpe"])
    params = best.get("params", {})
    return {"label": params.get("label", "best"),
            "overrides": params.get("overrides", {}),
            "trial_id": best.get("trial_id"), "is_sharpe": best.get("is_sharpe"),
            "source": "meilleure_configuration_du_registre"}


# ----------------------------------------------------------------------
def run_oos_validation(cfg: Config, state: RunState) -> dict:
    """OUVERTURE UNIQUE DE L'OUT-OF-SAMPLE (§11.1, §16.4.3).

    Refuse de s'executer une seconde fois : toute modification de parametres
    apres cette etape invaliderait l'audit.
    """
    if state.get("oos_opened"):
        log.warning("out-of-sample deja ouvert le %s — aucune reouverture",
                    state.get("oos_opened_at"))
        path = cfg.artifacts_root / "oos_validation.json"
        if path.exists():
            import json
            return json.loads(path.read_text())
        raise RuntimeError("out-of-sample deja ouvert mais rapport absent")

    panel = get_panel(cfg)
    best = _best_config(cfg)
    c = cfg.copy()
    for k, v in best["overrides"].items():
        c.set(k, v)

    L = float(state.get("leverage_final") or 1.0)
    targets, diag = make_targets(c, panel)
    is0, is1 = window(c, panel, "is")
    oos0, oos1 = window(c, panel, "oos")

    is_res = run_engine(c, panel, targets, is0, is1, leverage=L, label="final_is")
    oos_res = run_engine(c, panel, targets, oos0, oos1, leverage=L, label="final_oos")

    # marquage immediat : l'ouverture est un fait, meme si la suite echoue
    state.data["oos_opened"] = True
    state.data["oos_opened_at"] = pd.Timestamp.utcnow().isoformat()
    state.save()

    reg = ResearchRegistry(cfg.research_root / "research_log.jsonl",
                           cfg.get("research.max_trials"))
    is_m = summarize(is_res)
    bench_oos = bm.build_all(panel, oos_res.stats["initial_equity"], oos0, oos1,
                             bars_per_hour=_bars_per_hour(panel))
    oos_m = summarize(oos_res, benchmark_monthly=monthly_returns(bench_oos["btc_hold"]))

    dsr = deflated_sharpe(oos_res.returns, n_trials=reg.n_trials,
                          trial_sharpes=reg.sharpes())
    btc_ret = bench_oos["btc_hold"].pct_change()
    ab = alpha_beta(oos_res.returns, btc_ret)
    regimes = market_regimes(pd.Series(panel.data["BTC-USDT-SWAP"].close[oos0:oos1],
                                       index=panel.index[oos0:oos1]))
    reg_table = regime_breakdown(oos_res.equity, regimes)
    mc = monte_carlo_trade_order(
        oos_res.trades["net_pnl"].to_numpy() if len(oos_res.trades) else np.array([]),
        oos_res.stats["initial_equity"], cfg.get("validation.monte_carlo_draws"),
        seed=cfg.get("project.seed"))

    stress = {}
    for mult in cfg.get("validation.cost_stress_multipliers"):
        r = run_engine(c, panel, targets, oos0, oos1, leverage=L, cost_stress=mult,
                       label=f"oos_stress_{mult}")
        stress[str(mult)] = summarize(r)

    degradation = sharpe_degradation(is_m["sharpe"], oos_m["sharpe"])
    gates = _go_no_go(cfg, oos_m, dsr, degradation, reg_table, stress)

    payload = {
        "opened_at": state.get("oos_opened_at"),
        "config_used": best,
        "leverage_applied": L,
        "in_sample": is_m,
        "out_of_sample": oos_m,
        "sharpe_degradation": degradation,
        "deflated_sharpe": dsr,
        "alpha_beta_vs_btc": ab,
        "regimes": reg_table.to_dict("records"),
        "monte_carlo": mc.summary,
        "cost_stress": stress,
        "benchmarks_oos": {c_: _bench_metrics(bench_oos[c_]) for c_ in bench_oos.columns},
        "go_no_go": gates,
        "trials_consumed": reg.n_trials,
    }
    atomic_write_json(cfg.artifacts_root / "oos_validation.json", payload)
    oos_res.equity.to_frame("equity").to_csv(cfg.artifacts_root / "oos_equity.csv")
    if len(oos_res.trades):
        oos_res.trades.to_csv(cfg.artifacts_root / "oos_trades.csv", index=False)
    state.mark_done("oos_validation", passed=gates["all_passed"])
    return payload


def _go_no_go(cfg: Config, oos: dict, dsr: dict, degradation: float,
              regimes: pd.DataFrame, stress: dict) -> dict:
    g = cfg.get("go_no_go")
    profitable_regimes = int((regimes["total_return"] > 0).sum()) if len(regimes) else 0
    x2 = stress.get("2.0", {})
    checks = {
        "sharpe_oos_min": {"required": g["min_oos_sharpe"], "observed": oos.get("sharpe"),
                           "passed": bool((oos.get("sharpe") or -9) >= g["min_oos_sharpe"])},
        "dsr_significant": {"required": f"p < {g['max_dsr_pvalue']}",
                            "observed": dsr.get("p_value"),
                            "passed": bool((dsr.get("p_value") or 1.0) < g["max_dsr_pvalue"])},
        "min_trades": {"required": g["min_oos_trades"], "observed": oos.get("n_trades"),
                       "passed": bool((oos.get("n_trades") or 0) >= g["min_oos_trades"])},
        "sharpe_degradation": {"required": f"< {g['max_sharpe_degradation']}",
                               "observed": degradation,
                               "passed": bool(np.isfinite(degradation)
                                              and degradation < g["max_sharpe_degradation"])},
        "profitable_regimes": {"required": g["min_profitable_regimes"],
                               "observed": profitable_regimes,
                               "passed": bool(profitable_regimes >= g["min_profitable_regimes"])},
        "survives_2x_costs": {"required": "rendement net > 0 a couts x2",
                              "observed": x2.get("cagr"),
                              "passed": bool((x2.get("cagr") or -1) > 0)},
    }
    return {"checks": checks, "all_passed": all(v["passed"] for v in checks.values())}


def _bench_metrics(equity: pd.Series) -> dict:
    from ..backtest.metrics import cagr as _c, max_drawdown as _mdd, sharpe as _s
    r = equity.pct_change().fillna(0.0)
    mdd, _, _ = _mdd(equity)
    mr = monthly_returns(equity)
    return {"cagr": _c(equity), "sharpe": _s(r), "max_drawdown": mdd,
            "monthly_return_median": float(mr.median()) if len(mr) else np.nan,
            "total_return": float(equity.iloc[-1] / equity.iloc[0] - 1.0)}


def _per_symbol(result) -> dict:
    if result.trades is None or not len(result.trades):
        return {}
    g = result.trades.groupby("symbol")
    return {s: {"n_trades": int(len(d)), "net_pnl": float(d["net_pnl"].sum()),
                "win_rate": float((d["net_pnl"] > 0).mean()),
                "fees": float(d["fees"].sum()), "funding": float(d["funding"].sum())}
            for s, d in g}


def _config_fingerprint(cfg: Config) -> dict:
    return {"target_vol": cfg.get("portfolio.target_vol_annualized"),
            "deadband": cfg.get("strategies.ts_momentum.deadband"),
            "horizons": cfg.get("strategies.ts_momentum.horizons_hours")}


def _bars_per_hour(panel) -> float:
    return 60.0 / {"1m": 1, "15m": 15, "1H": 60, "4H": 240, "1D": 1440}[panel.timeframe]
