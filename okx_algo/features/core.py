"""Features vectorisees. Regle absolue : tout est decale d'une barre.

Chaque fonction publique retourne une serie utilisable a la cloture de la barre
courante. Le decalage explicite (`lag`) est applique par `shift1`, jamais
implicitement, pour qu'un test de lookahead puisse le verifier.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def shift1(a: np.ndarray, fill: float = np.nan) -> np.ndarray:
    """Decale d'une barre : la valeur en t n'utilise que l'information <= t-1."""
    out = np.empty_like(a, dtype=float)
    if a.ndim == 1:
        out[0] = fill
        out[1:] = a[:-1]
    else:
        out[0, :] = fill
        out[1:, :] = a[:-1, :]
    return out


def log_return(close: np.ndarray, periods: int) -> np.ndarray:
    out = np.full_like(close, np.nan, dtype=float)
    if periods < len(close):
        with np.errstate(divide="ignore", invalid="ignore"):
            out[periods:] = np.log(close[periods:] / close[:-periods])
    return out


def ewma_vol(returns: np.ndarray, halflife_bars: float) -> np.ndarray:
    """Volatilite EWMA par barre (ecart-type), initialisee sans lookahead."""
    s = pd.Series(returns)
    var = s.pow(2).ewm(halflife=halflife_bars, min_periods=max(5, int(halflife_bars // 2))).mean()
    return np.sqrt(var.to_numpy())


def realized_vol(returns: np.ndarray, window_bars: int) -> np.ndarray:
    return pd.Series(returns).rolling(window_bars, min_periods=window_bars // 2).std().to_numpy()


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, window: int) -> np.ndarray:
    """ATR de Wilder, en unites de prix."""
    prev_close = np.concatenate([[np.nan], close[:-1]])
    tr = np.nanmax(np.column_stack([
        high - low,
        np.abs(high - prev_close),
        np.abs(low - prev_close),
    ]), axis=1)
    return pd.Series(tr).ewm(alpha=1.0 / window, min_periods=window).mean().to_numpy()


def rolling_median(a: np.ndarray, window: int, min_periods: int | None = None) -> np.ndarray:
    return pd.Series(a).rolling(window, min_periods=min_periods or window // 2).median().to_numpy()


def rolling_mean(a: np.ndarray, window: int, min_periods: int | None = None) -> np.ndarray:
    return pd.Series(a).rolling(window, min_periods=min_periods or window // 2).mean().to_numpy()


def rolling_std(a: np.ndarray, window: int, min_periods: int | None = None) -> np.ndarray:
    return pd.Series(a).rolling(window, min_periods=min_periods or window // 2).std().to_numpy()


def zscore(a: np.ndarray, window: int) -> np.ndarray:
    m = rolling_mean(a, window)
    s = rolling_std(a, window)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(s > 0, (a - m) / s, 0.0)


def cross_sectional_zscore(matrix: np.ndarray) -> np.ndarray:
    """z-score en coupe (par ligne), robuste aux NaN d'actifs non cotes."""
    mu = np.nanmean(matrix, axis=1, keepdims=True)
    sd = np.nanstd(matrix, axis=1, ddof=0, keepdims=True)
    with np.errstate(divide="ignore", invalid="ignore"):
        z = np.where(sd > 0, (matrix - mu) / sd, 0.0)
    return np.where(np.isfinite(z), z, 0.0)


def annualisation_factor(bars_per_year: float) -> float:
    return float(np.sqrt(bars_per_year))


BARS_PER_YEAR = {"1m": 365 * 24 * 60, "15m": 365 * 24 * 4, "1H": 365 * 24,
                 "4H": 365 * 6, "1D": 365}
