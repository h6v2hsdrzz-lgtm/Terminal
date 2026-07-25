"""Métriques de performance et de risque (§9).

Toutes les métriques sont calculées sur la courbe d'equity **nette** (frais,
slippage et funding déjà déduits) et, quand c'est pertinent, comparées au brut
pour rendre visible ce que les coûts prélèvent.

Convention crypto : 365 jours de trading par an.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..utils import get_logger

log = get_logger("reports.metrics")


# ---------------------------------------------------------------------------
# Séries dérivées
# ---------------------------------------------------------------------------
def to_returns(equity: pd.Series, freq: str = "D") -> pd.Series:
    """Rendements périodiques à partir d'une courbe d'equity."""
    if equity is None or len(equity) == 0:
        return pd.Series(dtype=float)
    resampled = equity.resample(freq).last().ffill()
    return resampled.pct_change().dropna()


def drawdown_series(equity: pd.Series) -> pd.Series:
    hwm = equity.cummax()
    return equity / hwm - 1.0


def underwater_durations(equity: pd.Series) -> pd.Series:
    """Durées (en barres) des périodes passées sous le high-water mark."""
    dd = drawdown_series(equity)
    under = dd < -1e-12
    groups = (~under).cumsum()
    return under.groupby(groups).sum()[lambda s: s > 0]


# ---------------------------------------------------------------------------
# Métriques élémentaires
# ---------------------------------------------------------------------------
def cagr(equity: pd.Series, days_per_year: int = 365) -> float:
    if len(equity) < 2 or equity.iloc[0] <= 0:
        return float("nan")
    years = (equity.index[-1] - equity.index[0]).total_seconds() / (86400 * days_per_year)
    if years <= 0:
        return float("nan")
    total = equity.iloc[-1] / equity.iloc[0]
    if total <= 0:
        return -1.0
    return float(total ** (1.0 / years) - 1.0)


def sharpe(returns: pd.Series, risk_free: float = 0.0, periods_per_year: int = 365) -> float:
    if len(returns) < 3:
        return float("nan")
    excess = returns - risk_free / periods_per_year
    sd = excess.std(ddof=1)
    if sd == 0 or not np.isfinite(sd):
        return float("nan")
    return float(excess.mean() / sd * np.sqrt(periods_per_year))


def sortino(returns: pd.Series, risk_free: float = 0.0, periods_per_year: int = 365) -> float:
    if len(returns) < 3:
        return float("nan")
    excess = returns - risk_free / periods_per_year
    downside = excess[excess < 0]
    dd = np.sqrt((downside ** 2).mean()) if len(downside) else 0.0
    if dd == 0 or not np.isfinite(dd):
        return float("nan")
    return float(excess.mean() / dd * np.sqrt(periods_per_year))


def max_drawdown(equity: pd.Series) -> float:
    if len(equity) == 0:
        return float("nan")
    return float(drawdown_series(equity).min())


def max_drawdown_duration_days(equity: pd.Series) -> float:
    if len(equity) < 2:
        return float("nan")
    dd = drawdown_series(equity)
    under = dd < -1e-12
    if not under.any():
        return 0.0
    groups = (~under).cumsum()
    longest = pd.Timedelta(0)
    for _, block in dd[under].groupby(groups[under]):
        span = block.index[-1] - block.index[0]
        longest = max(longest, span)
    return float(longest.total_seconds() / 86400)


def calmar(equity: pd.Series, days_per_year: int = 365) -> float:
    mdd = abs(max_drawdown(equity))
    if mdd == 0 or not np.isfinite(mdd):
        return float("nan")
    return float(cagr(equity, days_per_year) / mdd)


def ulcer_index(equity: pd.Series) -> float:
    dd = drawdown_series(equity) * 100.0
    if len(dd) == 0:
        return float("nan")
    return float(np.sqrt((dd ** 2).mean()))


def value_at_risk(returns: pd.Series, level: float = 0.95) -> float:
    if len(returns) < 10:
        return float("nan")
    return float(np.quantile(returns, 1.0 - level))


def conditional_var(returns: pd.Series, level: float = 0.95) -> float:
    if len(returns) < 10:
        return float("nan")
    var = np.quantile(returns, 1.0 - level)
    tail = returns[returns <= var]
    return float(tail.mean()) if len(tail) else float("nan")


def monthly_returns(equity: pd.Series) -> pd.Series:
    """Rendements mensuels ; le premier mois est mesuré depuis l'equity initiale."""
    if len(equity) == 0:
        return pd.Series(dtype=float)
    monthly = equity.resample("ME").last().ffill()
    if monthly.empty:
        return pd.Series(dtype=float)
    returns = monthly.pct_change()
    first_equity = float(equity.iloc[0])
    if first_equity > 0:
        returns.iloc[0] = float(monthly.iloc[0]) / first_equity - 1.0
    return returns.dropna()


