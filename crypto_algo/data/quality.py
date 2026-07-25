"""Contrôle qualité automatique des données (§2).

Le rapport est produit **avant** toute recherche. Une série qui échoue au
contrôle ne doit pas servir de base à une conclusion.

Contrôles : grille temporelle (gaps, doublons, ordre), cohérence OHLC,
barres à volume nul, outliers de prix (MAD sur rendements log), fenêtres de
maintenance exchange, couverture du funding, écart mark/close.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..config import Config, resolve_path
from ..utils import ensure_dir, get_logger, timeframe_to_ms, utc_index
from .store import ParquetStore

log = get_logger("data.quality")


@dataclass
class QualityReport:
    symbol: str
    timeframe: str
    kind: str = "ohlcv"
    bars: int = 0
    start: str | None = None
    end: str | None = None
    expected_bars: int = 0
    missing_bars: int = 0
    gap_ratio: float = 0.0
    duplicate_bars: int = 0
    duplicate_ratio: float = 0.0
    unsorted: bool = False
    zero_volume_bars: int = 0
    zero_volume_ratio: float = 0.0
    ohlc_violations: int = 0
    non_positive_prices: int = 0
    outliers: int = 0
    max_abs_return: float = 0.0
    maintenance_windows: list[dict[str, Any]] = field(default_factory=list)
    largest_gap_bars: int = 0
    passed: bool = True
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def as_row(self) -> dict[str, Any]:
        d = asdict(self)
        d["maintenance_windows"] = len(self.maintenance_windows)
        d["failures"] = "; ".join(self.failures)
        d["warnings"] = "; ".join(self.warnings)
        return d


def check_dataset(
    df: pd.DataFrame,
    symbol: str,
    timeframe: str,
    cfg: Config,
    kind: str = "ohlcv",
) -> QualityReport:
    """Contrôle qualité d'une série OHLCV brute (colonnes timestamp/o/h/l/c/v)."""
    rep = QualityReport(symbol=symbol, timeframe=timeframe, kind=kind)
    if df is None or df.empty:
        rep.passed = False
        rep.failures.append("série vide")
        return rep

    q = cfg.sub("quality")
    step = timeframe_to_ms(timeframe)
    raw = df.copy()

    # --- doublons et ordre (sur les données brutes, avant nettoyage) ---
    rep.duplicate_bars = int(raw["timestamp"].duplicated().sum())
    rep.unsorted = bool((raw["timestamp"].diff().dropna() < 0).any())

    data = utc_index(raw.drop_duplicates(subset="timestamp", keep="last")).sort_index()
    rep.bars = len(data)
    rep.start = str(data.index.min())
    rep.end = str(data.index.max())
    rep.duplicate_ratio = rep.duplicate_bars / max(rep.bars, 1)

    # --- grille temporelle : barres manquantes ---
    span_ms = int((data.index.max() - data.index.min()).total_seconds() * 1000)
    rep.expected_bars = span_ms // step + 1
    rep.missing_bars = max(0, rep.expected_bars - rep.bars)
    rep.gap_ratio = rep.missing_bars / max(rep.expected_bars, 1)

    # --- fenêtres de maintenance : trous >= N barres consécutives ---
    deltas = data["timestamp"].diff()
    min_missing = int(q["maintenance_min_missing_bars"])
    gaps = deltas[deltas > step]
    if len(gaps):
        rep.largest_gap_bars = int(gaps.max() // step) - 1
        for ts, delta in gaps.items():
            missing = int(delta // step) - 1
            if missing >= min_missing:
                rep.maintenance_windows.append(
                    {
                        "from": str(ts - pd.Timedelta(milliseconds=int(delta))),
                        "to": str(ts),
                        "missing_bars": missing,
                        "hours": round(missing * step / 3_600_000, 2),
                    }
                )

    # --- cohérence OHLC ---
    o, h, l, c = data["open"], data["high"], data["low"], data["close"]
    bad = (h < l) | (h < o) | (h < c) | (l > o) | (l > c)
    rep.ohlc_violations = int(bad.sum())
    rep.non_positive_prices = int((data[["open", "high", "low", "close"]] <= 0).any(axis=1).sum())

    # --- volume nul ---
    if "volume" in data:
        rep.zero_volume_bars = int((data["volume"] <= 0).sum())
        rep.zero_volume_ratio = rep.zero_volume_bars / max(rep.bars, 1)

    # --- outliers de prix : MAD sur les rendements log ---
    ret = np.log(c).diff().dropna()
    if len(ret) > 10:
        med = float(ret.median())
        mad = float((ret - med).abs().median())
        scale = mad * 1.4826 if mad > 0 else float(ret.std(ddof=0)) or 1e-12
        z = (ret - med).abs() / scale
        rep.outliers = int((z > float(q["outlier_mad_sigma"])).sum())
        rep.max_abs_return = float(ret.abs().max())

    # --- verdict ---
    if rep.gap_ratio > float(q["max_gap_ratio"]):
        rep.failures.append(f"gaps {rep.gap_ratio:.2%} > {float(q['max_gap_ratio']):.2%}")
    if rep.duplicate_ratio > float(q["max_duplicate_ratio"]):
        rep.failures.append(f"doublons {rep.duplicate_bars}")
    if rep.ohlc_violations:
        rep.failures.append(f"{rep.ohlc_violations} barres OHLC incohérentes")
    if rep.non_positive_prices:
        rep.failures.append(f"{rep.non_positive_prices} prix <= 0")
    if rep.zero_volume_ratio > float(q["zero_volume_warn_ratio"]):
        rep.warnings.append(f"volume nul sur {rep.zero_volume_ratio:.2%} des barres")
    if rep.outliers:
        rep.warnings.append(f"{rep.outliers} outliers de rendement (MAD)")
    if rep.maintenance_windows:
        rep.warnings.append(f"{len(rep.maintenance_windows)} fenêtres de maintenance")
    rep.passed = not rep.failures
    return rep


def check_funding(df: pd.DataFrame, symbol: str, cfg: Config) -> QualityReport:
    """Contrôle de l'historique de funding (cycles 8h)."""
    rep = QualityReport(symbol=symbol, timeframe="8h", kind="funding")
    if df is None or df.empty:
        rep.passed = False
        rep.failures.append("funding absent — le backtest x10 serait faussé")
        return rep
    data = utc_index(df.drop_duplicates(subset="timestamp", keep="last")).sort_index()
    step = 8 * 3_600_000
    rep.bars = len(data)
    rep.start, rep.end = str(data.index.min()), str(data.index.max())
    span = int((data.index.max() - data.index.min()).total_seconds() * 1000)
    rep.expected_bars = span // step + 1
    rep.missing_bars = max(0, rep.expected_bars - rep.bars)
    rep.gap_ratio = rep.missing_bars / max(rep.expected_bars, 1)
    rep.max_abs_return = float(data["funding_rate"].abs().max())
    if rep.gap_ratio > float(cfg.get_path("quality.max_gap_ratio")):
        rep.failures.append(f"cycles de funding manquants : {rep.gap_ratio:.2%}")
    if rep.max_abs_return > 0.01:
        rep.warnings.append(f"funding extrême observé : {rep.max_abs_return:.4%} / 8h")
    rep.passed = not rep.failures
    return rep


def check_mark_vs_close(mark: pd.DataFrame, ohlcv: pd.DataFrame, symbol: str, cfg: Config) -> QualityReport:
    rep = QualityReport(symbol=symbol, timeframe="-", kind="mark_vs_close")
    if mark is None or mark.empty or ohlcv is None or ohlcv.empty:
        rep.warnings.append("mark price absent — la liquidation utilisera le close")
        return rep
    m = utc_index(mark).sort_index()["close"]
    c = utc_index(ohlcv).sort_index()["close"]
    joined = pd.concat([m.rename("mark"), c.rename("close")], axis=1).dropna()
    rep.bars = len(joined)
    if joined.empty:
        rep.warnings.append("aucun recouvrement mark/close")
        return rep
    dev = ((joined["mark"] - joined["close"]).abs() / joined["close"])
    rep.max_abs_return = float(dev.max())
    limit = float(cfg.get_path("quality.mark_vs_close_max_dev"))
    if rep.max_abs_return > limit:
        rep.failures.append(f"écart mark/close max {rep.max_abs_return:.2%} > {limit:.2%}")
    rep.passed = not rep.failures
    return rep


def run_quality_control(
    cfg: Config,
    symbols: list[str] | None = None,
    timeframes: list[str] | None = None,
    store: ParquetStore | None = None,
    write_report: bool = True,
) -> pd.DataFrame:
    """Exécute tous les contrôles sur le cache et produit le rapport qualité."""
    store = store or ParquetStore(resolve_path(cfg, cfg.get_path("data.store_path")))
    symbols = symbols or list(cfg.get_path("universe.symbols"))
    tfs = list(timeframes or cfg.get_path("data.signal_timeframes"))
    exec_tf = cfg.get_path("data.execution_timeframe")
    if exec_tf not in tfs:
        tfs.append(exec_tf)
    intrabar = cfg.get_path("data.intrabar_timeframe")
    if store.exists("ohlcv", symbols[0], intrabar) and intrabar not in tfs:
        tfs.append(intrabar)

    reports: list[QualityReport] = []
    for sym in symbols:
        for tf in tfs:
            df = store.read("ohlcv", sym, tf)
            reports.append(check_dataset(df, sym, tf, cfg))
        reports.append(check_funding(store.read("funding", sym), sym, cfg))
        reports.append(
            check_mark_vs_close(store.read("mark", sym, exec_tf), store.read("ohlcv", sym, exec_tf), sym, cfg)
        )

    table = pd.DataFrame([r.as_row() for r in reports])
    if write_report:
        out_dir = ensure_dir(resolve_path(cfg, cfg.get_path("reports.output_dir")) / "data_quality")
        table.to_csv(out_dir / "quality_report.csv", index=False)
        with open(out_dir / "quality_report.json", "w", encoding="utf-8") as fh:
            json.dump([asdict(r) for r in reports], fh, indent=2, default=str)
        _write_markdown(table, reports, out_dir / "quality_report.md")
        log.info("Rapport qualité écrit dans %s", out_dir)

    n_fail = int((~table["passed"]).sum()) if "passed" in table else 0
    if n_fail:
        log.warning("%d séries échouent au contrôle qualité", n_fail)
    else:
        log.info("Contrôle qualité : toutes les séries passent")
    return table


def _write_markdown(table: pd.DataFrame, reports: list[QualityReport], path: Path) -> None:
    lines = ["# Rapport de qualité des données", ""]
    ok = int(table["passed"].sum()) if "passed" in table else 0
    lines.append(f"- séries contrôlées : **{len(table)}**")
    lines.append(f"- séries conformes : **{ok}** / {len(table)}")
    lines.append("")
    cols = [
        "symbol", "timeframe", "kind", "bars", "start", "end",
        "gap_ratio", "duplicate_bars", "zero_volume_ratio", "ohlc_violations",
        "outliers", "passed", "failures", "warnings",
    ]
    cols = [c for c in cols if c in table.columns]
    lines.append(table[cols].to_markdown(index=False))
    lines.append("")
    windows = [(r.symbol, r.timeframe, w) for r in reports for w in r.maintenance_windows]
    if windows:
        lines += ["## Fenêtres de maintenance / trous significatifs", ""]
        lines.append("| symbole | TF | début | fin | barres manquantes | heures |")
        lines.append("|---|---|---|---|---|---|")
        for sym, tf, w in windows[:200]:
            lines.append(f"| {sym} | {tf} | {w['from']} | {w['to']} | {w['missing_bars']} | {w['hours']} |")
        if len(windows) > 200:
            lines.append(f"| … | | | | {len(windows) - 200} autres | |")
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    import argparse

    from ..config import load_config
    from ..utils import setup_logging

    parser = argparse.ArgumentParser(description="Contrôle qualité des données")
    parser.add_argument("--config", nargs="*", default=None)
    args = parser.parse_args(argv)
    setup_logging("INFO")
    cfg = load_config(args.config)
    table = run_quality_control(cfg)
    print(table.to_string(index=False))
    return 0 if bool(table.get("passed", pd.Series([True])).all()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
