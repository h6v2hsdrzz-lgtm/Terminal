"""Validation du moteur AVANT tout signal (§14, etape 2).

Aucune brique n'est ecrite tant que ces tests ne passent pas. Ils repondent aux
questions qui invalideraient tout le reste :

  T1  sans couts ni funding, le moteur reproduit-il un buy & hold analytique ?
  T2  activer les couts degrade-t-il strictement la performance ?
  T3  le funding est-il preleve du bon cote (le long paie quand le taux > 0) ?
  T4  une strategie a entrees aleatoires perd-elle de l'argent ? (§11.8)
  T5  le plafond de levier est-il applique ?
  T6  les coupe-circuits de drawdown se declenchent-ils et mettent-ils a plat ?
  T7  les features sont-elles insensibles a une corruption du futur ? (§10)
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from ..core.config import Config
from ..core.persist import RunState, atomic_write_json, atomic_write_text
from ..data.panel import build_panel
from ..features import core as F
from ..strategies.trivial import buy_and_hold, random_entries
from .engine import BacktestEngine
from .metrics import summarize

log = logging.getLogger("okx_algo.selftest")

TEST_START = "2022-01-01"
TEST_END = "2023-01-01"


def permissive(cfg: Config) -> Config:
    """Config sans coupe-circuits : isole le comportement teste."""
    c = cfg.copy()
    for k, v in {"risk.daily_dd_stop": -0.99, "risk.weekly_dd_stop": -0.99,
                 "risk.monthly_dd_stop": -0.99, "risk.global_kill_switch": -0.99,
                 "risk.stop_loss_required": False, "risk.risk_per_trade": 1e9,
                 "risk.max_concurrent_positions": 10, "risk.leverage_effective_max": 50.0,
                 "strategies.ts_momentum.deadband": 0.02,
                 "costs.maker.enabled": False}.items():
        c.set(k, v)
    return c


def _run(cfg, panel, targets, **kw):
    eng = BacktestEngine(cfg, panel, **kw)
    i0, i1 = panel.slice(TEST_START, TEST_END)
    return eng.run(targets, i0, i1)


# ----------------------------------------------------------------------
def t1_buy_and_hold_fidelity(cfg: Config, panel) -> dict:
    c = permissive(cfg)
    res = _run(c, panel, buy_and_hold(panel, "BTC-USDT-SWAP", 1.0),
               cost_stress=0.0, funding_enabled=False)
    i0, i1 = panel.slice(TEST_START, TEST_END)
    px = panel.data["BTC-USDT-SWAP"].close[i0:i1]
    px = px[np.isfinite(px)]
    analytic = px[-1] / px[0] - 1.0
    engine_ret = res.equity.iloc[-1] / res.equity.iloc[0] - 1.0
    err = abs(engine_ret - analytic)
    # 1x rebalance avec deadband n'est pas exactement un buy & hold passif :
    # la tolerance couvre cet ecart de convexite, pas une erreur de comptabilite.
    return {"test": "T1_buy_and_hold_fidelity", "analytic_return": float(analytic),
            "engine_return": float(engine_ret), "abs_error": float(err),
            "tolerance": 0.05, "passed": bool(err < 0.05)}


def t2_costs_degrade(cfg: Config, panel) -> dict:
    c = permissive(cfg)
    tgt = buy_and_hold(panel, "BTC-USDT-SWAP", 1.0)
    free = _run(c, panel, tgt, cost_stress=0.0, funding_enabled=False)
    charged = _run(c, panel, tgt, cost_stress=1.0, funding_enabled=False)
    stressed = _run(c, panel, tgt, cost_stress=2.0, funding_enabled=False)
    a = float(free.equity.iloc[-1])
    b = float(charged.equity.iloc[-1])
    d = float(stressed.equity.iloc[-1])
    return {"test": "T2_costs_degrade", "equity_no_costs": a, "equity_costs": b,
            "equity_costs_x2": d, "fees_charged": charged.stats["fees_total"],
            "passed": bool(a > b > d and charged.stats["fees_total"] > 0)}


def t3_funding_sign(cfg: Config, panel) -> dict:
    """Le long doit payer quand le funding moyen est positif, le short encaisser."""
    c = permissive(cfg)
    i0, i1 = panel.slice(TEST_START, TEST_END)
    mean_rate = float(np.mean(panel.data["BTC-USDT-SWAP"].funding[i0:i1]))
    lng = _run(c, panel, buy_and_hold(panel, "BTC-USDT-SWAP", 1.0),
               cost_stress=0.0, funding_enabled=True)
    sht = _run(c, panel, buy_and_hold(panel, "BTC-USDT-SWAP", -1.0),
               cost_stress=0.0, funding_enabled=True)
    long_paid = lng.stats["funding_total"]
    short_paid = sht.stats["funding_total"]
    ok = (long_paid > 0 > short_paid) if mean_rate > 0 else (long_paid < 0 < short_paid)
    return {"test": "T3_funding_sign", "mean_funding_rate": mean_rate,
            "long_funding_paid": float(long_paid), "short_funding_paid": float(short_paid),
            "passed": bool(ok)}


def t4_random_control_loses(cfg: Config, panel, n_runs: int = 30) -> dict:
    """Controle negatif : memes couts, meme sizing, direction aleatoire."""
    rets, sharpes = [], []
    for k in range(n_runs):
        res = _run(cfg, panel, random_entries(panel, seed=1000 + k),
                   seed=1000 + k, cost_stress=1.0, funding_enabled=True)
        s = summarize(res)
        rets.append(res.equity.iloc[-1] / res.equity.iloc[0] - 1.0)
        sharpes.append(s["sharpe"])
    rets = np.array(rets, dtype=float)
    return {"test": "T4_random_control_loses", "n_runs": n_runs,
            "mean_return": float(rets.mean()), "median_return": float(np.median(rets)),
            "pct_profitable": float((rets > 0).mean()),
            "mean_sharpe": float(np.nanmean(sharpes)),
            "passed": bool(rets.mean() < 0 and np.median(rets) < 0)}


def t5_leverage_cap(cfg: Config, panel) -> dict:
    """Une cible a 30x doit etre refusee et le levier reel rester sous la borne."""
    c = cfg.copy()
    c.set("risk.stop_loss_required", False)
    c.set("risk.risk_per_trade", 1e9)
    c.set("risk.daily_dd_stop", -0.99)
    c.set("risk.weekly_dd_stop", -0.99)
    c.set("risk.monthly_dd_stop", -0.99)
    c.set("risk.global_kill_switch", -0.99)
    tgt = buy_and_hold(panel, "BTC-USDT-SWAP", 30.0)
    res = _run(c, panel, tgt, cost_stress=1.0)
    cap = cfg.get("risk.leverage_effective_max")
    observed = res.stats["max_gross_leverage"]
    refused = 0
    if len(res.positions_log):
        refused = int((res.positions_log["reason"] == "levier_effectif_max").sum())
    return {"test": "T5_leverage_cap", "cap": cap, "max_observed_leverage": float(observed),
            "n_orders_refused": refused,
            "passed": bool(observed <= cap * 1.001 and refused > 0)}


def t6_drawdown_halts(cfg: Config, panel) -> dict:
    """Avec des bornes tres serrees, les coupe-circuits doivent se declencher."""
    c = cfg.copy()
    c.set("risk.daily_dd_stop", -0.005)
    c.set("risk.stop_loss_required", False)
    c.set("risk.risk_per_trade", 1e9)
    res = _run(c, panel, buy_and_hold(panel, "BTC-USDT-SWAP", 3.0), cost_stress=1.0)
    ev = res.risk_events
    n_halts = int((ev["event"] == "daily_dd_stop").sum()) if len(ev) else 0
    return {"test": "T6_drawdown_halts", "n_daily_halts": n_halts,
            "passed": bool(n_halts > 0)}


def t7_no_lookahead_features(cfg: Config, panel) -> dict:
    """Corrompre le futur ne doit rien changer aux valeurs passees (§10)."""
    close = panel.data["BTC-USDT-SWAP"].close.copy()
    n = len(close)
    cut = int(n * 0.6)
    corrupted = close.copy()
    rng = np.random.default_rng(7)
    corrupted[cut:] = corrupted[cut:] * rng.uniform(0.3, 3.0, size=n - cut)

    checks = {}
    for name, fn in {
        "log_return_168": lambda c: F.shift1(F.log_return(c, 168)),
        "ewma_vol": lambda c: F.shift1(F.ewma_vol(np.diff(np.log(c), prepend=np.nan), 480)),
        "zscore_720": lambda c: F.shift1(F.zscore(c, 720)),
        "rolling_median_720": lambda c: F.shift1(F.rolling_median(c, 720)),
    }.items():
        a = fn(close)[:cut]
        b = fn(corrupted)[:cut]
        both = np.isfinite(a) & np.isfinite(b)
        checks[name] = bool(np.allclose(a[both], b[both], rtol=1e-12, atol=1e-12))
    return {"test": "T7_no_lookahead_features", "checks": checks,
            "passed": bool(all(checks.values()))}


# ----------------------------------------------------------------------
def run_engine_selftest(cfg: Config, state: RunState) -> dict:
    panel = build_panel(cfg, timeframe=cfg.get("data.signal_timeframe"),
                        with_minute=False, start="2021-06-01", end=TEST_END)
    tests = [
        t1_buy_and_hold_fidelity(cfg, panel),
        t2_costs_degrade(cfg, panel),
        t3_funding_sign(cfg, panel),
        t4_random_control_loses(cfg, panel),
        t5_leverage_cap(cfg, panel),
        t6_drawdown_halts(cfg, panel),
        t7_no_lookahead_features(cfg, panel),
    ]
    passed = all(t["passed"] for t in tests)
    report = {"generated_at": pd.Timestamp.utcnow().isoformat(),
              "window": [TEST_START, TEST_END], "all_passed": passed, "tests": tests}
    atomic_write_json(cfg.artifacts_root / "engine_selftest.json", report)
    atomic_write_text(cfg.artifacts_root / "engine_selftest.md", _md(report))
    for t in tests:
        log.info("%-32s %s", t["test"], "OK" if t["passed"] else "ECHEC")
    if not passed:
        raise RuntimeError("validation du moteur echouee : voir artifacts/engine_selftest.md. "
                           "Aucune brique ne doit etre ecrite tant que ces tests echouent.")
    state.mark_done("engine_selftest_report", all_passed=passed)
    return report


def _md(report: dict) -> str:
    lines = ["# Validation du moteur de backtest", "",
             f"Genere le {report['generated_at']}",
             f"Fenetre de test : {report['window'][0]} -> {report['window'][1]}", "",
             f"**Resultat global : {'TOUS LES TESTS PASSENT' if report['all_passed'] else 'ECHEC'}**",
             "", "| Test | Resultat | Details |", "|---|---|---|"]
    for t in report["tests"]:
        details = ", ".join(f"{k}={_fmt(v)}" for k, v in t.items()
                            if k not in ("test", "passed"))
        lines.append(f"| {t['test']} | {'OK' if t['passed'] else 'ECHEC'} | {details} |")
    return "\n".join(lines)


def _fmt(v):
    if isinstance(v, float):
        return f"{v:.6g}"
    return str(v)
