#!/usr/bin/env python3
"""Orchestrateur de la recherche : phases 1 -> 6 du plan de construction.

    python scripts/run_research.py --phase quality      # contrôle qualité seul
    python scripts/run_research.py --phase research     # in-sample + validation
    python scripts/run_research.py --phase oos --unlock-oos "audit terminé"

Le rapport HTML est produit **quelle que soit la conclusion**. L'out-of-sample
n'est lisible qu'en fournissant explicitement ``--unlock-oos`` : c'est la
traduction opérationnelle de « on ne le regarde qu'une fois, à la fin ».
"""

from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from crypto_algo.backtest.engine import BacktestEngine  # noqa: E402
from crypto_algo.config import load_config, resolve_path  # noqa: E402
from crypto_algo.data.funding import build_and_store_funding  # noqa: E402
from crypto_algo.data.loader import load_market_data, split_bounds  # noqa: E402
from crypto_algo.data.quality import run_quality_control  # noqa: E402
from crypto_algo.features.pipeline import effective_warmup  # noqa: E402
from crypto_algo.reports import plots  # noqa: E402
from crypto_algo.reports.html import callout, image, kpi_grid, render_report, table_html  # noqa: E402
from crypto_algo.reports.metrics import compute_metrics, summarize_by  # noqa: E402
from crypto_algo.strategies.composite import RoutedMultiFamilyStrategy  # noqa: E402
from crypto_algo.utils import ensure_dir, get_logger, setup_logging  # noqa: E402
from crypto_algo.validation.benchmarks import build_benchmarks  # noqa: E402
from crypto_algo.validation.deflated_sharpe import TrialRegistry, deflated_sharpe_ratio  # noqa: E402
from crypto_algo.validation.monte_carlo import run_monte_carlo, ruin_probability_by_risk  # noqa: E402
from crypto_algo.validation.robustness import (  # noqa: E402
    alpha_beta, cost_stress, heatmap, plateau_score, regime_breakdown, sensitivity_table,
)
from crypto_algo.validation.runner import DEFAULT_GRID, ValidationRunner  # noqa: E402

log = get_logger("scripts.research")


# ---------------------------------------------------------------------------
def out_dir(cfg) -> Path:
    return ensure_dir(resolve_path(cfg, cfg.get_path("reports.output_dir")))


def save_table(df: pd.DataFrame, cfg, name: str) -> None:
    if df is None or len(df) == 0:
        return
    path = ensure_dir(out_dir(cfg) / "tables") / f"{name}.csv"
    df.to_csv(path, index=False)


def research_cache_path(cfg) -> Path:
    return out_dir(cfg) / "research_cache.pkl"


def save_research_cache(cfg, research: dict) -> None:
    """Persiste les résultats in-sample pour que l'ouverture de l'OOS ne
    réexécute pas une heure de validation déjà faite (et déjà comptée dans le
    registre d'essais)."""
    payload = {k: v for k, v in research.items() if k not in ("market_data", "registry")}
    payload["_n_trials"] = research["registry"].n_trials
    payload["_trial_sharpes"] = research["registry"].sharpes()
    with open(research_cache_path(cfg), "wb") as fh:
        pickle.dump(payload, fh)
    log.info("Cache de recherche écrit : %s", research_cache_path(cfg))


def load_research_cache(cfg) -> dict | None:
    path = research_cache_path(cfg)
    if not path.exists():
        return None
    with open(path, "rb") as fh:
        payload = pickle.load(fh)
    registry = TrialRegistry.load(out_dir(cfg) / "trials.json")
    payload["registry"] = registry
    log.info("Cache de recherche relu (%d essais enregistrés)", registry.n_trials)
    return payload


def phase_quality(cfg) -> pd.DataFrame:
    log.info("=== Phase 1 : contrôle qualité des données ===")
    table = run_quality_control(cfg)
    log.info("Reconstruction du funding (réel + prime perp/index)")
    calibration = build_and_store_funding(cfg)
    save_table(calibration, cfg, "funding_calibration")
    log.info("\n%s", calibration.to_string(index=False))
    return table, calibration


