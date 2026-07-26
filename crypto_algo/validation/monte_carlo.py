"""Monte Carlo sur l'ordre des trades (§8.4).

10 000 rééchantillonnages -> distribution du max drawdown, du CAGR et
**probabilité de ruine**.

Deux méthodes, volontairement distinctes :

* ``shuffle``   — on permute l'ordre des trades observés. Conserve exactement
  la distribution des gains/pertes, ne teste que la **séquence**. C'est la
  question « ai-je eu de la chance dans l'ordre d'arrivée ? ».
* ``bootstrap`` — tirage avec remise. Teste séquence **et** échantillonnage,
  mais suppose l'indépendance des trades ; en présence d'autocorrélation, il
  sous-estime les séquences de pertes. Un bootstrap par blocs est proposé
  (``block_size``) pour préserver une partie de la dépendance.

Le PnL des trades est appliqué en **relatif à l'equity** (le sizing est
proportionnel), sinon la simulation ne correspond pas à la mécanique réelle.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..utils import get_logger

log = get_logger("validation.monte_carlo")


@dataclass
class MonteCarloResult:
    method: str
    n_simulations: int
    ruin_threshold: float
    ruin_probability: float
    final_equity: np.ndarray = field(repr=False, default_factory=lambda: np.array([]))
    max_drawdowns: np.ndarray = field(repr=False, default_factory=lambda: np.array([]))
    cagrs: np.ndarray = field(repr=False, default_factory=lambda: np.array([]))
    quantiles: dict[str, dict[str, float]] = field(default_factory=dict)
    observed: dict[str, float] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        out = {
            "method": self.method,
            "simulations": self.n_simulations,
            "ruin_threshold": self.ruin_threshold,
            "ruin_probability": self.ruin_probability,
        }
        for metric, qs in self.quantiles.items():
            for q, value in qs.items():
                out[f"{metric}_{q}"] = value
        for k, v in self.observed.items():
            out[f"observed_{k}"] = v
        return out

    def to_frame(self) -> pd.DataFrame:
        return pd.DataFrame([self.summary()])


def _simulate_paths(
    r_relative: np.ndarray,
    n_simulations: int,
    method: str,
    rng: np.random.Generator,
    block_size: int = 1,
) -> np.ndarray:
    """Renvoie une matrice (n_simulations, n_trades+1) de courbes d'equity relatives."""
    n = len(r_relative)
    if method == "shuffle":
        idx = np.argsort(rng.random((n_simulations, n)), axis=1)
    elif method in ("bootstrap", "bootstrap_trades"):
        idx = rng.integers(0, n, size=(n_simulations, n))
    elif method == "block_bootstrap":
        n_blocks = int(np.ceil(n / block_size))
        starts = rng.integers(0, max(1, n - block_size + 1), size=(n_simulations, n_blocks))
        offsets = np.arange(block_size)
        idx = (starts[:, :, None] + offsets[None, None, :]).reshape(n_simulations, -1)[:, :n]
        idx = np.clip(idx, 0, n - 1)
    else:
        raise ValueError(f"méthode Monte Carlo inconnue : {method!r}")

    draws = r_relative[idx]
    growth = np.cumprod(1.0 + draws, axis=1)
    return np.hstack([np.ones((n_simulations, 1)), growth])


def run_monte_carlo(
    trades: pd.DataFrame,
    equity: pd.Series | None = None,
    n_simulations: int = 10_000,
    method: str = "bootstrap_trades",
    ruin_threshold: float = -0.60,
    seed: int = 12345,
    days_per_year: int = 365,
    block_size: int = 10,
) -> MonteCarloResult:
    if trades is None or trades.empty:
        return MonteCarloResult(method=method, n_simulations=0, ruin_threshold=ruin_threshold,
                                ruin_probability=float("nan"))

    # PnL relatif : chaque trade est ramené à l'equity qu'il avait à sa clôture
    equity_after = trades["equity_after"].to_numpy(float)
    net = trades["net_pnl"].to_numpy(float)
    equity_before = equity_after - net
    with np.errstate(divide="ignore", invalid="ignore"):
        r_rel = np.where(equity_before > 0, net / equity_before, 0.0)
    r_rel = np.clip(np.nan_to_num(r_rel), -0.999, 10.0)

    rng = np.random.default_rng(seed)
    paths = _simulate_paths(r_rel, n_simulations, method, rng, block_size)

    running_max = np.maximum.accumulate(paths, axis=1)
    drawdowns = paths / running_max - 1.0
    max_dd = drawdowns.min(axis=1)
    final = paths[:, -1]

    # durée réelle de l'échantillon, pour annualiser correctement
    if equity is not None and len(equity) > 1:
        years = (equity.index[-1] - equity.index[0]).total_seconds() / (86400 * days_per_year)
    else:
        span = pd.to_datetime(trades["closed_at"]).max() - pd.to_datetime(trades["opened_at"]).min()
        years = span.total_seconds() / (86400 * days_per_year)
    years = max(years, 1e-9)
    cagrs = np.where(final > 0, final ** (1.0 / years) - 1.0, -1.0)

    ruin = float((max_dd <= ruin_threshold).mean())

    def q(arr):
        return {f"p{int(p * 100):02d}": float(np.quantile(arr, p)) for p in (0.01, 0.05, 0.25, 0.50, 0.75, 0.95, 0.99)}

    observed = {}
    if equity is not None and len(equity) > 1:
        from ..reports.metrics import cagr as cagr_fn, max_drawdown

        observed = {
            "max_drawdown": max_drawdown(equity),
            "cagr": cagr_fn(equity, days_per_year),
            "final_multiple": float(equity.iloc[-1] / equity.iloc[0]),
        }

    log.info(
        "Monte Carlo (%s, n=%d) : P(ruine <= %.0f%%) = %.2f%%, DD médian %.1f%%",
        method, n_simulations, ruin_threshold * 100, ruin * 100, np.median(max_dd) * 100,
    )
    return MonteCarloResult(
        method=method, n_simulations=n_simulations, ruin_threshold=ruin_threshold,
        ruin_probability=ruin, final_equity=final, max_drawdowns=max_dd, cagrs=cagrs,
        quantiles={"max_drawdown": q(max_dd), "cagr": q(cagrs), "final_multiple": q(final)},
        observed=observed,
    )


def ruin_probability_by_risk(
    trades_by_risk: dict[float, pd.DataFrame],
    n_simulations: int = 10_000,
    ruin_threshold: float = -0.60,
    seed: int = 12345,
) -> pd.DataFrame:
    """Étude §6.1 : couple rendement / probabilité de ruine selon risk_per_trade."""
    rows = []
    for risk, trades in sorted(trades_by_risk.items()):
        mc = run_monte_carlo(trades, n_simulations=n_simulations,
                             ruin_threshold=ruin_threshold, seed=seed)
        rows.append(
            {
                "risk_per_trade": risk,
                "mc_trades": 0 if trades is None or trades.empty else len(trades),
                "ruin_probability": mc.ruin_probability,
                "median_cagr": mc.quantiles.get("cagr", {}).get("p50", float("nan")),
                "p05_cagr": mc.quantiles.get("cagr", {}).get("p05", float("nan")),
                "median_max_dd": mc.quantiles.get("max_drawdown", {}).get("p50", float("nan")),
                "p05_max_dd": mc.quantiles.get("max_drawdown", {}).get("p05", float("nan")),
            }
        )
    return pd.DataFrame(rows)