def monthly_table(equity: pd.Series) -> pd.DataFrame:
    """Tableau année x mois des rendements (pour la heatmap du rapport)."""
    m = monthly_returns(equity)
    if m.empty:
        return pd.DataFrame()
    frame = pd.DataFrame({"year": m.index.year, "month": m.index.month, "ret": m.to_numpy()})
    return frame.pivot(index="year", columns="month", values="ret")


# ---------------------------------------------------------------------------
# Métriques de trades
# ---------------------------------------------------------------------------
def trade_metrics(trades: pd.DataFrame) -> dict[str, Any]:
    if trades is None or trades.empty:
        return {
            "trades": 0, "win_rate": float("nan"), "profit_factor": float("nan"),
            "expectancy_r": float("nan"), "avg_win": float("nan"), "avg_loss": float("nan"),
            "payoff_ratio": float("nan"), "avg_holding_hours": float("nan"),
            "liquidations": 0, "gross_pnl": 0.0, "net_pnl": 0.0, "fees": 0.0,
            "funding": 0.0, "slippage": 0.0,
        }
    wins = trades[trades["net_pnl"] > 0]
    losses = trades[trades["net_pnl"] < 0]
    gross_profit = float(wins["net_pnl"].sum())
    gross_loss = float(-losses["net_pnl"].sum())
    r = trades["r_multiple"].replace([np.inf, -np.inf], np.nan).dropna()
    return {
        "trades": int(len(trades)),
        "win_rate": float(len(wins) / len(trades)),
        "profit_factor": float(gross_profit / gross_loss) if gross_loss > 0 else float("inf"),
        "expectancy_r": float(r.mean()) if len(r) else float("nan"),
        "r_std": float(r.std(ddof=1)) if len(r) > 1 else float("nan"),
        "avg_win": float(wins["net_pnl"].mean()) if len(wins) else 0.0,
        "avg_loss": float(losses["net_pnl"].mean()) if len(losses) else 0.0,
        "payoff_ratio": (
            float(wins["net_pnl"].mean() / abs(losses["net_pnl"].mean()))
            if len(wins) and len(losses) and losses["net_pnl"].mean() != 0 else float("nan")
        ),
        "avg_holding_hours": float(trades["holding_hours"].mean()),
        "max_holding_hours": float(trades["holding_hours"].max()),
        "liquidations": int((trades["exit_reason"] == "liquidation").sum()),
        "stop_exits": int((trades["exit_reason"] == "stop_loss").sum()),
        "tp_exits": int((trades["exit_reason"] == "take_profit").sum()),
        "signal_exits": int((trades["exit_reason"] == "signal").sum()),
        "timeout_exits": int((trades["exit_reason"] == "timeout").sum()),
        "gross_pnl": float(trades["gross_pnl"].sum()),
        "net_pnl": float(trades["net_pnl"].sum()),
        "fees": float(trades["fees"].sum()),
        "funding": float(trades["funding"].sum()),
        "slippage": float(trades["slippage"].sum()),
        "ambiguous_resolution_share": (
            float((trades["resolved_with"] == "assumption").mean())
            if "resolved_with" in trades else float("nan")
        ),
    }


# ---------------------------------------------------------------------------
# Rapport complet
# ---------------------------------------------------------------------------
@dataclass
class PerformanceReport:
    name: str
    metrics: dict[str, Any]
    monthly: pd.DataFrame = field(default_factory=pd.DataFrame)
    equity: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    drawdown: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))

    def to_frame(self) -> pd.DataFrame:
        return pd.DataFrame([{"strategy": self.name, **self.metrics}])


