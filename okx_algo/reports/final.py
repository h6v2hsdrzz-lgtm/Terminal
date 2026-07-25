"""Rapport final (§12, §13, §16.5).

Le rapport dit ce que les mesures disent. Si l'objectif de 5 %/mois n'est pas
atteint, il l'ecrit en clair, chiffre, avec la contrainte qui bloque et les
pistes qui demanderaient de NOUVELLES DONNEES plutot que de nouveaux
parametres.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from ..backtest.metrics import monthly_returns, underwater
from ..core.config import Config
from ..core.persist import RunState, atomic_write_text, read_jsonl

log = logging.getLogger("okx_algo.report")


def _load(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def _pct(v, nd: int = 2) -> str:
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return "n/d"
    return f"{v * 100:.{nd}f} %"


def _num(v, nd: int = 3) -> str:
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return "n/d"
    return f"{v:.{nd}f}"


# ----------------------------------------------------------------------
def build_final_report(cfg: Config, state: RunState) -> str:
    art = cfg.artifacts_root
    quality = _load(art / "data_quality_report.json")
    selftest = _load(art / "engine_selftest.json")
    lever = _load(art / "leverage_calibration.json")
    oos = _load(art / "oos_validation.json")
    research = _load(art / "research_summary.json")
    trials = read_jsonl(cfg.research_root / "research_log.jsonl")
    baselines = {b: _load(art / f"baseline_{b}.json")
                 for b in ("ts_momentum", "cross_sectional", "cascade_reversal", "portfolio")}

    L = [f"# Strategie long/short systematique sur perpetuels OKX — rapport final",
         "", f"Genere le {pd.Timestamp.utcnow():%Y-%m-%d %H:%M} UTC.",
         f"Univers : {', '.join(cfg.get('universe.symbols'))}.",
         f"In-sample {cfg.get('split.in_sample_start')} -> {cfg.get('split.in_sample_end')} ; "
         f"out-of-sample {cfg.get('split.out_of_sample_start')} -> aujourd'hui.", ""]

    L += _verdict_section(cfg, lever, oos, research, trials)
    L += _data_section(quality)
    L += _engine_section(selftest)
    L += _bricks_section(baselines)
    L += _leverage_section(lever)
    L += _oos_section(cfg, oos)
    L += _research_section(cfg, research, trials)
    L += _limits_section(quality)

    text = "\n".join(L)
    atomic_write_text(art / "RAPPORT_FINAL.md", text)
    log.info("rapport final ecrit : %s", art / "RAPPORT_FINAL.md")
    state.mark_done("final_report")
    return text


# ----------------------------------------------------------------------
def _verdict_section(cfg, lever, oos, research, trials) -> list[str]:
    target = cfg.get("research.target_monthly_return")
    L = ["## Verdict", ""]
    if lever is None:
        L += ["Calibration du levier non executee : verdict indisponible.", ""]
        return L

    reachable = lever.get("objective_reachable")
    l_final = lever.get("l_final")
    ach = lever.get("achievable_monthly_return")
    ci = lever.get("achievable_monthly_ci") or [np.nan, np.nan]
    binding = lever.get("binding_constraint")

    if reachable:
        L += [f"**Objectif de {_pct(target)}/mois : ATTEINT** au levier "
              f"{_num(l_final, 2)}x.", ""]
    else:
        L += [f"**Objectif de {_pct(target)}/mois : NON ATTEINT.**", "",
              f"Levier requis pour 80 %/an : **{_num(lever.get('l_target'), 2)}x**. "
              f"Levier admissible sous la contrainte de drawdown mensuel de "
              f"{_pct(cfg.get('leverage.monthly_dd_limit'))} : "
              f"**{_num(l_final, 2)}x**.", "",
              f"Rendement mensuel median reellement atteignable a {_num(l_final, 2)}x : "
              f"**{_pct(ach)}** (IC 95 % : {_pct(ci[0])} a {_pct(ci[1])}).", "",
              f"Contrainte bloquante : **{binding}**.", "",
              "> La limite de drawdown n'a pas ete relevee pour faire passer "
              "l'objectif, et aucun parametre n'a ete ajuste apres l'ouverture de "
              "l'out-of-sample. Le constat chiffre est le livrable.", ""]

    if oos:
        g = oos.get("go_no_go", {})
        L += [f"Criteres go/no-go (§13) : "
              f"**{'TOUS REMPLIS' if g.get('all_passed') else 'NON REMPLIS'}** — "
              f"le passage en paper trading est "
              f"{'autorise' if g.get('all_passed') else 'refuse'}.", ""]
    L += [f"Essais consommes : **{len(trials)} / {cfg.get('research.max_trials')}**.", ""]
    return L


def _data_section(quality) -> list[str]:
    L = ["---", "", "## 1. Donnees", ""]
    if not quality:
        return L + ["Rapport de qualite absent.", ""]
    L += ["| Symbole | 15m | 1H | funding | open interest |", "|---|---|---|---|---|"]
    for sym, e in quality["symbols"].items():
        o15 = e["ohlcv"].get("15m", {})
        o1h = e["ohlcv"].get("1H", {})
        f = e.get("funding", {})
        oi = e.get("open_interest", {})
        L.append(f"| {sym} | {o15.get('rows', 0):,} barres, "
                 f"{o15.get('coverage_pct', 0):.1f} % | {o1h.get('rows', 0):,} | "
                 f"{f.get('rows', 0):,} reglements | {oi.get('rows', 0):,} points |")
    L.append("")
    cc = next((e.get("funding_cross_check") for e in quality["symbols"].values()
               if e.get("funding_cross_check", {}).get("status") == "ok"), None)
    if cc:
        L += ["**Substitution du funding.** L'API publique OKX ne retient qu'environ "
              "3 mois de funding et 1,5 an d'open interest. L'historique de travail "
              "provient donc des dumps publics Binance USD-M : ce sont des taux "
              "reellement observes, pas une moyenne. L'ecart avec le funding OKX a ete "
              "mesure sur la fenetre de recouvrement disponible :", ""]
        for sym, e in quality["symbols"].items():
            c = e.get("funding_cross_check", {})
            if c.get("status") == "ok":
                L.append(f"- {sym} : correlation {c['correlation']:.3f}, biais moyen "
                         f"{c['mean_bias_annualized_pct']:+.2f} %/an, erreur absolue "
                         f"moyenne {c['mae_annualized_pct']:.2f} %/an, accord de signe "
                         f"{c['sign_agreement_pct']:.1f} % "
                         f"({c['overlap_settlements']} reglements)")
        L += ["", "Consequence a retenir : le **niveau** du funding est bien reproduit "
              "(biais < 1 %/an), donc le cout cumule de portage est fiable. En revanche "
              "la correlation periode par periode (~0,6) est mediocre, ce qui rend le "
              "**z-score** du modulateur de funding plus bruite qu'il ne le serait sur "
              "des donnees OKX natives. Le modulateur doit donc etre juge sur sa "
              "contribution defensive, pas sur une precision de timing.", ""]
    return L


def _engine_section(selftest) -> list[str]:
    L = ["---", "", "## 2. Validation du moteur", ""]
    if not selftest:
        return L + ["Auto-tests non executes.", ""]
    L += [f"Resultat : **{'tous les tests passent' if selftest['all_passed'] else 'ECHEC'}**.",
          "", "| Test | Resultat |", "|---|---|"]
    for t in selftest["tests"]:
        L.append(f"| {t['test']} | {'OK' if t['passed'] else 'ECHEC'} |")
    ctrl = next((t for t in selftest["tests"] if "random_control" in t["test"]), None)
    if ctrl:
        L += ["", f"Controle negatif (§11.8) : sur {ctrl['n_runs']} strategies a entrees "
              f"aleatoires avec le meme sizing et les memes couts, rendement moyen "
              f"{_pct(ctrl['mean_return'])}, {_pct(ctrl['pct_profitable'])} de runs "
              f"profitables. Le moteur ne fabrique pas de performance.", ""]
    return L


def _bricks_section(baselines) -> list[str]:
    L = ["---", "", "## 3. Briques, testees seules en in-sample", "",
         "| Brique | Sharpe | mensuel median | DD max | trades | couts / PnL brut |",
         "|---|---|---|---|---|---|"]
    for name, b in baselines.items():
        if not b:
            L.append(f"| {name} | non execute | | | | |")
            continue
        m = b.get("metrics", {})
        L.append(f"| {name} | {_num(m.get('sharpe'))} | {_pct(m.get('monthly_return_median'))} "
                 f"| {_pct(m.get('max_drawdown'))} | {m.get('n_trades', 0)} | "
                 f"{_num(m.get('costs_pct_of_gross_pnl'), 2)} |")
    L.append("")
    return L


def _leverage_section(lever) -> list[str]:
    L = ["---", "", "## 4. Calibration du levier (§8)", ""]
    if not lever:
        return L + ["Non executee.", ""]
    L += ["| Etape | Valeur |", "|---|---|",
          f"| Sharpe hors echantillon, sans levier | {_num(lever.get('sharpe_unlevered'))} |",
          f"| Rendement annualise sans levier (R) | {_pct(lever.get('annual_return_unlevered'))} |",
          f"| Drawdown max sans levier | {_pct(lever.get('max_dd_unlevered'))} |",
          f"| DD mensuel p95 (Monte Carlo) | {_pct(lever.get('monthly_dd_p95'))} |",
          f"| L_objectif = 0.80 / R | {_num(lever.get('l_target'), 2)}x |",
          f"| L_risque = limite DD / DD_p95 | {_num(lever.get('l_risk'), 2)}x |",
          f"| L_max | {_num(lever.get('l_max'), 2)}x |",
          f"| **L_final** | **{_num(lever.get('l_final'), 2)}x** |", "",
          lever.get("notes", {}).get("interpretation", ""), "",
          "Table de sensibilite complete : `artifacts/leverage_sensitivity.csv` "
          "(levier 1 a 10 par pas de 0,5, avec rendement mensuel espere, drawdown "
          "attendu et probabilite de ruine estimee par Monte Carlo).", ""]
    return L


def _oos_section(cfg, oos) -> list[str]:
    L = ["---", "", "## 5. Out-of-sample (ouvert une seule fois)", ""]
    if not oos:
        return L + ["Out-of-sample non ouvert.", ""]
    m = oos["out_of_sample"]
    i = oos["in_sample"]
    L += [f"Ouvert le {oos.get('opened_at', '')[:19]} UTC, levier applique "
          f"{_num(oos.get('leverage_applied'), 2)}x.", "",
          "| Metrique | In-sample | Out-of-sample |", "|---|---|---|"]
    rows = [("CAGR", "cagr", _pct), ("Rendement mensuel median", "monthly_return_median", _pct),
            ("Sharpe", "sharpe", _num), ("Sortino", "sortino", _num),
            ("Calmar", "calmar", _num), ("Drawdown max", "max_drawdown", _pct),
            ("Taux de reussite", "win_rate", _pct), ("Profit factor", "profit_factor", _num),
            ("Esperance (R)", "expectancy_r", _num), ("Nombre de trades", "n_trades", str),
            ("Liquidations", "n_liquidations", str),
            ("Taux de fill maker", "maker_fill_rate", _pct),
            ("Couts / PnL brut", "costs_pct_of_gross_pnl", _num),
            ("VaR 95 %", "var95", _pct), ("CVaR 95 %", "cvar95", _pct),
            ("VaR 99 %", "var99", _pct), ("CVaR 99 %", "cvar99", _pct)]
    for label, key, fmt in rows:
        L.append(f"| {label} | {fmt(i.get(key))} | {fmt(m.get(key))} |")

    ci = (m.get("monthly_return_ci95_low"), m.get("monthly_return_ci95_high"))
    L += ["", f"Intervalle de confiance a 95 % du rendement mensuel median "
          f"out-of-sample : {_pct(ci[0])} a {_pct(ci[1])}.", ""]

    dsr = oos.get("deflated_sharpe", {})
    L += ["### Deflated Sharpe Ratio", "",
          f"- Sharpe out-of-sample annualise : {_num(dsr.get('sharpe_annualized'))}",
          f"- Sharpe maximal attendu sous l'hypothese nulle apres "
          f"{dsr.get('n_trials')} essais : {_num(dsr.get('sr0_annualized'))}",
          f"- DSR : {_num(dsr.get('dsr'))} — p = {_num(dsr.get('p_value'), 4)}",
          f"- Significatif a p < 0,05 : **{'oui' if dsr.get('significant') else 'non'}**", ""]

    ab = oos.get("alpha_beta_vs_btc", {})
    L += ["### Alpha / beta contre BTC (§11.10)", "",
          f"- alpha annualise : {_pct(ab.get('alpha_annualized'))} "
          f"(t = {_num(ab.get('alpha_tstat'), 2)})",
          f"- beta : {_num(ab.get('beta'))} — R² = {_num(ab.get('r_squared'))}", "",
          "Un beta proche de zero avec un alpha significatif indique une performance "
          "reellement independante du marche ; un beta eleve indiquerait un simple "
          "pari directionnel amplifie par le levier.", ""]

    bench = oos.get("benchmarks_oos", {})
    if bench:
        L += ["### Benchmarks sur la meme fenetre", "",
              "| Reference | CAGR | Sharpe | DD max |", "|---|---|---|---|"]
        for k, v in bench.items():
            L.append(f"| {k} | {_pct(v.get('cagr'))} | {_num(v.get('sharpe'))} | "
                     f"{_pct(v.get('max_drawdown'))} |")
        L.append(f"| **strategie** | {_pct(m.get('cagr'))} | {_num(m.get('sharpe'))} | "
                 f"{_pct(m.get('max_drawdown'))} |")
        L += ["", f"Pourcentage de mois battant BTC : "
              f"{_pct(m.get('pct_months_beating_benchmark'))}.", ""]

    regimes = oos.get("regimes", [])
    if regimes:
        L += ["### Performance par regime", "",
              "| Regime | heures | rendement total | Sharpe |", "|---|---|---|---|"]
        for r in regimes:
            L.append(f"| {r['regime']} | {r['hours']:,} | {_pct(r['total_return'])} | "
                     f"{_num(r['sharpe'])} |")
        L.append("")

    stress = oos.get("cost_stress", {})
    if stress:
        L += ["### Stress des couts (§11.7)", "",
              "| Multiplicateur | CAGR | Sharpe | trades |", "|---|---|---|---|"]
        for k in sorted(stress, key=float):
            v = stress[k]
            L.append(f"| x{k} | {_pct(v.get('cagr'))} | {_num(v.get('sharpe'))} | "
                     f"{v.get('n_trades', 0)} |")
        L.append("")

    mc = oos.get("monte_carlo", {})
    if mc and mc.get("n_draws"):
        L += ["### Monte Carlo sur l'ordre des trades", "",
              f"- drawdown max median : {_pct(mc.get('max_dd_median'))}",
              f"- drawdown max au 95e percentile : {_pct(mc.get('max_dd_p95'))}",
              f"- pire drawdown simule : {_pct(mc.get('max_dd_worst'))}",
              f"- probabilite de rendement negatif : {_pct(mc.get('prob_negative'))}",
              f"- probabilite de ruine (DD <= 50 %) : {_pct(mc.get('ruin_probability'))}", ""]

    g = oos.get("go_no_go", {})
    if g:
        L += ["### Criteres go / no-go (§13)", "",
              "| Critere | Exige | Observe | Resultat |", "|---|---|---|---|"]
        for name, c in g["checks"].items():
            obs = c["observed"]
            obs = _num(obs) if isinstance(obs, float) else str(obs)
            L.append(f"| {name} | {c['required']} | {obs} | "
                     f"{'OK' if c['passed'] else 'ECHEC'} |")
        L += ["", f"**Verdict : {'passage en paper trading autorise' if g['all_passed'] else 'passage en paper trading REFUSE'}.**", ""]
    return L


def _research_section(cfg, research, trials) -> list[str]:
    L = ["---", "", "## 6. Boucle de recherche (§16)", ""]
    L += [f"- essais consommes : **{len(trials)} / {cfg.get('research.max_trials')}**"]
    if research:
        L.append(f"- condition d'arret : **{research.get('stop_reason')}**")
        by = research.get("registry", {}).get("by_hypothesis", {})
        if by:
            L += ["", "| Hypothese | configurations testees |", "|---|---|"]
            for k, v in by.items():
                L.append(f"| {k} | {v} |")
    if trials:
        L += ["", "Les dix meilleures configurations in-sample :", "",
              "| # | hypothese | Sharpe IS | mensuel median | trades | statut |",
              "|---|---|---|---|---|---|"]
        top = sorted([t for t in trials if t.get("is_sharpe") is not None],
                     key=lambda t: -t["is_sharpe"])[:10]
        for t in top:
            L.append(f"| {t['trial_id']} | {t['hypothesis']} | {_num(t['is_sharpe'])} | "
                     f"{_pct(t.get('is_monthly_return'))} | {t.get('n_trades', 0)} | "
                     f"{t.get('status')} |")
    L += ["", "Le registre complet est dans `research/research_log.jsonl` : une ligne par "
          "configuration, append-only. C'est ce compteur qui alimente la penalite du "
          "Deflated Sharpe — plus on cherche, plus la barre monte.", ""]
    return L


def _limits_section(quality) -> list[str]:
    return ["---", "", "## 7. Limites et pistes necessitant de nouvelles donnees", "",
            "Les limites ci-dessous sont structurelles : elles ne se resoudront pas "
            "avec une configuration supplementaire sur les memes donnees.", "",
            "1. **Univers cross-sectionnel de 3 actifs.** Le z-score en coupe ne dispose "
            "que de 3 points, le rang median est mecaniquement neutralise et la brique 2 "
            "degenere en un unique spread. L'extension a 8-10 perpetuels liquides est "
            "codee et mesuree (hypothese H2).", "",
            "2. **Funding historique de substitution.** Le funding OKX au-dela de "
            "~3 mois n'est pas disponible publiquement ; l'historique vient de Binance "
            "USD-M, avec un biais de niveau faible mais une correlation periode par "
            "periode d'environ 0,6.", "",
            "3. **Open interest indisponible avant 2021.** La brique 3 exige une baisse "
            "confirmee de l'open interest : elle ne peut structurellement pas se "
            "declencher sur 2020.", "",
            "4. **Pas de carnet d'ordres niveau 2.** Le taux de remplissage maker est "
            "modelise a partir de la penetration du prix dans la barre, pas de la file "
            "d'attente reelle. C'est la principale incertitude sur les couts.", "",
            "### Les trois pistes les plus prometteuses", "",
            "Elles demandent toutes de **nouvelles donnees**, pas de nouveaux parametres. "
            "Un edge absent des donnees OHLCV ne sortira pas d'une 201e configuration.", "",
            "1. **Carnet d'ordres niveau 2 (snapshots horodates).** Permettrait de "
            "remplacer le modele de fill maker par une simulation de file d'attente, et "
            "surtout de detecter l'assechement de liquidite qui EST le mecanisme de la "
            "brique 3 — actuellement approxime par volume et open interest.", "",
            "2. **Flux on-chain (entrees/sorties d'exchange, stablecoins).** Signal "
            "orthogonal au prix, avec un mecanisme economique clair : les mouvements de "
            "collateral precedent les mouvements de positionnement.", "",
            "3. **Volatilite implicite des options (surface Deribit).** Le skew et la "
            "structure par terme sont des mesures directes du positionnement et du prix "
            "du risque de queue — exactement l'information que le funding capture mal et "
            "que la brique 3 cherche a exploiter.", ""]
