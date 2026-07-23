"""Rapport de forward test : paper/demo/live vs attentes du backtest.

Compare des grandeurs INVARIANTES au niveau de risque (win rate, expectancy
en R, profit factor, fréquence de trades) entre le journal du bot et le
résumé OOS de la validation (``expectations_path``). Signale une dégradation
précoce plutôt que d'attendre la fin du forward test pour découvrir que le
réel ne ressemble pas au backtest.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from goldsilver.live.config import LiveConfig
from goldsilver.live.journal import Journal


@dataclass(frozen=True)
class ForwardStats:
    n_trades: int
    win_rate: float | None
    expectancy_r: float | None
    profit_factor: float | None
    total_pnl: float
    trades_per_month: float | None
    mean_slippage_r: float | None
    days_running: float | None


def compute_forward_stats(events: list[dict[str, Any]]) -> ForwardStats:
    orders = {e.get("trade_id"): e for e in events
              if e.get("type") == "order" and e.get("accepted") and e.get("trade_id")}
    closed = [e for e in events if e.get("type") == "trade_closed"]
    slippage = [e for e in events if e.get("type") == "slippage"]
    cycles = [e for e in events if e.get("type") == "cycle"]

    pnls: list[float] = []
    rs: list[float] = []
    for c in closed:
        pnl = float(c.get("pnl", 0.0))
        pnls.append(pnl)
        order = orders.get(c.get("trade_id"))
        risk = float(order["risk_amount"]) if order and order.get("risk_amount") else None
        if risk:
            rs.append(pnl / risk)

    n = len(pnls)
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    gross_win, gross_loss = sum(wins), -sum(losses)

    days = None
    if len(cycles) >= 2:
        import pandas as pd
        t0 = pd.Timestamp(cycles[0]["ts"])
        t1 = pd.Timestamp(cycles[-1]["ts"])
        days = max((t1 - t0).total_seconds() / 86400.0, 1e-9)

    return ForwardStats(
        n_trades=n,
        win_rate=len(wins) / n if n else None,
        expectancy_r=sum(rs) / len(rs) if rs else None,
        profit_factor=(gross_win / gross_loss) if gross_loss > 0 else None,
        total_pnl=sum(pnls),
        trades_per_month=(n / days * 30.44) if days and n else None,
        mean_slippage_r=(
            sum(float(s["excess_r"]) for s in slippage) / len(slippage)
            if slippage else None
        ),
        days_running=days,
    )


def _fmt(x: float | None, pct: bool = False, nd: int = 2) -> str:
    if x is None:
        return "n/a"
    return f"{100 * x:.{nd}f} %" if pct else f"{x:.{nd}f}"


def build_report(cfg: LiveConfig) -> str:
    journal = Journal(cfg.resolve(cfg.journal_path))
    stats = compute_forward_stats(journal.read_all())

    expected: dict[str, Any] = {}
    if cfg.expectations_path:
        p = cfg.resolve(cfg.expectations_path)
        if p.exists():
            summary = json.loads(p.read_text(encoding="utf-8"))
            oos = summary.get("oos_default_metrics", {})
            expected = {
                "win_rate": oos.get("win_rate"),
                "expectancy_r": oos.get("expectancy_r"),
                "profit_factor": oos.get("profit_factor"),
                "n_days": oos.get("n_days"),
                "n_trades": oos.get("n_trades"),
                "verdict": summary.get("verdict"),
            }

    exp_freq = None
    if expected.get("n_trades") and expected.get("n_days"):
        exp_freq = expected["n_trades"] / expected["n_days"] * 30.44

    lines = [
        "# Forward test vs backtest (grandeurs invariantes au risque)",
        "",
        f"Jours de forward : {_fmt(stats.days_running, nd=1)} — "
        f"trades clos : {stats.n_trades} — PnL total : {stats.total_pnl:+.2f} $",
        "",
        "| Grandeur | Forward | Attendu (backtest OOS) |",
        "|---|---|---|",
        f"| Win rate | {_fmt(stats.win_rate, pct=True)} | "
        f"{_fmt(expected.get('win_rate'), pct=True)} |",
        f"| Expectancy (R) | {_fmt(stats.expectancy_r, nd=3)} | "
        f"{_fmt(expected.get('expectancy_r'), nd=3)} |",
        f"| Profit factor | {_fmt(stats.profit_factor)} | "
        f"{_fmt(expected.get('profit_factor'))} |",
        f"| Trades / mois | {_fmt(stats.trades_per_month, nd=1)} | "
        f"{_fmt(exp_freq, nd=1)} |",
        f"| Slippage moyen (fraction de R) | {_fmt(stats.mean_slippage_r, nd=4)} | "
        f"~0 (hypothèse backtest : spread pessimiste + slippage fixe) |",
        "",
    ]

    flags: list[str] = []
    if stats.n_trades < 20:
        flags.append(
            f"Échantillon trop petit ({stats.n_trades} trades) : AUCUNE conclusion "
            "possible — continuer le forward test (cible : >= 30-50 trades)."
        )
    else:
        if stats.expectancy_r is not None and stats.expectancy_r <= 0:
            flags.append("DÉGRADATION : expectancy R <= 0 en forward.")
        wr_exp = expected.get("win_rate")
        if stats.win_rate is not None and wr_exp and stats.win_rate < wr_exp - 0.15:
            flags.append("DÉGRADATION : win rate 15 pts sous l'attendu.")
        if stats.mean_slippage_r and stats.mean_slippage_r > 0.05:
            flags.append("DÉGRADATION : coûts d'exécution réels > 5 % de R.")
        if not flags:
            flags.append("Pas de dégradation détectée à ce stade — poursuivre.")
    lines += ["## Diagnostic", *[f"- {f}" for f in flags], ""]
    return "\n".join(lines)
