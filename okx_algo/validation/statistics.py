"""Protocole statistique de validation (§11).

Contient : Deflated Sharpe Ratio penalise par le nombre d'essais reellement
consommes, Monte Carlo sur l'ordre des trades, Monte Carlo par bootstrap par
blocs pour le drawdown mensuel, decoupages walk-forward ancre et glissant,
purged k-fold avec embargo.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats

EULER = 0.5772156649015329
HOURS_PER_YEAR = 24 * 365


# ----------------------------------------------------------------------
# Deflated Sharpe Ratio (Bailey & Lopez de Prado)
# ----------------------------------------------------------------------
def expected_max_sharpe(n_trials: int, sharpe_variance: float) -> float:
    """Sharpe maximal attendu SOUS L'HYPOTHESE NULLE apres n_trials essais.

    C'est le coeur de la penalite : chercher longtemps produit un beau Sharpe
    meme sur du bruit pur. Cette valeur est la barre a franchir.
    """
    if n_trials < 2 or sharpe_variance <= 0:
        return 0.0
    n = float(n_trials)
    z1 = stats.norm.ppf(1.0 - 1.0 / n)
    z2 = stats.norm.ppf(1.0 - 1.0 / (n * np.e))
    return float(np.sqrt(sharpe_variance) * ((1.0 - EULER) * z1 + EULER * z2))


def deflated_sharpe(returns: pd.Series, n_trials: int,
                    trial_sharpes: list[float] | None = None,
                    periods_per_year: int = HOURS_PER_YEAR) -> dict:
    """DSR et p-value. Le Sharpe est manipule en unites par observation."""
    r = pd.Series(returns).dropna().to_numpy(dtype=float)
    n = len(r)
    if n < 30 or r.std(ddof=1) == 0:
        return {"sharpe_annualized": np.nan, "dsr": np.nan, "p_value": np.nan,
                "sr0_annualized": np.nan, "n_trials": n_trials, "n_obs": n,
                "significant": False}

    sr = float(r.mean() / r.std(ddof=1))          # par observation
    skew = float(stats.skew(r))
    kurt = float(stats.kurtosis(r, fisher=False))

    # variance des Sharpe entre essais : mesuree si disponible, sinon estimee
    if trial_sharpes and len(trial_sharpes) >= 3:
        s = np.array(trial_sharpes, dtype=float) / np.sqrt(periods_per_year)
        var_sr = float(np.var(s, ddof=1))
        var_source = "mesuree_sur_les_essais"
    else:
        var_sr = (1.0 + 0.5 * sr ** 2) / n
        var_source = "estimee_analytiquement"

    sr0 = expected_max_sharpe(n_trials, var_sr)
    denom = 1.0 - skew * sr + (kurt - 1.0) / 4.0 * sr ** 2
    if denom <= 0:
        return {"sharpe_annualized": sr * np.sqrt(periods_per_year), "dsr": np.nan,
                "p_value": np.nan, "sr0_annualized": sr0 * np.sqrt(periods_per_year),
                "n_trials": n_trials, "n_obs": n, "significant": False,
                "note": "denominateur non defini (moments extremes)"}

    z = (sr - sr0) * np.sqrt(n - 1) / np.sqrt(denom)
    dsr = float(stats.norm.cdf(z))
    return {
        "sharpe_annualized": float(sr * np.sqrt(periods_per_year)),
        "sr0_annualized": float(sr0 * np.sqrt(periods_per_year)),
        "dsr": dsr,
        "p_value": float(1.0 - dsr),
        "n_trials": int(n_trials),
        "n_obs": int(n),
        "skew": skew,
        "kurtosis": kurt,
        "sharpe_variance_source": var_source,
        "significant": bool(dsr > 0.95),
    }


# ----------------------------------------------------------------------
# Monte Carlo
# ----------------------------------------------------------------------
@dataclass
class MonteCarloResult:
    max_drawdowns: np.ndarray
    total_returns: np.ndarray
    ruin_probability: float
    summary: dict


def monte_carlo_trade_order(trade_pnl: np.ndarray, initial_equity: float,
                            n_draws: int, ruin_threshold: float = -0.5,
                            seed: int = 0) -> MonteCarloResult:
    """Reechantillonne l'ORDRE des trades (§11.4).

    Le PnL total est invariant par permutation ; ce qui change est le chemin,
    donc le drawdown. C'est exactement la question posee : quelle sequence de
    pertes la strategie aurait-elle pu subir ?
    """
    pnl = np.asarray(trade_pnl, dtype=float)
    pnl = pnl[np.isfinite(pnl)]
    if len(pnl) < 5:
        return MonteCarloResult(np.array([]), np.array([]), np.nan,
                                {"status": "trop_peu_de_trades", "n": int(len(pnl))})
    rng = np.random.default_rng(seed)
    n = len(pnl)
    # Le produit tirages x trades peut depasser le milliard d'elements : on
    # traite par lots pour borner la memoire a quelques dizaines de Mo.
    chunk = max(1, min(n_draws, int(4e6 // max(n, 1))))
    max_dd = np.empty(n_draws)
    total_ret = np.empty(n_draws)
    done = 0
    while done < n_draws:
        m = min(chunk, n_draws - done)
        idx = rng.permuted(np.tile(np.arange(n), (m, 1)), axis=1)
        paths = initial_equity + np.cumsum(pnl[idx], axis=1)
        paths = np.column_stack([np.full(m, initial_equity), paths])
        running_max = np.maximum.accumulate(paths, axis=1)
        with np.errstate(divide="ignore", invalid="ignore"):
            dd = paths / running_max - 1.0
        max_dd[done:done + m] = dd.min(axis=1)
        total_ret[done:done + m] = paths[:, -1] / initial_equity - 1.0
        done += m
    ruin = float((max_dd <= ruin_threshold).mean())
    return MonteCarloResult(
        max_dd, total_ret, ruin,
        {"n_trades": n, "n_draws": n_draws,
         "max_dd_median": float(np.median(max_dd)),
         "max_dd_p95": float(np.quantile(max_dd, 0.05)),
         "max_dd_worst": float(max_dd.min()),
         "total_return_median": float(np.median(total_ret)),
         "total_return_p05": float(np.quantile(total_ret, 0.05)),
         "prob_negative": float((total_ret < 0).mean()),
         "ruin_probability": ruin,
         "ruin_threshold": ruin_threshold})


def bars_per_hour(returns: pd.Series, default: float = 1.0) -> float:
    """Deduit la resolution de la serie a partir de son index temporel.

    Indispensable : sur une grille 15 minutes, supposer des barres horaires
    ferait mesurer le drawdown « mensuel » sur 7,6 jours, ce qui le
    sous-estimerait massivement et gonflerait d'autant le levier juge
    compatible avec la limite de risque.
    """
    idx = getattr(returns, "index", None)
    if isinstance(idx, pd.DatetimeIndex) and len(idx) > 2:
        delta = pd.Series(idx).diff().median()
        if pd.notna(delta) and delta.total_seconds() > 0:
            return 3600.0 / delta.total_seconds()
    return default


def monthly_drawdown_distribution(returns: pd.Series, n_draws: int,
                                  block_hours: int = 24, seed: int = 0) -> dict:
    """Distribution du drawdown MENSUEL par bootstrap par blocs.

    Le bootstrap par blocs conserve l'autocorrelation intra-journaliere des
    rendements ; un bootstrap i.i.d. sous-estimerait gravement le drawdown.
    Fournit DD_p95 pour l'etape 2 du module de levier (§8).
    """
    bph = bars_per_hour(returns)
    r = pd.Series(returns).dropna().to_numpy(dtype=float)
    block = max(2, int(round(block_hours * bph)))
    bars_month = max(block * 2, int(round(730 * bph)))
    if len(r) < block * 10 or len(r) <= block + 1:
        return {"status": "historique_insuffisant", "n_obs": int(len(r))}
    rng = np.random.default_rng(seed)
    n_blocks = int(np.ceil(bars_month / block))
    starts = rng.integers(0, len(r) - block, size=(n_draws, n_blocks))
    offsets = np.arange(block)
    paths = r[(starts[:, :, None] + offsets[None, None, :])].reshape(n_draws, -1)
    paths = paths[:, :bars_month]

    equity = np.cumprod(1.0 + paths, axis=1)
    running_max = np.maximum.accumulate(
        np.column_stack([np.ones(n_draws), equity]), axis=1)
    dd = np.column_stack([np.ones(n_draws), equity]) / running_max - 1.0
    month_dd = dd.min(axis=1)
    month_ret = equity[:, -1] - 1.0
    return {
        "status": "ok",
        "n_draws": n_draws,
        "block_hours": block_hours,
        "bars_per_month": int(bars_month),
        "monthly_dd_median": float(np.median(month_dd)),
        "monthly_dd_p95": float(np.quantile(month_dd, 0.05)),   # 95e percentile de perte
        "monthly_dd_p99": float(np.quantile(month_dd, 0.01)),
        "monthly_dd_worst": float(month_dd.min()),
        "monthly_return_median": float(np.median(month_ret)),
        "monthly_return_p05": float(np.quantile(month_ret, 0.05)),
        "monthly_return_p95": float(np.quantile(month_ret, 0.95)),
        "prob_month_negative": float((month_ret < 0).mean()),
    }


# ----------------------------------------------------------------------
# Decoupages temporels
# ----------------------------------------------------------------------
def walk_forward_splits(index: pd.DatetimeIndex, train_months: int, test_months: int,
                        mode: str = "anchored") -> list[dict]:
    """Fenetres train/test successives. `anchored` etend le train, `rolling` le fait glisser."""
    out = []
    start = index[0]
    end = index[-1]
    train_end = start + pd.DateOffset(months=train_months)
    while train_end + pd.DateOffset(months=test_months) <= end:
        test_end = train_end + pd.DateOffset(months=test_months)
        train_start = start if mode == "anchored" else train_end - pd.DateOffset(months=train_months)
        out.append({
            "train_start": train_start, "train_end": train_end,
            "test_start": train_end, "test_end": test_end,
            "mode": mode,
        })
        train_end = test_end
    return out


def purged_kfold_splits(index: pd.DatetimeIndex, n_splits: int,
                        embargo_days: int) -> list[dict]:
    """K-fold purge avec embargo : evite la fuite par chevauchement de features.

    Les barres du train situees a moins de `embargo_days` d'une borne du test
    sont retirees. Sans cela, une feature calculee sur 168h ferait fuiter de
    l'information du test vers le train.
    """
    n = len(index)
    bounds = np.linspace(0, n, n_splits + 1).astype(int)
    embargo = pd.Timedelta(days=embargo_days)
    out = []
    for k in range(n_splits):
        t0, t1 = bounds[k], bounds[k + 1]
        test_start, test_end = index[t0], index[min(t1, n - 1)]
        keep = ((index < test_start - embargo) | (index > test_end + embargo))
        out.append({
            "fold": k,
            "test_start": test_start, "test_end": test_end,
            "train_mask": keep,
            "n_train": int(keep.sum()), "n_test": int(t1 - t0),
        })
    return out


# ----------------------------------------------------------------------
def sharpe_degradation(is_sharpe: float, oos_sharpe: float) -> float:
    """Degradation relative IS -> OOS. Positive = deterioration."""
    if not np.isfinite(is_sharpe) or abs(is_sharpe) < 1e-9:
        return np.nan
    return float((is_sharpe - oos_sharpe) / abs(is_sharpe))


def market_regimes(btc_close: pd.Series, window_days: int = 30) -> pd.Series:
    """Regimes haussier / baissier / range, definis sur BTC.

    Definition volontairement simple et non optimisee : la tendance 30 jours
    rapportee a la volatilite 30 jours. Un decoupage sophistique serait lui-meme
    un parametre a surajuster.
    """
    w = max(2, int(round(window_days * 24 * bars_per_hour(btc_close))))
    ret = np.log(btc_close / btc_close.shift(w))
    vol = np.log(btc_close / btc_close.shift(1)).rolling(w).std() * np.sqrt(w)
    z = (ret / vol).replace([np.inf, -np.inf], np.nan)
    regime = pd.Series("range", index=btc_close.index, dtype=object)
    regime[z > 0.5] = "haussier"
    regime[z < -0.5] = "baissier"
    regime[z.isna()] = None
    return regime
