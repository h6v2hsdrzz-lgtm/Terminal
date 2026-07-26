"""Indicateurs techniques — tous **causaux**.

Règle absolue : une valeur d'indicateur à l'indice ``t`` n'utilise que les
barres ``<= t``. Aucune fonction de ce module ne doit centrer une fenêtre, ni
utiliser ``shift(-n)``, ni un ``rolling(...).apply`` sur des données futures.
Le décalage d'une barre supplémentaire (features connues seulement à la
clôture) est appliqué en aval, dans ``features.pipeline``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..utils import safe_div


# ---------------------------------------------------------------- moyennes
def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def wilder_ema(series: pd.Series, period: int) -> pd.Series:
    """Lissage de Wilder (RSI, ATR, ADX)."""
    return series.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def slope(series: pd.Series, lookback: int) -> pd.Series:
    """Pente relative sur ``lookback`` barres (variation en % par barre)."""
    return (series / series.shift(lookback) - 1.0) / lookback


# ------------------------------------------------------------ volatilité
def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    return wilder_ema(true_range(df), period)


def atr_pct(df: pd.DataFrame, period: int = 14) -> pd.Series:
    return atr(df, period) / df["close"]


def bollinger(series: pd.Series, period: int = 20, k: float = 2.0) -> pd.DataFrame:
    mid = sma(series, period)
    sd = series.rolling(period, min_periods=period).std(ddof=0)
    return pd.DataFrame(
        {
            "bb_mid": mid,
            "bb_upper": mid + k * sd,
            "bb_lower": mid - k * sd,
            "bb_width": safe_div(2 * k * sd, mid),
        }
    )


def keltner(df: pd.DataFrame, period: int = 20, atr_mult: float = 1.5) -> pd.DataFrame:
    mid = ema(df["close"], period)
    a = atr(df, period)
    return pd.DataFrame(
        {
            "kc_mid": mid,
            "kc_upper": mid + atr_mult * a,
            "kc_lower": mid - atr_mult * a,
            "kc_width": safe_div(2 * atr_mult * a, mid),
        }
    )


def choppiness(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Choppiness Index : ~100 = range, ~0 = tendance."""
    tr_sum = true_range(df).rolling(period, min_periods=period).sum()
    hh = df["high"].rolling(period, min_periods=period).max()
    ll = df["low"].rolling(period, min_periods=period).min()
    rng = (hh - ll).replace(0.0, np.nan)
    return 100.0 * np.log10(tr_sum / rng) / np.log10(period)


# -------------------------------------------------------------- momentum
def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = wilder_ema(gain, period)
    avg_loss = wilder_ema(loss, period)
    rs = safe_div(avg_gain, avg_loss, default=np.inf)
    return 100.0 - 100.0 / (1.0 + rs)


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast = ema(series, fast)
    ema_slow = ema(series, slow)
    line = ema_fast - ema_slow
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    hist = line - sig
    return pd.DataFrame(
        {"macd": line, "macd_signal": sig, "macd_hist": hist, "macd_hist_slope": hist.diff()}
    )


def roc(series: pd.Series, period: int = 10) -> pd.Series:
    return series / series.shift(period) - 1.0


def stochastic(df: pd.DataFrame, period: int = 14, smooth: int = 3) -> pd.DataFrame:
    hh = df["high"].rolling(period, min_periods=period).max()
    ll = df["low"].rolling(period, min_periods=period).min()
    k = 100.0 * safe_div(df["close"] - ll, (hh - ll))
    d = k.rolling(smooth, min_periods=smooth).mean()
    return pd.DataFrame({"stoch_k": k, "stoch_d": d})


# ------------------------------------------------------------- tendance
def dmi_adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)
    tr = wilder_ema(true_range(df), period)
    plus_di = 100.0 * safe_div(wilder_ema(plus_dm, period), tr)
    minus_di = 100.0 * safe_div(wilder_ema(minus_dm, period), tr)
    dx = 100.0 * safe_div((plus_di - minus_di).abs(), (plus_di + minus_di))
    return pd.DataFrame(
        {"plus_di": plus_di, "minus_di": minus_di, "adx": wilder_ema(dx, period), "dx": dx}
    )


def supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> pd.DataFrame:
    """Supertrend classique (récursif, causal)."""
    a = atr(df, period).to_numpy(float)
    hl2 = ((df["high"] + df["low"]) / 2.0).to_numpy(float)
    close = df["close"].to_numpy(float)
    n = len(df)
    upper = hl2 + multiplier * a
    lower = hl2 - multiplier * a
    final_upper = np.full(n, np.nan)
    final_lower = np.full(n, np.nan)
    trend = np.full(n, np.nan)
    line = np.full(n, np.nan)

    for i in range(n):
        if not np.isfinite(upper[i]) or not np.isfinite(lower[i]):
            continue
        if i == 0 or not np.isfinite(final_upper[i - 1]):
            final_upper[i], final_lower[i] = upper[i], lower[i]
            trend[i] = 1.0 if close[i] >= final_lower[i] else -1.0
        else:
            final_upper[i] = (
                min(upper[i], final_upper[i - 1]) if close[i - 1] <= final_upper[i - 1] else upper[i]
            )
            final_lower[i] = (
                max(lower[i], final_lower[i - 1]) if close[i - 1] >= final_lower[i - 1] else lower[i]
            )
            if trend[i - 1] == 1.0:
                trend[i] = -1.0 if close[i] < final_lower[i] else 1.0
            else:
                trend[i] = 1.0 if close[i] > final_upper[i] else -1.0
        line[i] = final_lower[i] if trend[i] == 1.0 else final_upper[i]

    return pd.DataFrame({"st_trend": trend, "st_line": line}, index=df.index)


def swing_points(df: pd.DataFrame, lookback: int = 5) -> pd.DataFrame:
    """Swing highs/lows **confirmés** : un pivot en ``t-lookback`` n'est validé
    qu'à ``t``. Le décalage est donc explicitement appliqué (pas de lookahead).
    """
    high, low = df["high"], df["low"]
    roll_max = high.rolling(2 * lookback + 1, min_periods=2 * lookback + 1).max()
    roll_min = low.rolling(2 * lookback + 1, min_periods=2 * lookback + 1).min()
    is_high = high.shift(lookback) == roll_max
    is_low = low.shift(lookback) == roll_min
    swing_high = pd.Series(np.where(is_high, high.shift(lookback), np.nan), index=df.index).ffill()
    swing_low = pd.Series(np.where(is_low, low.shift(lookback), np.nan), index=df.index).ffill()
    prev_high = pd.Series(np.where(is_high, high.shift(lookback), np.nan), index=df.index).ffill().shift(1)
    prev_low = pd.Series(np.where(is_low, low.shift(lookback), np.nan), index=df.index).ffill().shift(1)
    return pd.DataFrame(
        {
            "swing_high": swing_high,
            "swing_low": swing_low,
            "prev_swing_high": prev_high,
            "prev_swing_low": prev_low,
            "higher_high": (swing_high > prev_high).astype(float),
            "lower_low": (swing_low < prev_low).astype(float),
        }
    )


# --------------------------------------------------------------- volume
def obv(df: pd.DataFrame) -> pd.Series:
    direction = np.sign(df["close"].diff().fillna(0.0))
    return (direction * df["volume"]).cumsum()


def relative_volume(df: pd.DataFrame, period: int = 20) -> pd.Series:
    return safe_div(df["volume"], df["volume"].rolling(period, min_periods=period).mean())


def anchored_vwap(df: pd.DataFrame, anchor: str = "day") -> pd.DataFrame:
    """VWAP ancré (session) + bandes de déviation standard pondérées volume."""
    freq = {"day": "D", "week": "7D"}.get(anchor, "D")
    group = df.index.floor(freq)
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    pv = typical * df["volume"]
    cum_pv = pv.groupby(group).cumsum()
    cum_v = df["volume"].groupby(group).cumsum()
    vwap = safe_div(cum_pv, cum_v)
    cum_pv2 = (typical.pow(2) * df["volume"]).groupby(group).cumsum()
    var = safe_div(cum_pv2, cum_v) - vwap.pow(2)
    sd = np.sqrt(var.clip(lower=0.0))
    return pd.DataFrame({"vwap": vwap, "vwap_sd": sd})


def volume_profile(
    df: pd.DataFrame, window: int = 500, bins: int = 50, value_area: float = 0.70, stride: int = 10
) -> pd.DataFrame:
    """POC / VAH / VAL sur fenêtre glissante (recalcul tous les ``stride`` barres)."""
    n = len(df)
    poc = np.full(n, np.nan)
    vah = np.full(n, np.nan)
    val = np.full(n, np.nan)
    close = df["close"].to_numpy(float)
    volume = df["volume"].to_numpy(float)
    for end in range(window, n + 1, stride):
        s = end - window
        prices = close[s:end]
        vols = volume[s:end]
        lo, hi = prices.min(), prices.max()
        if not np.isfinite(lo) or hi <= lo:
            continue
        edges = np.linspace(lo, hi, bins + 1)
        idx = np.clip(np.digitize(prices, edges) - 1, 0, bins - 1)
        hist = np.bincount(idx, weights=vols, minlength=bins)
        centers = (edges[:-1] + edges[1:]) / 2.0
        poc_bin = int(hist.argmax())
        total = hist.sum()
        if total <= 0:
            continue
        # zone de valeur : extension autour du POC jusqu'à `value_area` du volume
        lo_bin = hi_bin = poc_bin
        acc = hist[poc_bin]
        while acc < value_area * total and (lo_bin > 0 or hi_bin < bins - 1):
            left = hist[lo_bin - 1] if lo_bin > 0 else -1.0
            right = hist[hi_bin + 1] if hi_bin < bins - 1 else -1.0
            if right >= left:
                hi_bin += 1
                acc += max(right, 0.0)
            else:
                lo_bin -= 1
                acc += max(left, 0.0)
        stop = min(end + stride, n)
        poc[end - 1: stop] = centers[poc_bin]
        val[end - 1: stop] = centers[lo_bin]
        vah[end - 1: stop] = centers[hi_bin]
    return pd.DataFrame({"vp_poc": poc, "vp_vah": vah, "vp_val": val}, index=df.index)