# ---------------------------------------------------------------------------
def phase_research(cfg, quick: bool = False) -> dict:
    log.info("=== Phases 5-6 : in-sample et validation ===")
    md = load_market_data(cfg, split="in_sample", include_intrabar=True)
    is_start, is_end = split_bounds(cfg, "in_sample")

    registry = TrialRegistry.load(out_dir(cfg) / "trials.json")
    runner = ValidationRunner(cfg, md, registry=registry)

    grid = DEFAULT_GRID if not quick else {"entry_threshold": [0.35], "atr_stop_mult": [2.0]}
    # Grille réduite pour le walk-forward et le k-fold : chaque fenêtre est
    # réoptimisée, donc explorer trois axes par fenêtre multiplie les essais (et
    # le surajustement local) sans rien apprendre de plus. La grille complète
    # sert à l'étude de sensibilité, qui est faite une fois sur tout l'IS.
    wf_grid = {"entry_threshold": [0.25, 0.35, 0.45], "atr_stop_mult": [1.5, 2.5]}
    if quick:
        wf_grid = grid

    # ---- 1. référence : configuration par défaut, in-sample ----------------
    log.info("-- backtest de référence (paramètres du YAML) --")
    baseline = runner.run_once({}, is_start, is_end, label="baseline_is")
    log.info("baseline in-sample : %s", {k: round(v, 4) for k, v in baseline.metrics.items()
                                         if isinstance(v, float) and np.isfinite(v)
                                         and k in {"cagr", "sharpe", "max_drawdown", "total_return"}})

    # ---- 2. sensibilité des paramètres (plateau ou pic ?) ------------------
    log.info("-- étude de sensibilité --")
    grid_outcomes = runner.grid(grid, is_start, is_end, label="sensitivity")
    sens = sensitivity_table(grid_outcomes)
    plateau = plateau_score(sens)
    best = runner.best_of(grid_outcomes)
    heat_entry_stop = heatmap(sens, "entry_threshold", "atr_stop_mult")
    heat_entry_fam = heatmap(sens, "entry_threshold", "min_families_agreeing") if "min_families_agreeing" in sens else pd.DataFrame()

    # ---- 3. walk-forward ancré et glissant ---------------------------------
    wf = {}
    if not quick:
        for mode in list(cfg.get_path("validation.walk_forward.modes")):
            log.info("-- walk-forward %s --", mode)
            wf[mode] = runner.walk_forward(is_start, is_end, mode=mode, grid=wf_grid)

    # ---- 4. k-fold purgé avec embargo --------------------------------------
    kfold = pd.DataFrame()
    if not quick:
        log.info("-- purged k-fold --")
        kfold = runner.purged_kfold(is_start, is_end, grid=wf_grid)

    # ---- 5. Monte Carlo et probabilité de ruine ----------------------------
    log.info("-- Monte Carlo --")
    mc_cfg = cfg.sub("validation.monte_carlo")
    n_sims = int(mc_cfg["n_simulations"]) if not quick else 1000
    mc = run_monte_carlo(
        baseline.trades, baseline.equity, n_simulations=n_sims,
        method=str(mc_cfg["method"]), ruin_threshold=float(mc_cfg["ruin_threshold"]),
        seed=int(mc_cfg["seed"]),
    )
    mc_shuffle = run_monte_carlo(
        baseline.trades, baseline.equity, n_simulations=n_sims, method="shuffle",
        ruin_threshold=float(mc_cfg["ruin_threshold"]), seed=int(mc_cfg["seed"]),
    )

    # ---- 6. sensibilité du risque par trade (§6.1) -------------------------
    log.info("-- étude risk_per_trade / probabilité de ruine --")
    trades_by_risk = {}
    risk_metrics = []
    for risk in list(cfg.get_path("risk.risk_per_trade_grid")):
        cfg_risk = cfg.with_overrides({"risk.risk_per_trade": float(risk)})
        # cache partagé : le sizing ne change ni les features ni les signaux
        runner_risk = ValidationRunner(cfg_risk, md, registry=registry,
                                       shared_cache=runner._cache_by_window)
        outcome = runner_risk.run_once({}, is_start, is_end, label=f"risk_{risk}")
        trades_by_risk[float(risk)] = outcome.trades
        risk_metrics.append(
            {
                "risk_per_trade": float(risk),
                "cagr": outcome.metrics.get("cagr"),
                "sharpe": outcome.metrics.get("sharpe"),
                "max_drawdown": outcome.metrics.get("max_drawdown"),
                "trades": outcome.metrics.get("trades"),
                "liquidations": outcome.metrics.get("liquidations"),
                "final_equity": outcome.metrics.get("final_equity"),
            }
        )
    ruin_table = ruin_probability_by_risk(trades_by_risk, n_simulations=n_sims,
                                          ruin_threshold=float(mc_cfg["ruin_threshold"]))
    ruin_table = ruin_table.merge(pd.DataFrame(risk_metrics), on="risk_per_trade", how="outer")

    # ---- 7. stress des coûts ------------------------------------------------
    log.info("-- stress des coûts --")
    stress = cost_stress(cfg, md, start=is_start, end=is_end,
                         shared_cache=runner._cache_by_window)
    md_is = md.slice(pd.Timestamp(is_start) - pd.Timedelta(days=1), is_end)

    # ---- 8. benchmarks et alpha/beta ---------------------------------------
    log.info("-- benchmarks --")
    benchmarks = build_benchmarks(md_is, cfg)
    benchmarks = {k: v[v.index >= pd.Timestamp(is_start)] for k, v in benchmarks.items() if v is not None and len(v)}
    bench_rows = []
    for name, series in benchmarks.items():
        rep = compute_metrics(series, None, days_per_year=int(cfg.get_path("reports.annualization_days")), name=name)
        bench_rows.append({"benchmark": name, **{k: rep.metrics.get(k) for k in
                                                 ("cagr", "sharpe", "max_drawdown", "total_return",
                                                  "volatility_annual", "calmar")}})
    bench_table = pd.DataFrame(bench_rows)

    btc = benchmarks.get("btc_buy_hold")
    ab = alpha_beta(baseline.equity, btc) if btc is not None else {}

    # ---- 9. décomposition par régime et par symbole -------------------------
    by_regime = regime_breakdown(baseline.trades, int(cfg.get_path("validation.min_trades_per_regime")))
    by_symbol = summarize_by(baseline.trades, "symbol")
    by_exit = summarize_by(baseline.trades, "exit_reason")

    # ---- 10. Deflated Sharpe -------------------------------------------------
    from crypto_algo.reports.metrics import to_returns

    dsr = deflated_sharpe_ratio(
        to_returns(baseline.equity, "D"), n_trials=registry.n_trials,
        trial_sharpes=registry.sharpes(),
        periods_per_year=int(cfg.get_path("reports.annualization_days")),
    )

    baseline_report = compute_metrics(
        baseline.equity, baseline.trades, benchmark_equity=btc, stats=baseline.stats,
        days_per_year=int(cfg.get_path("reports.annualization_days")), name="in_sample",
    )

    result = {
        "baseline": baseline, "baseline_report": baseline_report, "sensitivity": sens,
        "plateau": plateau, "best": best, "heatmaps": {"entry_stop": heat_entry_stop,
                                                       "entry_families": heat_entry_fam},
        "walk_forward": wf, "kfold": kfold, "monte_carlo": mc, "monte_carlo_shuffle": mc_shuffle,
        "ruin_table": ruin_table, "cost_stress": stress, "benchmarks": benchmarks,
        "benchmark_table": bench_table, "alpha_beta": ab, "by_regime": by_regime,
        "by_symbol": by_symbol, "by_exit": by_exit, "dsr": dsr, "registry": registry,
        "market_data": md, "is_bounds": (is_start, is_end),
    }

    for name, table in (("sensitivity", sens), ("kfold", kfold), ("cost_stress", stress),
                        ("benchmarks", bench_table), ("ruin_by_risk", ruin_table),
                        ("by_regime", by_regime), ("by_symbol", by_symbol), ("by_exit", by_exit)):
        save_table(table, cfg, name)
    for mode, data in wf.items():
        save_table(data["windows"], cfg, f"walk_forward_{mode}")
    save_table(baseline.trades, cfg, "trades_in_sample")
    baseline.equity.to_frame("equity").to_csv(out_dir(cfg) / "tables" / "equity_in_sample.csv")
    save_research_cache(cfg, result)
    return result


