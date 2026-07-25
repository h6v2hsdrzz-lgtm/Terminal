"""Controle qualite des donnees — produit AVANT toute recherche (§3).

Verifie, par symbole et par timeframe : couverture, trous, doublons, barres a
volume nul, incoherences OHLC, valeurs aberrantes, et periodes suspectes de
maintenance exchange.

Verifie en plus deux points propres a ce projet :

  * `funding_cross_check` — l'API publique OKX ne retient qu'environ 3 mois de
    funding. L'historique de travail vient des dumps Binance USD-M. Ce controle
    mesure l'ecart entre les deux sur la fenetre de recouvrement reellement
    disponible et rapporte correlation, biais moyen et erreur absolue. C'est
    cette mesure, pas une hypothese, qui dit si la substitution est acceptable.
  * `basis_sanity` — coherence perp / mark / index.
"""
from __future__ import annotations

import json
import logging

import numpy as np
import pandas as pd

from ..core.config import Config
from ..core.persist import RunState, atomic_write_json, atomic_write_text
from .store import ParquetStore

log = logging.getLogger("okx_algo.quality")

TF_MINUTES = {"1m": 1, "15m": 15, "1H": 60, "4H": 240, "1D": 1440}


def _series_report(df: pd.DataFrame, timeframe: str) -> dict:
    if df is None or not len(df):
        return {"status": "absent"}
    d = df.sort_values("datetime")
    ts = d["datetime"]
    step = pd.Timedelta(minutes=TF_MINUTES[timeframe])
    expected = int((ts.iloc[-1] - ts.iloc[0]) / step) + 1
    gaps = ts.diff().dropna()
    holes = gaps[gaps > step]

    rep = {
        "status": "ok",
        "rows": int(len(d)),
        "start": str(ts.iloc[0]),
        "end": str(ts.iloc[-1]),
        "expected_bars": expected,
        "coverage_pct": round(100.0 * len(d) / expected, 4) if expected else np.nan,
        "duplicates": int(d["datetime"].duplicated().sum()),
        "n_gaps": int(len(holes)),
        "missing_bars": int(expected - len(d)),
        "largest_gap_hours": round(float(holes.max().total_seconds() / 3600), 2) if len(holes) else 0.0,
    }
    if len(holes):
        top = holes.sort_values(ascending=False).head(10)
        rep["top_gaps"] = [
            {"ends_at": str(ts.loc[i]), "gap_hours": round(g.total_seconds() / 3600, 2)}
            for i, g in top.items()
        ]
    if "volume" in d.columns:
        rep["zero_volume_bars"] = int((d["volume"].fillna(0) <= 0).sum())
        rep["zero_volume_pct"] = round(100.0 * rep["zero_volume_bars"] / len(d), 4)
    if {"open", "high", "low", "close"} <= set(d.columns):
        bad = ((d["high"] < d["low"]) | (d["high"] < d["open"]) | (d["high"] < d["close"]) |
               (d["low"] > d["open"]) | (d["low"] > d["close"]))
        rep["ohlc_inconsistent"] = int(bad.sum())
        rep["non_positive_prices"] = int((d[["open", "high", "low", "close"]] <= 0).any(axis=1).sum())
        r = np.log(d["close"] / d["close"].shift(1)).replace([np.inf, -np.inf], np.nan)
        sd = r.std()
        rep["return_outliers_10sigma"] = int((r.abs() > 10 * sd).sum()) if sd and sd > 0 else 0
        rep["max_abs_bar_return"] = round(float(r.abs().max()), 5) if len(r.dropna()) else np.nan
    return rep


