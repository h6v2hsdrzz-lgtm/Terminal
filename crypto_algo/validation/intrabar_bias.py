"""Mesure du biais de résolution intrabar.

Quand un stop et un objectif sont touchés dans la même bougie d'exécution, le
backtest doit décider lequel a été atteint en premier. Trois régimes possibles :

* résolution en **1m** — la vérité, mais l'historique 1m sur plusieurs années
  représente ~11 500 requêtes par symbole chez OKX ;
* résolution en **5m** — ce que fait ce framework sur tout l'historique ;
* **hypothèse pessimiste** (stop d'abord) quand aucune donnée fine n'existe.

Plutôt que de supposer ce biais négligeable, on le **mesure** : on télécharge
le 1m sur une sous-période, on rejoue la stratégie avec chaque niveau de
résolution, et on publie l'écart. C'est le seul moyen honnête de savoir si
l'approximation change la conclusion ou non.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from ..backtest.engine import BacktestEngine
from ..config import Config
from ..data.loader import MarketData, _prepare
from ..data.store import ParquetStore
from ..reports.metrics import compute_metrics
from ..utils import get_logger

log = get_logger("validation.intrabar")


def _with_intrabar(md: MarketData, store: ParquetStore, timeframe: str,
                   start, end) -> MarketData:
    out = MarketData(
        symbols=list(md.symbols), ohlcv=dict(md.ohlcv), funding=dict(md.funding),
        mark=dict(md.mark), index=dict(md.index), open_interest=dict(md.open_interest),
        split=md.split,
    )
    for symbol in md.symbols:
        df = _prepare(store.read("ohlcv", symbol, timeframe, start=start, end=end))
        out.ohlcv[(symbol, timeframe)] = df
    return out


def measure_intrabar_bias(
    cfg: Config,
    md: MarketData,
    strategy_factory,
    store: ParquetStore,
    start,
    end,
    resolutions: tuple[str, ...] = ("1m", "5m", "none"),
) -> pd.DataFrame:
    """Rejoue la même stratégie avec plusieurs finesses de résolution intrabar."""
    rows = []
    for resolution in resolutions:
        if resolution == "none":
            run_cfg = cfg.with_overrides({"execution.intrabar.resolve_with_intrabar": False})
            run_md = md
        else:
            run_cfg = cfg.with_overrides({
                "execution.intrabar.resolve_with_intrabar": True,
                "data.intrabar_timeframe": resolution,
            })
            run_md = _with_intrabar(md, store, resolution, start, end)
            if run_md.ohlcv.get((md.symbols[0], resolution), pd.DataFrame()).empty:
                log.warning("résolution %s indisponible dans le cache — ignorée", resolution)
                continue

        result = BacktestEngine(run_cfg, run_md, strategy_factory()).run()
        report = compute_metrics(
            result.equity["equity"], result.trades, stats=result.stats,
            days_per_year=int(cfg.get_path("reports.annualization_days")),
            name=f"intrabar_{resolution}",
        )
        stats = result.stats
        rows.append(
            {
                "resolution": resolution,
                "trades": report.metrics.get("trades"),
                "total_return": report.metrics.get("total_return"),
                "sharpe": report.metrics.get("sharpe"),
                "max_drawdown": report.metrics.get("max_drawdown"),
                "win_rate": report.metrics.get("win_rate"),
                "net_pnl": report.metrics.get("net_pnl"),
                "ambiguous_bars": stats.get("exec_ambiguous_bars", 0),
                "resolved_intrabar": stats.get("exec_resolved_intrabar", 0),
                "resolved_assumption": stats.get("exec_resolved_assumption", 0),
            }
        )
    table = pd.DataFrame(rows)
    if len(table) > 1 and "1m" in set(table["resolution"]):
        reference = table[table["resolution"] == "1m"].iloc[0]
        table["net_pnl_gap_vs_1m"] = table["net_pnl"] - reference["net_pnl"]
        table["return_gap_vs_1m"] = table["total_return"] - reference["total_return"]
        table["sharpe_gap_vs_1m"] = table["sharpe"] - reference["sharpe"]
    return table


def ambiguity_rate(stats: dict[str, Any]) -> dict[str, float]:
    """Part des sorties qui ont demandé un arbitrage SL/TP dans la même bougie."""
    ambiguous = float(stats.get("exec_ambiguous_bars", 0))
    resolved = float(stats.get("exec_resolved_intrabar", 0))
    assumed = float(stats.get("exec_resolved_assumption", 0))
    total = max(ambiguous, 1.0)
    return {
        "ambiguous_bars": ambiguous,
        "resolved_with_data_share": resolved / total,
        "resolved_by_assumption_share": assumed / total,
    }
