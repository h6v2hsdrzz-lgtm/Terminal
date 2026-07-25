"""Construction des features multi-timeframes **sans lookahead**.

Le point délicat d'un backtest multi-TF est la disponibilité de l'information.
Une bougie 4h ouverte à 08:00 n'est **close qu'à 12:00** : ses indicateurs ne
sont connus qu'à partir de 12:00. Les utiliser à 09:00 revient à lire l'avenir,
et c'est l'erreur qui produit la majorité des backtests « magiques ».

Règle implémentée ici :

* chaque série d'indicateurs est calculée sur son propre timeframe ;
* on lui attache son instant de disponibilité ``available_at = open + durée`` ;
* la jointure sur le timeframe d'exécution est un ``merge_asof`` **sur cet
  instant de disponibilité**, jamais sur l'heure d'ouverture ;
* la décision est prise à la clôture de la barre d'exécution ``t`` et le fill a
  lieu à l'ouverture de ``t+1`` (géré par le moteur).

Le test ``tests/test_no_lookahead.py`` vérifie empiriquement cette propriété en
injectant du bruit dans le futur.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import Config
from ..utils import get_logger, timeframe_to_ms, timeframe_to_timedelta
from . import indicators as ind

log = get_logger("features.pipeline")


def compute_features(df: pd.DataFrame, cfg: Config, timeframe: str) -> pd.DataFrame:
    """Calcule le jeu d'indicateurs d'un timeframe donné (toutes colonnes causales)."""
    if df is None or df.empty:
        return pd.DataFrame()
    f = cfg.sub("features")
    out = pd.DataFrame(index=df.index)
    close = df["close"]

    # --- tendance ---
    for period in f["ema_periods"]:
        out[f"ema_{period}"] = ind.ema(close, int(period))
        out[f"ema_{period}_slope"] = ind.slope(out[f"ema_{period}"], int(f["ema_slope_lookback"]))
    dmi = ind.dmi_adx(df, int(f["adx_period"]))
    out[["plus_di", "minus_di", "adx"]] = dmi[["plus_di", "minus_di", "adx"]]
    st = ind.supertrend(df, int(f["supertrend"]["period"]), float(f["supertrend"]["multiplier"]))
    out[["st_trend", "st_line"]] = st
    out = out.join(ind.swing_points(df, int(f["swing_lookback"])))

    # --- volatilité / range ---
    out["atr"] = ind.atr(df, int(f["atr_period"]))
    out["atr_pct"] = out["atr"] / close
    out["atr_pctile"] = out["atr_pct"].rolling(
        int(f["atr_percentile_window"]), min_periods=int(f["atr_percentile_window"]) // 5
    ).rank(pct=True)
    bb = ind.bollinger(close, int(f["bollinger"]["period"]), float(f["bollinger"]["k"]))
    out = out.join(bb)
    kc = ind.keltner(df, int(f["keltner"]["period"]), float(f["keltner"]["atr_mult"]))
    out = out.join(kc)
    out["bb_width_pctile"] = out["bb_width"].rolling(
        int(f["atr_percentile_window"]), min_periods=int(f["atr_percentile_window"]) // 5
    ).rank(pct=True)
    out["squeeze"] = (out["bb_upper"] < out["kc_upper"]) & (out["bb_lower"] > out["kc_lower"])
    out["chop"] = ind.choppiness(df, int(f["choppiness_period"]))

    # --- momentum ---
    out["rsi"] = ind.rsi(close, int(f["rsi_period"]))
    macd = ind.macd(close, int(f["macd"]["fast"]), int(f["macd"]["slow"]), int(f["macd"]["signal"]))
    out = out.join(macd)
    out["roc"] = ind.roc(close, int(f["roc_period"]))

    # --- volume ---
    out["obv"] = ind.obv(df)
    out["obv_ema"] = ind.ema(out["obv"], int(f["obv_smooth"]))
    out["rel_volume"] = ind.relative_volume(df, int(f["volume_ma_period"]))
    vwap = ind.anchored_vwap(df, str(f["vwap_anchor"]))
    out = out.join(vwap)
    for k in f["vwap_bands"]:
        out[f"vwap_up_{k}"] = out["vwap"] + float(k) * out["vwap_sd"]
        out[f"vwap_dn_{k}"] = out["vwap"] - float(k) * out["vwap_sd"]
    out = out.join(ind.wick_ratios(df))

    # --- structures lourdes : uniquement sur les TF hauts (coût de calcul) ---
    if timeframe_to_ms(timeframe) >= timeframe_to_ms("1h"):
        vp = f["volume_profile"]
        out = out.join(
            ind.volume_profile(df, int(vp["window"]), int(vp["bins"]), float(vp["value_area"]))
        )
        sr = f["sr_cluster"]
        out = out.join(
            ind.sr_levels(df, int(sr["lookback"]), float(sr["tolerance_pct"]), int(sr["min_touches"]))
        )

    # --- divergences prix / oscillateurs ---
    look = int(f["divergence_lookback"])
    div_rsi = ind.divergence(close, out["rsi"], look).add_prefix("rsi_")
    div_macd = ind.divergence(close, out["macd_hist"], look).add_prefix("macd_")
    out = out.join(div_rsi).join(div_macd)

    # --- prix bruts utiles en aval ---
    out["close"] = close
    out["high"] = df["high"]
    out["low"] = df["low"]
    out["open"] = df["open"]
    out["volume"] = df["volume"]
    out["ret_1"] = close.pct_change()
    return out


def align_to_execution(
    features: pd.DataFrame,
    source_timeframe: str,
    exec_index: pd.DatetimeIndex,
    exec_timeframe: str,
    suffix: str | None = None,
) -> pd.DataFrame:
    """Aligne les features d'un TF source sur la timeline d'exécution.

    L'alignement se fait sur l'instant de **clôture** de la barre source, et la
    valeur retenue pour la barre d'exécution ``t`` est la dernière disponible à
    la clôture de ``t`` (instant de décision).
    """
    if features is None or features.empty:
        return pd.DataFrame(index=exec_index)
    src = features.copy()
    src["available_at"] = src.index + timeframe_to_timedelta(source_timeframe)
    src = src.sort_values("available_at")

    decision_times = exec_index + timeframe_to_timedelta(exec_timeframe)
    left = pd.DataFrame({"decision_at": decision_times}, index=exec_index)
    merged = pd.merge_asof(
        left.sort_values("decision_at"),
        src,
        left_on="decision_at",
        right_on="available_at",
        direction="backward",
        allow_exact_matches=True,
    )
    merged.index = left.sort_values("decision_at").index
    merged = merged.drop(columns=["decision_at", "available_at"], errors="ignore")
    merged = merged.reindex(exec_index)
    if suffix:
        merged = merged.add_suffix(f"_{suffix}")
    return merged


def required_warmup_bars(cfg: Config) -> int:
    """Nombre de barres d'exécution à ignorer avant toute décision.

    Une EMA 200 sur 4h demande 800 heures d'historique : si le backtest commence
    à trader avant, ses features valent NaN, le régime retombe par défaut sur
    ``range`` et les premiers mois du test sont du bruit déguisé en résultat.
    Le warmup est donc **dérivé** des paramètres, pas choisi à la main.
    """
    f = cfg.sub("features")
    exec_tf = str(cfg.get_path("data.execution_timeframe"))
    exec_ms = timeframe_to_ms(exec_tf)
    timeframes = list(cfg.get_path("data.signal_timeframes"))
    if exec_tf not in timeframes:
        timeframes.append(exec_tf)

    base_lookback = max(
        [int(max(f["ema_periods"])), int(f["atr_percentile_window"]),
         int(f["sr_cluster"]["lookback"]), int(f["divergence_lookback"]),
         int(f["bollinger"]["period"]), int(f["choppiness_period"])]
    )
    heavy_lookback = max(base_lookback, int(f["volume_profile"]["window"]))

    needed = 0
    for tf in timeframes:
        ratio = timeframe_to_ms(tf) / exec_ms
        lookback = heavy_lookback if timeframe_to_ms(tf) >= timeframe_to_ms("1h") else base_lookback
        needed = max(needed, int(lookback * ratio))
    return needed


def effective_warmup(cfg: Config) -> int:
    configured = int(cfg.get_path("backtest.warmup_bars"))
    if not bool(cfg.get_path("backtest.auto_warmup", True)):
        return configured
    return max(configured, required_warmup_bars(cfg))


class FeatureStore:
    """Calcule et met en cache les features de chaque (symbole, timeframe)."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.exec_tf = str(cfg.get_path("data.execution_timeframe"))
        self.timeframes = list(cfg.get_path("data.signal_timeframes"))
        if self.exec_tf not in self.timeframes:
            self.timeframes.append(self.exec_tf)
        self.raw: dict[tuple[str, str], pd.DataFrame] = {}
        self.aligned: dict[str, pd.DataFrame] = {}

    def build(self, md, symbols: list[str] | None = None) -> dict[str, pd.DataFrame]:
        symbols = symbols or md.symbols
        for symbol in symbols:
            exec_df = md.get(symbol, self.exec_tf)
            if exec_df is None or exec_df.empty:
                continue
            frames = []
            for tf in self.timeframes:
                if (symbol, tf) not in md.ohlcv:
                    continue
                df = md.ohlcv[(symbol, tf)]
                if df is None or df.empty:
                    continue
                feats = compute_features(df, self.cfg, tf)
                self.raw[(symbol, tf)] = feats
                frames.append(
                    align_to_execution(feats, tf, exec_df.index, self.exec_tf, suffix=tf)
                )
            if not frames:
                continue
            merged = pd.concat(frames, axis=1)
            # prix de référence de la barre d'exécution (connus à sa clôture)
            merged["close"] = exec_df["close"]
            merged["open"] = exec_df["open"]
            merged["high"] = exec_df["high"]
            merged["low"] = exec_df["low"]
            merged["volume"] = exec_df["volume"]
            self.aligned[symbol] = merged
            log.info("features %s : %d colonnes, %d barres", symbol, merged.shape[1], len(merged))
        return self.aligned

    def get(self, symbol: str) -> pd.DataFrame:
        return self.aligned[symbol]