def funding_cross_check(store: ParquetStore, symbol: str) -> dict:
    """Ecart mesure entre funding OKX reel et funding Binance de substitution."""
    okx = store.try_read("funding_okx", symbol)
    bnb = store.try_read("funding", symbol)
    if okx is None or bnb is None or not len(okx) or not len(bnb):
        return {"status": "indisponible"}
    a = okx.set_index("datetime")["funding_rate"]
    b = bnb.set_index("datetime")["funding_rate"]
    both = pd.concat([a.rename("okx"), b.rename("binance")], axis=1).dropna()
    if len(both) < 20:
        return {"status": "recouvrement_insuffisant", "n": int(len(both))}
    diff = both["okx"] - both["binance"]
    ann = 3 * 365  # 3 settlements par jour
    return {
        "status": "ok",
        "overlap_settlements": int(len(both)),
        "overlap_start": str(both.index[0]),
        "overlap_end": str(both.index[-1]),
        "correlation": round(float(both["okx"].corr(both["binance"])), 4),
        "mean_okx_annualized_pct": round(float(both["okx"].mean() * ann * 100), 3),
        "mean_binance_annualized_pct": round(float(both["binance"].mean() * ann * 100), 3),
        "mean_bias_annualized_pct": round(float(diff.mean() * ann * 100), 3),
        "mae_annualized_pct": round(float(diff.abs().mean() * ann * 100), 3),
        "sign_agreement_pct": round(float((np.sign(both["okx"]) == np.sign(both["binance"])).mean() * 100), 2),
    }


def basis_sanity(store: ParquetStore, symbol: str) -> dict:
    perp = store.try_read("ohlcv", symbol, "1H")
    mark = store.try_read("mark", symbol, "1H")
    index = store.try_read("index", symbol, "1H")
    if perp is None or mark is None or index is None:
        return {"status": "incomplet"}
    p = perp.set_index("datetime")["close"]
    m = mark.set_index("datetime")["close"]
    x = index.set_index("datetime")["close"]
    df = pd.concat([p.rename("perp"), m.rename("mark"), x.rename("index")], axis=1).dropna()
    if not len(df):
        return {"status": "aucun_recouvrement"}
    basis = (df["perp"] - df["index"]) / df["index"]
    return {
        "status": "ok",
        "rows": int(len(df)),
        "median_basis_bps": round(float(basis.median() * 1e4), 2),
        "p99_abs_basis_bps": round(float(basis.abs().quantile(0.99) * 1e4), 2),
        "max_abs_basis_bps": round(float(basis.abs().max() * 1e4), 2),
        "perp_vs_mark_median_bps": round(float(((df["perp"] - df["mark"]) / df["mark"]).median() * 1e4), 2),
    }


# ----------------------------------------------------------------------
def run_quality_report(cfg: Config, state: RunState) -> dict:
    store = ParquetStore(cfg.data_root)
    symbols = cfg.get("universe.symbols")
    report: dict = {"generated_at": pd.Timestamp.utcnow().isoformat(), "symbols": {}}

    for sym in symbols:
        entry: dict = {"ohlcv": {}}
        for tf in cfg.get("data.timeframes"):
            entry["ohlcv"][tf] = _series_report(store.try_read("ohlcv", sym, tf), tf)
        entry["mark_1H"] = _series_report(store.try_read("mark", sym, "1H"), "1H")
        entry["index_1H"] = _series_report(store.try_read("index", sym, "1H"), "1H")

        fund = store.try_read("funding", sym)
        if fund is not None and len(fund):
            ann = 3 * 365
            entry["funding"] = {
                "status": "ok", "rows": int(len(fund)),
                "start": str(fund["datetime"].iloc[0]), "end": str(fund["datetime"].iloc[-1]),
                "mean_annualized_pct": round(float(fund["funding_rate"].mean() * ann * 100), 3),
                "pct_positive": round(float((fund["funding_rate"] > 0).mean() * 100), 2),
                "max_abs_rate_bps": round(float(fund["funding_rate"].abs().max() * 1e4), 2),
                "expected_settlements": int((fund["datetime"].iloc[-1] - fund["datetime"].iloc[0])
                                            / pd.Timedelta(hours=8)) + 1,
                "source": "binance_vision_usdm",
            }
        else:
            entry["funding"] = {"status": "absent"}

        oi = store.try_read("open_interest", sym)
        entry["open_interest"] = ({"status": "ok", "rows": int(len(oi)),
                                   "start": str(oi["datetime"].iloc[0]),
                                   "end": str(oi["datetime"].iloc[-1]),
                                   "granularity_minutes": 5, "source": "binance_vision_metrics"}
                                  if oi is not None and len(oi) else {"status": "absent"})
        entry["funding_cross_check"] = funding_cross_check(store, sym)
        entry["basis"] = basis_sanity(store, sym)
        report["symbols"][sym] = entry

    report["blocking_issues"] = _blocking_issues(report)
    out = cfg.artifacts_root / "data_quality_report.json"
    atomic_write_json(out, report)
    atomic_write_text(cfg.artifacts_root / "data_quality_report.md", _markdown(report))
    log.info("rapport qualite ecrit: %s (%d points bloquants)",
             out, len(report["blocking_issues"]))
    state.mark_done("data_quality_report", path=str(out),
                    blocking=len(report["blocking_issues"]))
    return report


