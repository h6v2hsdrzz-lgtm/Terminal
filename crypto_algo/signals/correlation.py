"""Famille f) — Corrélation / décorrélation.

Corrélation glissante 30/90 entre les trois actifs, beta vs BTC, z-score des
ratios ETH/BTC et SOL/BTC, proxy de dominance BTC.

Règle du prompt, implémentée littéralement :

* décorrélation **extrême** (|z| > 2) sur un ratio historiquement **stationnaire**
  = setup de retour à la moyenne ;
* décorrélation **persistante** = changement de régime, **pas** un signal.

La distinction est faite par un test de stationnarité glissant : on compte les
franchissements de la moyenne mobile par le ratio (proxy de réversion) et on
mesure depuis combien de barres le z-score reste au-delà du seuil.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..utils import rolling_zscore
from .base import SignalContext, SignalFamily, squash


def _consecutive_true(mask: pd.Series) -> pd.Series:
    """Longueur de la série courante de ``True`` (0 quand ``False``)."""
    m = mask.fillna(False).astype(int)
    grp = (m == 0).cumsum()
    return m.groupby(grp).cumsum()


def mean_crossings(series: pd.Series, window: int) -> pd.Series:
    """Nombre de franchissements de zéro sur la fenêtre — proxy de stationnarité."""
    sign = np.sign(series.fillna(0.0))
    crossing = (sign != sign.shift(1)).astype(float)
    return crossing.rolling(window, min_periods=max(5, window // 5)).sum()


class CorrelationFamily(SignalFamily):
    name = "correlation"

    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        out: dict[str, pd.Series] = {}
        cfg = ctx.cfg
        idx = ctx.own.index
        bench = ctx.benchmark
        if ctx.symbol == bench or bench not in ctx.features:
            return {}

        exec_tf = str(cfg.get_path("data.execution_timeframe"))
        windows = list(cfg.get_path("features.correlation_windows"))
        beta_window = int(cfg.get_path("features.beta_window"))
        z_window = int(cfg.get_path("features.ratio_zscore_window"))
        entry_z = float(cfg.get_path("statarb.pair_entry_z"))
        min_cross = float(cfg.get_path("signals.min_mean_crossings", 6.0))
        max_persistence = int(cfg.get_path("signals.max_decorrelation_bars", 96))

        own_close = ctx.col("close").reindex(idx)
        bench_close = ctx.features[bench]["close"].reindex(idx)
        own_ret = own_close.pct_change()
        bench_ret = bench_close.pct_change()

        # --- corrélation glissante (information de contexte, non directionnelle) ---
        for w in windows:
            corr = own_ret.rolling(int(w), min_periods=max(5, int(w) // 2)).corr(bench_ret)
            out[f"corr_{w}"] = pd.Series(0.0, index=idx)      # neutre par construction
            ctx.own[f"_corr_{w}"] = corr                       # exposé pour le régime

        # --- beta vs BTC ---
        cov = own_ret.rolling(beta_window, min_periods=beta_window // 2).cov(bench_ret)
        var = bench_ret.rolling(beta_window, min_periods=beta_window // 2).var(ddof=0)
        beta = (cov / var.replace(0.0, np.nan))
        ctx.own["_beta_vs_bench"] = beta

        # --- z-score du ratio (log) ---
        ratio = np.log(own_close / bench_close)
        z = rolling_zscore(ratio, z_window)
        crossings = mean_crossings(ratio - ratio.rolling(z_window, min_periods=z_window // 2).mean(),
                                   z_window)
        stationary = crossings >= min_cross
        stretched = z.abs() >= entry_z
        persistence = _consecutive_true(stretched)
        regime_change = persistence > max_persistence

        # retour à la moyenne uniquement si stationnaire ET écart non persistant
        tradable = stretched & stationary & (~regime_change)
        out["ratio_mean_reversion"] = (-squash(z.fillna(0.0), entry_z) * tradable.astype(float))

        # une décorrélation persistante n'est pas un signal : on l'annule explicitement
        out["decorrelation_regime_change"] = pd.Series(0.0, index=idx)
        ctx.own["_ratio_z"] = z
        ctx.own["_ratio_persistent"] = regime_change.astype(float)
        return out


def dominance_proxy(features: dict[str, pd.DataFrame], benchmark: str = "BTC/USDT:USDT") -> pd.Series:
    """Proxy de dominance BTC : part de BTC dans un panier équipondéré rebasé.

    Ce **n'est pas** la dominance de capitalisation (indisponible via l'API
    exchange) : c'est une mesure de performance relative. Nommée comme telle
    pour éviter toute confusion dans le rapport.
    """
    if benchmark not in features:
        return pd.Series(dtype=float)
    closes = {s: f["close"] for s, f in features.items() if "close" in f}
    if len(closes) < 2:
        return pd.Series(dtype=float)
    frame = pd.DataFrame(closes).dropna()
    rebased = frame / frame.iloc[0]
    return rebased[benchmark] / rebased.sum(axis=1)
