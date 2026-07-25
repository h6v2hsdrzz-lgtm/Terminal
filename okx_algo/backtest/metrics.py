"""Metriques de performance (§12).

Convention : toutes les series de rendement sont horaires (grille du moteur).
L'annualisation utilise 24 x 365 barres. Les rendements mensuels sont calcules
par composition sur mois calendaires UTC.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

HOURS_PER_YEAR = 24 * 365


def monthly_returns(equity: pd.Series) -> pd.Series:
    m = equity.resample("MS").last()
    first = equity.iloc[0]
    prev = pd.concat([pd.Series([first], index=[m.index[0] - pd.offsets.MonthBegin(1)]), m])
    r = m.to_numpy() / prev.to_numpy()[:-1] - 1.0
    return pd.Series(r, index=m.index, name="monthly_return")


def sharpe(returns: pd.Series, periods_per_year: int = HOURS_PER_YEAR) -> float:
    r = returns.dropna()
    if len(r) < 2 or r.std(ddof=1) == 0:
        return 0.0
    return float(r.mean() / r.std(ddof=1) * np.sqrt(periods_per_year))


def sortino(returns: pd.Series, periods_per_year: int = HOURS_PER_YEAR) -> float:
    r = returns.dropna()
    downside = r[r < 0]
    if len(downside) < 2 or downside.std(ddof=1) == 0:
        return 0.0
    return float(r.mean() / downside.std(ddof=1) * np.sqrt(periods_per_year))


def max_drawdown(equity: pd.Series) -> tuple[float, int, pd.Timestamp | None]:
    hwm = equity.cummax()
    dd = equity / hwm - 1.0
    trough = dd.idxmin() if len(dd) else None
    mdd = float(dd.min()) if len(dd) else 0.0
    underwater = (dd < -1e-12).astype(int)
    longest, cur = 0, 0
    for v in underwater.to_numpy():
        cur = cur + 1 if v else 0
        longest = max(longest, cur)
    return mdd, longest, trough


def underwater(equity: pd.Series) -> pd.Series:
    return equity / equity.cummax() - 1.0


def cagr(equity: pd.Series) -> float:
    if len(equity) < 2 or equity.iloc[0] <= 0:
        return 0.0
    years = (equity.index[-1] - equity.index[0]).total_seconds() / (365.25 * 24 * 3600)
    if years <= 0:
        return 0.0
    ratio = equity.iloc[-1] / equity.iloc[0]
    if ratio <= 0:
        return -1.0
    return float(ratio ** (1.0 / years) - 1.0)


def median_ci(values: np.ndarray, alpha: float = 0.05, draws: int = 10000,
              rng: np.random.Generator | None = None) -> tuple[float, float, float]:
    """Mediane et intervalle de confiance a 95 % par bootstrap."""
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    if len(v) == 0:
        return np.nan, np.nan, np.nan
    if len(v) < 3:
        return float(np.median(v)), float(np.min(v)), float(np.max(v))
    rng = rng or np.random.default_rng(0)
    boot = np.median(rng.choice(v, size=(draws, len(v)), replace=True), axis=1)
    return (float(np.median(v)), float(np.quantile(boot, alpha / 2)),
            float(np.quantile(boot, 1 - alpha / 2)))


def var_cvar(returns: pd.Series, level: float) -> tuple[float, float]:
    r = returns.dropna().to_numpy()
    if len(r) == 0:
        return 0.0, 0.0
    q = float(np.quantile(r, 1 - level))
    tail = r[r <= q]
    return q, float(tail.mean()) if len(tail) else q


def trade_stats(trades: pd.DataFrame) -> dict:
    if trades is None or not len(trades):
        return {"n_trades": 0, "win_rate": np.nan, "profit_factor": np.nan,
                "expectancy_r": np.nan, "avg_bars_held": np.nan,
                "n_long": 0, "n_short": 0}
    net = trades["net_pnl"]
    wins = net[net > 0]
    losses = net[net <= 0]
    pf = wins.sum() / abs(losses.sum()) if abs(losses.sum()) > 0 else np.inf
    return {
        "n_trades": int(len(trades)),
        "win_rate": float((net > 0).mean()),
        "profit_factor": float(pf),
        "expectancy_r": float(trades["r_multiple"].replace([np.inf, -np.inf], np.nan).mean()),
        "avg_bars_held": float(trades["bars_held"].mean()),
        "n_long": int((trades["direction"] > 0).sum()),
        "n_short": int((trades["direction"] < 0).sum()),
        "avg_win": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss": float(losses.mean()) if len(losses) else 0.0,
    }


def summarize(result, benchmark_monthly: pd.Series | None = None,
              rng: np.random.Generator | None = None) -> dict:
    eq = result.equity
    rets = result.returns
    mr = monthly_returns(eq)
    med, lo, hi = median_ci(mr.to_numpy(), rng=rng)
    mdd, dd_len, dd_at = max_drawdown(eq)
    ann = cagr(eq)
    s = result.stats

    gross_pnl = (result.trades["gross_pnl"].sum()
                 if result.trades is not None and len(result.trades) else np.nan)
    fees = s.get("fees_total", 0.0)
    funding = s.get("funding_total", 0.0)
    cost_ratio = ((fees + abs(funding)) / abs(gross_pnl)
                  if gross_pnl and np.isfinite(gross_pnl) and gross_pnl != 0 else np.nan)

    out = {
        "cagr": ann,
        "monthly_return_mean": float(mr.mean()) if len(mr) else np.nan,
        "monthly_return_median": med,
        "monthly_return_ci95_low": lo,
        "monthly_return_ci95_high": hi,
        "monthly_return_std": float(mr.std(ddof=1)) if len(mr) > 1 else np.nan,
        "pct_months_positive": float((mr > 0).mean()) if len(mr) else np.nan,
        "sharpe": sharpe(rets),
        "sortino": sortino(rets),
        "max_drawdown": mdd,
        "max_drawdown_hours": dd_len,
        "calmar": (ann / abs(mdd)) if mdd < 0 else np.nan,
        "var95": var_cvar(rets, 0.95)[0],
        "cvar95": var_cvar(rets, 0.95)[1],
        "var99": var_cvar(rets, 0.99)[0],
        "cvar99": var_cvar(rets, 0.99)[1],
        "gross_pnl": float(gross_pnl) if np.isfinite(gross_pnl) else np.nan,
        "net_pnl": float(eq.iloc[-1] - s.get("initial_equity", eq.iloc[0])),
        "fees_total": float(fees),
        "funding_total": float(funding),
        "costs_pct_of_gross_pnl": float(cost_ratio) if np.isfinite(cost_ratio) else np.nan,
        "n_months": int(len(mr)),
    }
    out.update(trade_stats(result.trades))
    out.update({k: s[k] for k in ("n_liquidations", "maker_fill_rate", "maker_attempts",
                                  "mean_gross_leverage", "max_gross_leverage",
                                  "leverage_applied", "killed", "n_netting_events")
                if k in s})
    if benchmark_monthly is not None and len(mr):
        aligned = benchmark_monthly.reindex(mr.index)
        both = pd.concat([mr, aligned], axis=1).dropna()
        out["pct_months_beating_benchmark"] = (float((both.iloc[:, 0] > both.iloc[:, 1]).mean())
                                               if len(both) else np.nan)
    return out


def alpha_beta(returns: pd.Series, benchmark_returns: pd.Series) -> dict:
    """Regression du PnL sur BTC : distingue l'alpha du beta amplifie (§11.10)."""
    both = pd.concat([returns.rename("r"), benchmark_returns.rename("b")], axis=1).dropna()
    if len(both) < 30:
        return {"alpha_annualized": np.nan, "beta": np.nan, "r_squared": np.nan,
                "alpha_tstat": np.nan, "n_obs": len(both)}
    x = both["b"].to_numpy()
    y = both["r"].to_numpy()
    X = np.column_stack([np.ones_like(x), x])
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ coef
    dof = max(len(y) - 2, 1)
    sigma2 = float(resid @ resid / dof)
    xtx_inv = np.linalg.inv(X.T @ X)
    se_alpha = float(np.sqrt(sigma2 * xtx_inv[0, 0]))
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return {
        "alpha_annualized": float(coef[0] * HOURS_PER_YEAR),
        "beta": float(coef[1]),
        "r_squared": float(1 - (resid @ resid) / ss_tot) if ss_tot > 0 else np.nan,
        "alpha_tstat": float(coef[0] / se_alpha) if se_alpha > 0 else np.nan,
        "n_obs": int(len(both)),
    }


def regime_breakdown(equity: pd.Series, regimes: pd.Series) -> pd.DataFrame:
    """Performance par regime de marche (haussier / baissier / range)."""
    rets = equity.pct_change().fillna(0.0)
    df = pd.concat([rets.rename("r"), regimes.rename("regime")], axis=1).dropna()
    rows = []
    for name, grp in df.groupby("regime"):
        if len(grp) < 24:
            continue
        cum = float((1 + grp["r"]).prod() - 1)
        rows.append({
            "regime": name,
            "hours": len(grp),
            "total_return": cum,
            "sharpe": sharpe(grp["r"]),
            "annualized": float((1 + cum) ** (HOURS_PER_YEAR / len(grp)) - 1) if len(grp) else np.nan,
        })
    return pd.DataFrame(rows)