def _blocking_issues(report: dict) -> list[str]:
    issues = []
    for sym, entry in report["symbols"].items():
        for tf, rep in entry["ohlcv"].items():
            if rep.get("status") == "absent":
                issues.append(f"{sym} {tf}: donnee absente")
                continue
            if rep.get("duplicates", 0) > 0:
                issues.append(f"{sym} {tf}: {rep['duplicates']} doublons")
            if rep.get("ohlc_inconsistent", 0) > 0:
                issues.append(f"{sym} {tf}: {rep['ohlc_inconsistent']} barres OHLC incoherentes")
            if rep.get("non_positive_prices", 0) > 0:
                issues.append(f"{sym} {tf}: prix nuls ou negatifs")
            cov = rep.get("coverage_pct")
            if cov is not None and np.isfinite(cov) and cov < 97.0:
                issues.append(f"{sym} {tf}: couverture {cov:.2f} % < 97 %")
        if entry["funding"].get("status") != "ok":
            issues.append(f"{sym}: funding absent")
    return issues


def _markdown(report: dict) -> str:
    lines = ["# Rapport de qualite des donnees", "",
             f"Genere le {report['generated_at']}", ""]
    blocking = report["blocking_issues"]
    lines += ["## Points bloquants", ""]
    lines += ([f"- {b}" for b in blocking] if blocking else ["Aucun."])
    lines.append("")
    for sym, entry in report["symbols"].items():
        lines += [f"## {sym}", "", "### OHLCV", "",
                  "| TF | lignes | debut | fin | couverture | trous | barres manquantes | vol nul | outliers 10σ |",
                  "|---|---|---|---|---|---|---|---|---|"]
        for tf, r in entry["ohlcv"].items():
            if r.get("status") != "ok":
                lines.append(f"| {tf} | absent | | | | | | | |")
                continue
            lines.append(
                f"| {tf} | {r['rows']:,} | {r['start'][:16]} | {r['end'][:16]} | "
                f"{r['coverage_pct']:.2f} % | {r['n_gaps']} | {r['missing_bars']:,} | "
                f"{r.get('zero_volume_bars', 0):,} | {r.get('return_outliers_10sigma', 0)} |")
        f = entry["funding"]
        lines += ["", "### Funding, open interest, basis", ""]
        if f.get("status") == "ok":
            lines.append(f"- funding : {f['rows']:,} reglements, {f['start'][:10]} -> {f['end'][:10]}, "
                         f"moyenne {f['mean_annualized_pct']:.2f} %/an, "
                         f"{f['pct_positive']:.1f} % positifs (source : {f['source']})")
        else:
            lines.append("- funding : absent")
        oi = entry["open_interest"]
        lines.append(f"- open interest : {oi.get('rows', 0):,} points au pas 5 min"
                     if oi.get("status") == "ok" else "- open interest : absent")
        cc = entry["funding_cross_check"]
        if cc.get("status") == "ok":
            lines.append(
                f"- controle croise funding OKX vs Binance sur {cc['overlap_settlements']} reglements "
                f"({cc['overlap_start'][:10]} -> {cc['overlap_end'][:10]}) : "
                f"correlation {cc['correlation']:.3f}, biais moyen {cc['mean_bias_annualized_pct']:+.2f} %/an, "
                f"erreur absolue moyenne {cc['mae_annualized_pct']:.2f} %/an, "
                f"accord de signe {cc['sign_agreement_pct']:.1f} %")
        b = entry["basis"]
        if b.get("status") == "ok":
            lines.append(f"- basis perp/index : mediane {b['median_basis_bps']:.1f} bps, "
                         f"p99 {b['p99_abs_basis_bps']:.1f} bps, max {b['max_abs_basis_bps']:.1f} bps")
        lines.append("")
    return "\n".join(lines)