def compute_metrics(
    equity: pd.Series,
    trades: pd.DataFrame | None = None,
    benchmark_equity: pd.Series | None = None,
    stats: dict[str, Any] | None = None,
    days_per_year: int = 365,
    var_levels: tuple[float, ...] = (0.95, 0.99),
    name: str = "strategy",
) -> PerformanceReport:
    stats = stats or {}
    equity = equity.dropna()
    daily = to_returns(equity, "D")

    m: dict[str, Any] = {
        "start": str(equity.index[0]) if len(equity) else None,
        "end": str(equity.index[-1]) if len(equity) else None,
        "initial_equity": float(equity.iloc[0]) if len(equity) else float("nan"),
        "final_equity": float(equity.iloc[-1]) if len(equity) else float("nan"),
        "total_return": float(equity.iloc[-1] / equity.iloc[0] - 1.0) if len(equity) > 1 else float("nan"),
        "cagr": cagr(equity, days_per_year),
        "sharpe": sharpe(daily, periods_per_year=days_per_year),
        "sortino": sortino(daily, periods_per_year=days_per_year),
        "calmar": calmar(equity, days_per_year),
        "max_drawdown": max_drawdown(equity),
        "max_drawdown_days": max_drawdown_duration_days(equity),
        "ulcer_index": ulcer_index(equity),
        "volatility_annual": float(daily.std(ddof=1) * np.sqrt(days_per_year)) if len(daily) > 2 else float("nan"),
        "best_day": float(daily.max()) if len(daily) else float("nan"),
        "worst_day": float(daily.min()) if len(daily) else float("nan"),
    }
    for level in var_levels:
        m[f"var_{int(level * 100)}"] = value_at_risk(daily, level)
        m[f"cvar_{int(level * 100)}"] = conditional_var(daily, level)

    monthly = monthly_returns(equity)
    if len(monthly):
        m["monthly_median"] = float(monthly.median())
        m["monthly_mean"] = float(monthly.mean())
        m["monthly_std"] = float(monthly.std(ddof=1)) if len(monthly) > 1 else float("nan")
        m["monthly_positive_share"] = float((monthly > 0).mean())
        m["months"] = int(len(monthly))
        # intervalle de confiance 95 % de la médiane mensuelle (bootstrap)
        lo, hi = bootstrap_median_ci(monthly.to_numpy())
        m["monthly_median_ci_low"], m["monthly_median_ci_high"] = lo, hi
        m["months_above_38pct"] = int((monthly >= 0.38).sum())

    m.update(trade_metrics(trades))

    # part des coûts dans le PnL brut
    gross = m.get("gross_pnl", 0.0)
    costs = abs(m.get("fees", 0.0)) + abs(m.get("funding", 0.0)) + abs(m.get("slippage", 0.0))
    m["costs_total"] = costs
    m["costs_over_gross_pnl"] = float(costs / abs(gross)) if gross else float("nan")
    m["net_over_gross"] = float(m.get("net_pnl", 0.0) / gross) if gross else float("nan")

    if stats:
        m["exposure_ratio"] = stats.get("exposure_ratio", float("nan"))
        m["halted_ratio"] = stats.get("halted_ratio", float("nan"))
        m["rejections"] = stats.get("rejections", 0)
        m["engine_liquidations"] = stats.get("liquidations", 0)
        m["intrabar_resolved"] = stats.get("exec_resolved_intrabar", 0)
        m["intrabar_assumed"] = stats.get("exec_resolved_assumption", 0)
        m["order_rejects_exchange"] = stats.get("exec_rejected", 0)
        m["killed"] = bool(stats.get("killed", False))
        m["killed_at"] = stats.get("killed_at")
        m["first_halt_at"] = stats.get("first_halt_at")
        # Un kill switch arrête définitivement la stratégie : le reste de la
        # période est plat. Sans cette information, CAGR et Sharpe sont lus
        # comme une performance alors qu'ils décrivent surtout une equity gelée.
        if m["killed"] and m["killed_at"] and len(equity) > 1:
            killed_ts = pd.Timestamp(m["killed_at"])
            total_days = (equity.index[-1] - equity.index[0]).total_seconds() / 86400
            active_days = (killed_ts - equity.index[0]).total_seconds() / 86400
            m["days_before_kill_switch"] = float(active_days)
            m["active_share_of_period"] = float(active_days / total_days) if total_days > 0 else float("nan")

    if benchmark_equity is not None and len(benchmark_equity) > 1:
        bench_monthly = monthly_returns(benchmark_equity.dropna())
        joined = pd.concat([monthly.rename("strat"), bench_monthly.rename("bench")], axis=1).dropna()
        if len(joined):
            m["months_beating_benchmark"] = float((joined["strat"] > joined["bench"]).mean())
        m["benchmark_cagr"] = cagr(benchmark_equity.dropna(), days_per_year)
        m["benchmark_sharpe"] = sharpe(to_returns(benchmark_equity.dropna(), "D"), periods_per_year=days_per_year)
        m["benchmark_max_drawdown"] = max_drawdown(benchmark_equity.dropna())
        m["excess_cagr"] = m["cagr"] - m["benchmark_cagr"]

    return PerformanceReport(
        name=name, metrics=m, monthly=monthly_table(equity),
        equity=equity, drawdown=drawdown_series(equity),
    )


def bootstrap_median_ci(values: np.ndarray, n_boot: int = 5000, level: float = 0.95, seed: int = 7):
    """Intervalle de confiance bootstrap de la médiane (rendement mensuel)."""
    if len(values) < 3:
        return float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    medians = np.median(rng.choice(values, size=(n_boot, len(values)), replace=True), axis=1)
    alpha = (1 - level) / 2
    return float(np.quantile(medians, alpha)), float(np.quantile(medians, 1 - alpha))


def summarize_by(trades: pd.DataFrame, column: str) -> pd.DataFrame:
    """Décomposition des trades par régime, par symbole, etc. (§8.8)."""
    if trades is None or trades.empty or column not in trades:
        return pd.DataFrame()
    rows = []
    for key, block in trades.groupby(column):
        stats = trade_metrics(block)
        stats[column] = key
        rows.append(stats)
    out = pd.DataFrame(rows)
    cols = [column] + [c for c in out.columns if c != column]
    return out[cols].sort_values("trades", ascending=False)