# ---------------------------------------------------------------------------
def phase_oos(cfg, research: dict) -> dict:
    """Ouverture unique de l'out-of-sample. Aucun paramètre ne bouge après."""
    log.info("=== Phase 6 : ouverture de l'out-of-sample ===")
    md_oos = load_market_data(cfg, split="out_of_sample", include_intrabar=True)
    oos_start, oos_end = split_bounds(cfg, "out_of_sample")

    params = research["best"].params if research.get("best") else {}
    runner = ValidationRunner(cfg, md_oos, registry=None)   # aucun essai enregistré ici
    outcome = runner.run_once(params, oos_start, oos_end, label="oos_final", record=False)

    # Deuxième lecture, décidée **avant** l'ouverture : la configuration par
    # défaut du YAML, conçue a priori. Publier les deux évite de faire passer
    # un choix de grille in-sample pour une prédiction hors échantillon.
    default_outcome = runner.run_once({}, oos_start, oos_end, label="oos_default", record=False)

    md_slice = md_oos.slice(pd.Timestamp(oos_start) - pd.Timedelta(days=1), oos_end)
    benchmarks = build_benchmarks(md_slice, cfg)
    benchmarks = {k: v[v.index >= pd.Timestamp(oos_start)] for k, v in benchmarks.items()
                  if v is not None and len(v)}
    btc = benchmarks.get("btc_buy_hold")

    report = compute_metrics(
        outcome.equity, outcome.trades, benchmark_equity=btc, stats=outcome.stats,
        days_per_year=int(cfg.get_path("reports.annualization_days")), name="out_of_sample",
    )
    ab = alpha_beta(outcome.equity, btc) if btc is not None else {}
    bench_rows = []
    for name, series in benchmarks.items():
        rep = compute_metrics(series, None, days_per_year=int(cfg.get_path("reports.annualization_days")), name=name)
        bench_rows.append({"benchmark": name, **{k: rep.metrics.get(k) for k in
                                                 ("cagr", "sharpe", "max_drawdown", "total_return")}})

    save_table(outcome.trades, cfg, "trades_out_of_sample")
    outcome.equity.to_frame("equity").to_csv(out_dir(cfg) / "tables" / "equity_out_of_sample.csv")
    default_report = compute_metrics(
        default_outcome.equity, default_outcome.trades, benchmark_equity=btc,
        stats=default_outcome.stats,
        days_per_year=int(cfg.get_path("reports.annualization_days")), name="oos_default",
    )
    save_table(default_outcome.trades, cfg, "trades_out_of_sample_default")
    return {
        "outcome": outcome, "report": report, "benchmarks": benchmarks,
        "benchmark_table": pd.DataFrame(bench_rows), "alpha_beta": ab, "params": params,
        "by_regime": regime_breakdown(outcome.trades, int(cfg.get_path("validation.min_trades_per_regime"))),
        "default_report": default_report, "default_outcome": default_outcome,
    }


