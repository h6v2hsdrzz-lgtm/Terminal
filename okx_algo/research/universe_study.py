"""H2 — l'extension de l'univers cross-sectionnel ameliore-t-elle le Sharpe ?

Cette hypothese ne peut pas vivre dans la boucle principale : elle change
l'univers, donc le panel. Elle fait l'objet d'une etude dediee, dont les essais
sont comptes dans le MEME registre — l'extension d'univers est une
configuration testee comme une autre.

La brique 2 est evaluee SEULE, sur exactement la meme fenetre, dans les deux
univers. On compare son Sharpe, mais aussi sa correlation a la brique 1 : la
brique 2 existe pour sa decorrelation, pas pour son Sharpe propre. Une
extension qui ameliorerait le Sharpe en augmentant la correlation ne servirait
a rien.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from ..core.config import Config
from ..core.persist import RunState, atomic_write_json
from ..data.download import Downloader
from ..data.panel import build_panel
from ..portfolio.combine import brick_pnl_proxy
from ..strategies.cross_sectional import CrossSectionalMomentum
from ..strategies.ts_momentum import TSMomentum
from .pipeline import brick_params, evaluate, run_engine, window
from .registry import ResearchRegistry

log = logging.getLogger("okx_algo.h2")


def ensure_extended_data(cfg: Config, state: RunState) -> list[str]:
    """Telecharge le necessaire pour l'univers etendu.

    La brique 2 se rebalance quotidiennement et n'a besoin ni du 1 m ni de
    l'open interest : une grille horaire et le funding suffisent. C'est ce qui
    rend l'etude realisable en quelques minutes plutot qu'en heures.
    """
    symbols = cfg.get("universe.extended_symbols")
    dl = Downloader(cfg, state)
    dl.instruments()
    extra = [s for s in symbols if s not in cfg.get("universe.symbols")]
    dl.ohlcv(extra, ["1H"])
    dl.funding(extra)
    available = []
    for s in symbols:
        if dl.store.exists("ohlcv", s, "1H"):
            available.append(s)
        else:
            log.warning("%s indisponible, exclu de l'univers etendu", s)
    return available


def run_universe_study(cfg: Config, state: RunState) -> dict:
    reg = ResearchRegistry(cfg.research_root / "research_log.jsonl",
                           cfg.get("research.max_trials"))
    extended = ensure_extended_data(cfg, state)
    base = cfg.get("universe.symbols")
    log.info("univers etendu : %d actifs disponibles", len(extended))

    rows = []
    for universe, symbols in [("base", base), ("extended", extended)]:
        panel = build_panel(cfg, symbols=symbols, timeframe="1H", with_minute=False)
        for lookback in [72, 168, 336]:
            params = {"universe": universe, "n_symbols": len(symbols),
                      "lookback_hours": lookback}
            prior = reg.already_run("H2", params)
            c = cfg.copy()
            c.set("strategies.cross_sectional.lookback_hours", lookback)
            try:
                out = evaluate(c, panel, ["cross_sectional"], which="is",
                               label=f"H2_{universe}_{lookback}")
                m = out.metrics
                corr = _correlation_with_brick1(c, panel)
                m["corr_with_brick1"] = corr
            except Exception as exc:                       # noqa: BLE001
                log.warning("H2 %s %sh a echoue : %s", universe, lookback, exc)
                continue
            if prior is None:
                reg.record("H2", params, m, status="tested",
                           note=f"cross-sectionnel seul, univers {universe} "
                                f"({len(symbols)} actifs), lookback {lookback}h")
            rows.append({"universe": universe, "n_symbols": len(symbols),
                         "lookback_hours": lookback, "sharpe": m.get("sharpe"),
                         "monthly_median": m.get("monthly_return_median"),
                         "max_drawdown": m.get("max_drawdown"),
                         "n_trades": m.get("n_trades"),
                         "corr_with_brick1": corr})

    df = pd.DataFrame(rows)
    verdict = _verdict(df)
    payload = {"results": rows, "verdict": verdict,
               "extended_symbols_available": extended,
               "n_extended": len(extended)}
    atomic_write_json(cfg.artifacts_root / "h2_universe_study.json", payload)
    if len(df):
        df.to_csv(cfg.artifacts_root / "h2_universe_study.csv", index=False)
    state.mark_done("h2_universe_study", **{k: v for k, v in verdict.items()
                                            if isinstance(v, (int, float, bool, str))})
    log.info("H2 : %s", verdict.get("recommendation"))
    return payload


def _correlation_with_brick1(cfg: Config, panel) -> float:
    """Correlation des PnL theoriques des deux briques sur le meme panel."""
    try:
        b1 = TSMomentum(brick_params(cfg, "ts_momentum")).compute(panel)
        b2 = CrossSectionalMomentum(brick_params(cfg, "cross_sectional")).compute(panel)
        p1 = brick_pnl_proxy(b1.weights, panel)
        p2 = brick_pnl_proxy(b2.weights, panel)
        m = np.isfinite(p1) & np.isfinite(p2)
        if m.sum() < 100:
            return float("nan")
        return float(np.corrcoef(p1[m], p2[m])[0, 1])
    except Exception:                                      # noqa: BLE001
        return float("nan")


def _verdict(df: pd.DataFrame) -> dict:
    if not len(df):
        return {"recommendation": "indetermine", "reason": "aucun resultat"}
    best = df.loc[df.groupby("universe")["sharpe"].idxmax()]
    b = best[best["universe"] == "base"]
    e = best[best["universe"] == "extended"]
    if not len(b) or not len(e):
        return {"recommendation": "indetermine", "reason": "un univers manquant"}
    sb, se = float(b["sharpe"].iloc[0]), float(e["sharpe"].iloc[0])
    cb, ce = float(b["corr_with_brick1"].iloc[0]), float(e["corr_with_brick1"].iloc[0])
    improves = se > sb + 0.15
    keeps_decorrelation = abs(ce) <= abs(cb) + 0.10
    return {
        "best_sharpe_base": sb,
        "best_sharpe_extended": se,
        "sharpe_gain": se - sb,
        "corr_with_brick1_base": cb,
        "corr_with_brick1_extended": ce,
        "improves_sharpe": bool(improves),
        "keeps_decorrelation": bool(keeps_decorrelation),
        "recommended": bool(improves and keeps_decorrelation),
        "recommendation": (
            "Extension recommandee : elle ameliore le Sharpe de la brique 2 sans "
            "degrader sa decorrelation avec la brique 1."
            if improves and keeps_decorrelation else
            "Extension NON recommandee sur ces mesures : "
            + ("le gain de Sharpe est insuffisant. " if not improves else "")
            + ("la decorrelation avec la brique 1 se degrade, ce qui annule "
               "l'interet de la brique. " if not keeps_decorrelation else "")),
    }