# --------------------------------------------- supports / résistances
def sr_levels(
    df: pd.DataFrame, lookback: int = 300, tolerance_pct: float = 0.004, min_touches: int = 3,
    stride: int = 10,
) -> pd.DataFrame:
    """Bornes de range par clustering des touches (extrêmes de barres).

    Renvoie le support et la résistance actifs les plus proches du prix.
    """
    n = len(df)
    sup = np.full(n, np.nan)
    res = np.full(n, np.nan)
    highs = df["high"].to_numpy(float)
    lows = df["low"].to_numpy(float)
    closes = df["close"].to_numpy(float)
    for end in range(lookback, n + 1, stride):
        s = end - lookback
        price = closes[end - 1]
        tol = price * tolerance_pct
        window_h = highs[s:end]
        window_l = lows[s:end]
        # clustering simple : arrondi sur une grille de tolérance
        for arr, out, side in ((window_h, res, "res"), (window_l, sup, "sup")):
            if tol <= 0:
                continue
            keys = np.round(arr / tol).astype(np.int64)
            uniq, counts = np.unique(keys, return_counts=True)
            valid = uniq[counts >= min_touches]
            if valid.size == 0:
                continue
            levels = valid * tol
            if side == "res":
                above = levels[levels > price]
                if above.size:
                    out[end - 1: min(end + stride, n)] = above.min()
            else:
                below = levels[levels < price]
                if below.size:
                    out[end - 1: min(end + stride, n)] = below.max()
    return pd.DataFrame({"support": sup, "resistance": res}, index=df.index)


# ------------------------------------------------------------ divergences
def divergence(
    price: pd.Series, oscillator: pd.Series, lookback: int = 40
) -> pd.DataFrame:
    """Divergences régulières et cachées, en comparant le point courant au
    dernier extrême de la fenêtre **passée** (hors barre courante).
    """
    prev_price_max = price.shift(1).rolling(lookback, min_periods=lookback // 2).max()
    prev_price_min = price.shift(1).rolling(lookback, min_periods=lookback // 2).min()
    prev_osc_max = oscillator.shift(1).rolling(lookback, min_periods=lookback // 2).max()
    prev_osc_min = oscillator.shift(1).rolling(lookback, min_periods=lookback // 2).min()

    regular_bear = (price >= prev_price_max) & (oscillator < prev_osc_max)
    regular_bull = (price <= prev_price_min) & (oscillator > prev_osc_min)
    hidden_bear = (price < prev_price_max) & (oscillator >= prev_osc_max)
    hidden_bull = (price > prev_price_min) & (oscillator <= prev_osc_min)
    return pd.DataFrame(
        {
            "div_regular_bear": regular_bear.astype(float),
            "div_regular_bull": regular_bull.astype(float),
            "div_hidden_bear": hidden_bear.astype(float),
            "div_hidden_bull": hidden_bull.astype(float),
        }
    )


# ------------------------------------------------------------- corrélation
def rolling_correlation(a: pd.Series, b: pd.Series, window: int) -> pd.Series:
    return a.rolling(window, min_periods=max(3, window // 2)).corr(b)


def rolling_beta(a: pd.Series, b: pd.Series, window: int) -> pd.Series:
    cov = a.rolling(window, min_periods=max(3, window // 2)).cov(b)
    var = b.rolling(window, min_periods=max(3, window // 2)).var(ddof=0)
    return safe_div(cov, var)


def wick_ratios(df: pd.DataFrame) -> pd.DataFrame:
    """Mèches de rejet : proportion de la barre occupée par chaque mèche."""
    rng = (df["high"] - df["low"]).replace(0.0, np.nan)
    upper = df["high"] - df[["open", "close"]].max(axis=1)
    lower = df[["open", "close"]].min(axis=1) - df["low"]
    body = (df["close"] - df["open"]).abs()
    return pd.DataFrame(
        {
            "upper_wick_ratio": upper / rng,
            "lower_wick_ratio": lower / rng,
            "body_ratio": body / rng,
        }
    )