# ---------------------------------------------------------------------------
def build_report(cfg, quality, research: dict, oos: dict | None, path: Path) -> Path:
    from crypto_algo.reports.metrics import to_returns

    figs = ensure_dir(out_dir(cfg) / "figures")
    m = research["baseline_report"].metrics
    equity = research["baseline"].equity
    sections: list[tuple[str, str]] = []

    # ------------------------------------------------------------- résumé
    target = float(cfg.get_path("risk.profit_lock.trigger"))
    median_m = m.get("monthly_median", float("nan"))
    ci_low, ci_high = m.get("monthly_median_ci_low"), m.get("monthly_median_ci_high")
    verdict_kind = "good" if (np.isfinite(median_m) and median_m > 0) else "bad"
    verdict = f"""
<p><strong>Rendement mensuel médian réellement atteint (in-sample) :
{median_m * 100:.2f} %</strong>, intervalle de confiance 95 % bootstrap
[{(ci_low or float('nan')) * 100:.2f} % ; {(ci_high or float('nan')) * 100:.2f} %].</p>
<p>La cible affichée de +{target * 100:.0f} % mensuel est un objectif à tester, pas une
contrainte de conception. Sur cet échantillon, elle est atteinte
{m.get('months_above_38pct', 0)} mois sur {m.get('months', 0)}. Aucun paramètre
n'a été ajusté pour s'en approcher.</p>
"""
    gross = m.get("gross_pnl", 0.0) or 0.0
    net = m.get("net_pnl", 0.0) or 0.0
    costs = m.get("costs_total", 0.0) or 0.0
    if gross > 0 and net <= 0:
        edge_text = f"""
<p><strong>Le signal a une espérance brute positive ({gross:,.0f} USDT) mais les coûts
({costs:,.0f} USDT) la dépassent : le PnL net est de {net:,.0f} USDT.</strong> Autrement dit,
l'edge existe mais il est plus petit que le prix de son exécution. Les leviers
d'action sont alors la fréquence, la taille et le type d'ordre — pas les seuils
de signal.</p>"""
        edge_kind = "warn"
    elif gross <= 0:
        edge_text = f"""
<p><strong>Le signal a une espérance brute négative ({gross:,.0f} USDT), avant même
les coûts ({costs:,.0f} USDT).</strong> Aucun réglage d'exécution ne peut sauver cela :
sur cet échantillon, les familles de signaux telles qu'assemblées ici n'ont pas
d'edge directionnel.</p>"""
        edge_kind = "bad"
    else:
        edge_text = f"""
<p>PnL brut {gross:,.0f} USDT, coûts {costs:,.0f} USDT, PnL net {net:,.0f} USDT
(soit {m.get('net_over_gross', float('nan')) * 100:.0f} % du brut conservé).</p>"""
        edge_kind = "good"

    kill_html = ""
    if m.get("killed"):
        kill_html = callout(f"""
<p><strong>Le kill switch global (-60 % sur le high-water mark) s'est déclenché le
{m.get('killed_at')}</strong>, soit après {m.get('days_before_kill_switch', float('nan')):.0f} jours
({m.get('active_share_of_period', float('nan')) * 100:.0f} % de la période testée). La stratégie
est ensuite définitivement arrêtée : l'equity du reste de la période est plate.</p>
<p>Conséquence de lecture : le CAGR et le Sharpe affichés ci-dessous décrivent une
equity gelée sur la majorité de l'échantillon. Ils ne sont pas comparables à ceux
d'une stratégie qui aurait tradé tout du long — la seule conclusion recevable est
que <em>la configuration testée détruit le capital avant la fin de la première année</em>.</p>""",
                             "bad")

    sections.append(
        ("Verdict",
         callout(verdict, verdict_kind) + kill_html + callout(edge_text, edge_kind)
         + kpi_grid([
             ("CAGR", m.get("cagr"), "cagr"),
             ("Sharpe", m.get("sharpe"), "sharpe"),
             ("Sortino", m.get("sortino"), "sortino"),
             ("Calmar", m.get("calmar"), "calmar"),
             ("Max drawdown", m.get("max_drawdown"), "max_drawdown"),
             ("Durée max du DD (j)", m.get("max_drawdown_days"), "days"),
             ("Ulcer Index", m.get("ulcer_index"), "ulcer"),
             ("Trades", m.get("trades"), "trades"),
             ("Win rate", m.get("win_rate"), "win_rate"),
             ("Profit factor", m.get("profit_factor"), "pf"),
             ("Espérance (R)", m.get("expectancy_r"), "r"),
             ("Liquidations", m.get("liquidations"), "trades"),
             ("Exposition", m.get("exposure_ratio"), "exposure_ratio"),
             ("Coûts / PnL brut", m.get("costs_over_gross_pnl"), "costs_over_gross_pnl"),
             ("VaR 95 % (jour)", m.get("var_95"), "var_95"),
             ("CVaR 95 % (jour)", m.get("cvar_95"), "cvar_95"),
         ]))
    )

    # ------------------------------------------------------ données et qualité
    quality_table, funding_cal = quality
    failed = quality_table[~quality_table["passed"]] if "passed" in quality_table else pd.DataFrame()
    data_notes = f"""
<p>Source : OKX (ccxt). Binance et Bybit sont inaccessibles depuis
l'environnement d'exécution (HTTP 451 / 403), OKX est donc la seule source —
ce qui correspond à la plateforme utilisée en production.</p>
<p><strong>Limite de données assumée</strong> : l'API publique OKX ne conserve
qu'environ 3 mois d'historique de funding. Les taux antérieurs sont
<em>reconstruits</em> à partir de la prime perp/index, calibrée par régression
sur la période où le funding réel est disponible. Le tableau ci-dessous donne
le R² de cette calibration. Une reconstruction n'est pas une mesure : toute
conclusion sensible au funding doit être lue avec cette réserve.</p>
<p>Le timeframe d'exécution est {cfg.get_path('data.execution_timeframe')}, la
résolution intrabar {cfg.get_path('data.intrabar_timeframe')}. Warmup effectif :
{effective_warmup(cfg)} barres ({effective_warmup(cfg) * 15 / 60 / 24:.0f} jours),
dérivé des lookbacks les plus longs (EMA 200 en 4h, percentiles d'ATR).</p>
"""
    sections.append(
        ("Données et contrôle qualité",
         callout(data_notes, "warn")
         + "<h3>Calibration du funding reconstruit</h3>" + table_html(funding_cal)
         + "<h3>Contrôle qualité par série</h3>" + table_html(quality_table, max_rows=40)
         + (callout(f"<p>{len(failed)} série(s) échouent au contrôle qualité.</p>", "bad")
            if len(failed) else callout("<p>Toutes les séries passent le contrôle qualité.</p>", "good")))
    )

    # --------------------------------------------------------- performance IS
    eq_img = plots.equity_curve(equity, research["benchmarks"], figs / "equity_in_sample.png")
    uw_img = plots.underwater(equity, figs / "underwater_in_sample.png")
    heat_img = plots.monthly_heatmap(equity, figs / "monthly_heatmap.png")
    r_img = plots.r_distribution(research["baseline"].trades, figs / "r_distribution.png")
    metric_rows = pd.DataFrame([{k: v for k, v in m.items() if not isinstance(v, (list, dict))}]).T
    metric_rows.columns = ["valeur"]
    metric_rows.index.name = "métrique"

    sections.append(
        ("Performance in-sample (2020-2023)",
         image(eq_img, "courbe d'equity") + image(uw_img, "underwater")
         + image(heat_img, "rendements mensuels") + image(r_img, "distribution des R")
         + "<h3>Métriques complètes</h3>"
         + table_html(metric_rows.reset_index().rename(columns={"index": "métrique", 0: "valeur"}), max_rows=120))
    )

    # ------------------------------------------------------------ benchmarks
    bench_note = """
<p>Le contrôle négatif <code>random_entries</code> utilise le même moteur, les
mêmes coûts et le même dimensionnement que la stratégie : il doit perdre de
l'argent. S'il gagne, le moteur est faux et tout le reste est nul et non avenu.</p>
"""
    inversion_html = ""
    inversion_path = out_dir(cfg) / "tables" / "inversion_check.csv"
    if inversion_path.exists():
        inv = pd.read_csv(inversion_path)
        inversion_html = (
            "<h3>Contrôle d'inversion</h3>"
            + table_html(inv)
            + callout("""
<p>La même stratégie est rejouée avec l'opinion de <strong>toutes</strong> les familles
retournée, régimes, routage, risque et coûts inchangés. Si la version inversée
gagnait nettement, la perte viendrait d'une erreur de signe et non d'une absence
d'edge. Si les deux perdent, les signaux n'ont pas de contenu directionnel
exploitable sur cet échantillon.</p>""", "warn")
        )

    sections.append(
        ("Benchmarks et contrôle négatif",
         callout(bench_note) + table_html(research["benchmark_table"]) + inversion_html
         + "<h3>Régression alpha / beta contre BTC</h3>"
         + table_html(pd.DataFrame([research["alpha_beta"]]))
         + callout(
             "<p>Un beta élevé avec un alpha non significatif signifie que la performance "
             "est du BTC amplifié par le levier, pas une compétence de sélection.</p>", "warn"))
    )

    # ------------------------------------------------------------ validation
    plateau = research["plateau"]
    if "has_positive_region" not in plateau:      # cache produit par une version antérieure
        plateau = plateau_score(research["sensitivity"])
    heat1 = plots.parameter_heatmap(research["heatmaps"]["entry_stop"],
                                    "Sharpe : seuil d'entrée x multiple d'ATR", figs / "heatmap_entry_stop.png")
    heat2 = plots.parameter_heatmap(research["heatmaps"]["entry_families"],
                                    "Sharpe : seuil d'entrée x familles requises", figs / "heatmap_entry_families.png")
    if not plateau.get("has_positive_region", False):
        plateau_kind = "bad"
        plateau_text = f"""
<p><strong>Aucune combinaison de la grille n'obtient un Sharpe positif</strong>
({plateau.get('n_points', 0)} combinaisons testées, meilleur point
{plateau.get('best', float('nan')):.2f}, médiane {plateau.get('median_all', float('nan')):.2f}).
La question « plateau ou pic ? » ne se pose donc pas : il n'y a pas de zone de
performance à qualifier. C'est un résultat plus net qu'un surajustement — la
sensibilité aux paramètres n'est pas le problème.</p>
"""
    else:
        plateau_kind = "good" if plateau.get("plateau_ratio", 0) > 0.6 else "bad"
        plateau_text = f"""
<p>Ratio de plateau : <strong>{plateau.get('plateau_ratio', float('nan')):.2f}</strong>
(médiane des voisins du sommet / meilleur point, sur {plateau.get('n_points', 0)} combinaisons).
Proche de 1 = plateau robuste ; proche de 0 = pic isolé, donc surajustement.</p>
"""
    wf_html = ""
    for mode, data in research["walk_forward"].items():
        img = plots.walk_forward_plot(data["windows"], figs / f"walk_forward_{mode}.png")
        wf_html += f"<h3>Walk-forward {mode}</h3>" + image(img, mode) + table_html(data["windows"], max_rows=40)
        wf_html += callout(
            f"<p>Dégradation moyenne du Sharpe entre optimisation et test : "
            f"<strong>{data['degradation']:+.3f}</strong>.</p>",
            "bad" if data["degradation"] < -0.5 else "warn")

    mc = research["monte_carlo"]
    mc_img = plots.monte_carlo_distribution(mc, figs / "monte_carlo.png")
    dsr = research["dsr"]
    dsr_text = f"""
<p>Configurations testées et comptées automatiquement : <strong>{dsr.get('n_trials')}</strong>.
Sharpe observé : {dsr.get('sharpe', float('nan')):.3f}. Sharpe attendu du meilleur
de {dsr.get('n_trials')} essais purement bruités : {dsr.get('expected_max_sharpe_annual', float('nan')):.3f}.
<strong>Deflated Sharpe Ratio : {dsr.get('dsr', float('nan')):.3f}</strong>
(probabilité que le Sharpe soit réel compte tenu du nombre d'essais).</p>
"""
    sections.append(
        ("Validation : robustesse, walk-forward, Monte Carlo",
         "<h3>Sensibilité des paramètres</h3>" + callout(plateau_text, plateau_kind)
         + image(heat1, "heatmap") + image(heat2, "heatmap")
         + table_html(research["sensitivity"], max_rows=60)
         + wf_html
         + "<h3>K-fold purgé avec embargo</h3>" + table_html(research["kfold"])
         + "<h3>Monte Carlo</h3>" + image(mc_img, "monte carlo")
         + table_html(pd.concat([mc.to_frame(), research["monte_carlo_shuffle"].to_frame()]))
         + "<h3>Deflated Sharpe Ratio et tests multiples</h3>"
         + callout(dsr_text, "bad" if dsr.get("dsr", 0) < 0.95 else "good")
         + table_html(pd.DataFrame([dsr])))
    )

    # --------------------------------------------------- risque et coûts
    risk_img = plots.risk_sensitivity_plot(research["ruin_table"], figs / "risk_sensitivity.png")
    stress = research["cost_stress"]
    stress_kind = "bad"
    if len(stress) > 1 and "sharpe_retention" in stress:
        last = stress["sharpe_retention"].iloc[-1]
        stress_kind = "good" if np.isfinite(last) and last > 0.5 else "bad"
    sections.append(
        ("Risque : sizing, ruine, stress des coûts",
         "<h3>Sizing risk-based et probabilité de ruine (§6.1)</h3>"
         + image(risk_img, "sensibilité du risque") + table_html(research["ruin_table"])
         + callout("""
<p>Le dimensionnement est <strong>risk-based</strong> : la taille découle du risque
au stop, pas de la marge. Le plafond de 20 % de marge reste un plafond secondaire.
Le levier effectif est en outre réduit pour que le prix de liquidation reste
au-delà du stop — sans quoi, avec un stop à 8 % et un levier 10, la mèche qui
touche le stop liquide la position.</p>""", "warn")
         + "<h3>Stress des coûts (x1, x1,5, x2)</h3>" + table_html(stress)
         + callout("<p>Si l'edge disparaît quand les coûts doublent, il n'existait pas.</p>", stress_kind))
    )

    # ------------------------------------------------- décomposition trades
    regime_note = f"""
<p>Seuil statistique : aucune conclusion sur moins de
{cfg.get_path('validation.min_trades_per_regime')} trades par régime. Les lignes
marquées « échantillon insuffisant » ne permettent aucune affirmation.</p>
"""
    sections.append(
        ("Décomposition des trades",
         callout(regime_note, "warn")
         + "<h3>Par régime</h3>" + table_html(research["by_regime"])
         + "<h3>Par symbole</h3>" + table_html(research["by_symbol"])
         + "<h3>Par motif de sortie</h3>" + table_html(research["by_exit"]))
    )

    # ---------------------------------------------------------------- OOS
    if oos is not None:
        om = oos["report"].metrics
        oos_eq = plots.equity_curve(oos["outcome"].equity, oos["benchmarks"], figs / "equity_oos.png",
                                    title="Out-of-sample : equity (échelle log)")
        oos_uw = plots.underwater(oos["outcome"].equity, figs / "underwater_oos.png")
        is_sharpe = m.get("sharpe", float("nan"))
        oos_sharpe = om.get("sharpe", float("nan"))
        degradation = oos_sharpe - is_sharpe
        deg_text = f"""
<p>Sharpe in-sample : <strong>{is_sharpe:.3f}</strong> — Sharpe out-of-sample :
<strong>{oos_sharpe:.3f}</strong> — dégradation : <strong>{degradation:+.3f}</strong>.</p>
<p>Paramètres utilisés (figés avant ouverture) : <code>{oos['params']}</code>.
Aucune modification n'a été faite après consultation de l'out-of-sample.</p>
"""
        oos_kill = ""
        if om.get("killed"):
            oos_kill = callout(
                f"<p>Le kill switch s'est également déclenché hors échantillon, le "
                f"{om.get('killed_at')} (après {om.get('days_before_kill_switch', float('nan')):.0f} jours).</p>",
                "bad")

        sections.append(
            ("Out-of-sample (2024-2026) — ouvert une seule fois",
             callout(deg_text, "good" if degradation > -0.3 else "bad") + oos_kill
             + image(oos_eq, "equity OOS") + image(oos_uw, "underwater OOS")
             + kpi_grid([
                 ("CAGR OOS", om.get("cagr"), "cagr"),
                 ("Sharpe OOS", om.get("sharpe"), "sharpe"),
                 ("Max DD OOS", om.get("max_drawdown"), "max_drawdown"),
                 ("Trades OOS", om.get("trades"), "trades"),
                 ("Médiane mensuelle", om.get("monthly_median"), "monthly_median"),
                 ("Mois battant BTC", om.get("months_beating_benchmark"), "months_beating_benchmark"),
                 ("Liquidations", om.get("liquidations"), "trades"),
                 ("Coûts / PnL brut", om.get("costs_over_gross_pnl"), "costs_over_gross_pnl"),
             ])
             + "<h3>Deux lectures figées avant ouverture</h3>"
             + table_html(pd.DataFrame([
                 {"configuration": f"meilleure grille in-sample {oos['params']}",
                  **{k: om.get(k) for k in ("cagr", "sharpe", "max_drawdown", "total_return", "trades")}},
                 {"configuration": "paramètres par défaut du YAML (conçus a priori)",
                  **{k: oos["default_report"].metrics.get(k) for k in
                     ("cagr", "sharpe", "max_drawdown", "total_return", "trades")}},
             ]))
             + "<h3>Benchmarks sur la même période</h3>" + table_html(oos["benchmark_table"])
             + "<h3>Alpha / beta OOS</h3>" + table_html(pd.DataFrame([oos["alpha_beta"]]))
             + "<h3>Par régime</h3>" + table_html(oos["by_regime"]))
        )
    else:
        sections.append(
            ("Out-of-sample",
             callout("""
<p>L'out-of-sample n'a pas été ouvert. Le verrou <code>splits.oos_unlocked</code>
est actif : toute tentative de chargement de la période 2024-2026 lève une
exception. Il ne doit être levé qu'une seule fois, en fin d'audit, et aucun
paramètre ne doit être modifié ensuite.</p>""", "warn"))
        )

    # ----------------------------------------------------------- limites
    limits = """
<ul>
<li><strong>Funding reconstruit</strong> hors des ~3 derniers mois (limite de rétention de
l'API OKX). Calibration publiée plus haut ; les trades longs en x10 sont les plus
sensibles à cette approximation.</li>
<li><strong>Résolution intrabar en 5m</strong> et non en 1m : quand SL et TP sont touchés
dans la même bougie 15m, la séquence est reconstituée en 5m ; à défaut, hypothèse
pessimiste (SL d'abord). La part des barres résolues par hypothèse est publiée dans
les métriques (<code>intrabar_assumed</code>).</li>
<li><strong>CVD non disponible</strong> sur l'historique : les trades tick pluriannuels ne
sont pas exposés par l'API publique. La famille volume s'appuie sur OBV, volume relatif,
VWAP ancré et volume profile.</li>
<li><strong>Dominance BTC</strong> approximée par une performance relative (les
capitalisations ne sont pas disponibles via l'API exchange).</li>
<li><strong>Pair trading</strong> exprimé sur la jambe seule : le modèle de position ne
gère pas encore la couverture beta simultanée sans consommer les deux emplacements.</li>
<li><strong>SOL</strong> n'existe sur OKX qu'à partir de 2021-01 : la période 2020 ne
contient que BTC et ETH.</li>
<li><strong>Le paper trading (phase 7) n'a pas encore tourné</strong> : aucune conclusion
live n'est disponible. 60 jours minimum sont requis avant tout capital réel.</li>
</ul>
"""
    sections.append(("Limites et réserves", callout(limits, "warn")))

    subtitle = (
        f"Univers {', '.join(cfg.get_path('universe.symbols'))} — perpétuels OKX — "
        f"levier max {cfg.get_path('risk.leverage_max'):g} — "
        f"généré le {pd.Timestamp.now('UTC').strftime('%Y-%m-%d %H:%M UTC')}"
    )
    return render_report("Audit de stratégie — perpétuels crypto en levier x10", subtitle, sections, path)


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", nargs="*", default=None)
    ap.add_argument("--phase", choices=["quality", "research", "oos", "all"], default="research")
    ap.add_argument("--quick", action="store_true", help="grilles réduites (mise au point)")
    ap.add_argument("--unlock-oos", default=None,
                    help="motif d'ouverture de l'out-of-sample (obligatoire pour --phase oos)")
    ap.add_argument("--reuse-research", action="store_true",
                    help="repartir du cache in-sample au lieu de tout réexécuter")
    args = ap.parse_args()

    setup_logging("INFO", logfile="logs/research.log")
    cfg = load_config(args.config)
    if args.unlock_oos:
        cfg = cfg.with_overrides({"splits.oos_unlocked": True, "splits.oos_unlock_reason": args.unlock_oos})

    quality = phase_quality(cfg)
    if args.phase == "quality":
        return 0

    research = load_research_cache(cfg) if args.reuse_research else None
    if research is None:
        research = phase_research(cfg, quick=args.quick)

    oos = None
    if args.phase in ("oos", "all"):
        if not args.unlock_oos:
            log.error("--phase oos exige --unlock-oos \"motif\" : l'OOS ne s'ouvre qu'une fois.")
            return 2
        oos = phase_oos(cfg, research)

    path = out_dir(cfg) / "rapport_audit.html"
    build_report(cfg, quality, research, oos, path)

    summary = {
        "in_sample": {k: research["baseline_report"].metrics.get(k)
                      for k in ("cagr", "sharpe", "sortino", "calmar", "max_drawdown",
                                "monthly_median", "trades", "win_rate", "profit_factor",
                                "liquidations", "costs_over_gross_pnl", "killed",
                                "killed_at", "days_before_kill_switch", "gross_pnl",
                                "net_pnl", "costs_total")},
        "trials": research["registry"].n_trials,
        "deflated_sharpe": research["dsr"].get("dsr"),
        "ruin_probability": research["monte_carlo"].ruin_probability,
        "plateau_ratio": research["plateau"].get("plateau_ratio"),
    }
    if oos is not None:
        summary["out_of_sample"] = {k: oos["report"].metrics.get(k)
                                    for k in ("cagr", "sharpe", "max_drawdown", "monthly_median", "trades")}
    with open(out_dir(cfg) / "summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, default=str)
    log.info("Résumé :\n%s", json.dumps(summary, indent=2, default=str))
    log.info("Rapport : %s", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
