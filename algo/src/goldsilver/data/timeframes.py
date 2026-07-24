"""Ré-échantillonnage multi-timeframe et alignement SANS look-ahead.

Règle d'or : une bougie du timeframe de base (ex. 1h) ne doit voir que la
dernière bougie **terminée** du timeframe supérieur (ex. daily). Utiliser la
bougie daily en cours revient à connaître le futur — c'est le bug de
look-ahead le plus courant des backtests multi-timeframe, et il gonfle
artificiellement les résultats.

Implémentation : indicateur calculé sur le TF supérieur, décalé d'une bougie
(``shift(1)``), puis projeté sur l'index de base par jointure "asof"
(dernière valeur connue). Testé explicitement dans
``tests/test_timeframes_no_lookahead.py``.
"""

from __future__ import annotations

import pandas as pd

_AGG = {"open": "first", "high": "max", "low": "min", "close": "last",
        "volume": "sum", "spread": "mean"}

# "24h" et non "1D" : seules les fréquences "tick-like" acceptent un offset de
# session en pandas 3 (bornes daily décalées à 22h UTC pour la journée CFD).
_PANDAS_FREQ = {"15m": "15min", "1h": "1h", "4h": "4h", "1d": "24h"}


def resample_ohlcv(df: pd.DataFrame, timeframe: str, day_offset_hours: int = 0) -> pd.DataFrame:
    """Agrège un OHLCV vers un timeframe supérieur.

    ``day_offset_hours`` décale les bornes des bougies daily pour épouser la
    journée de trading CFD (ex. -2 => journées de 22h UTC à 22h UTC, la
    session du dimanche soir est rattachée au lundi).
    """
    if timeframe not in _PANDAS_FREQ:
        raise ValueError(f"Timeframe inconnu : {timeframe} (choix : {list(_PANDAS_FREQ)})")
    freq = _PANDAS_FREQ[timeframe]
    offset = pd.Timedelta(hours=day_offset_hours) if timeframe == "1d" else None
    agg = {k: v for k, v in _AGG.items() if k in df.columns}
    out = df.resample(freq, label="left", closed="left", offset=offset).agg(agg)
    return out.dropna(subset=["open", "high", "low", "close"])


def build_timeframes(
    base: pd.DataFrame,
    base_timeframe: str,
    timeframes: tuple[str, ...],
    day_offset_hours: int = 0,
) -> dict[str, pd.DataFrame]:
    """Construit le dictionnaire {timeframe: OHLCV} à partir du TF de base."""
    order = list(_PANDAS_FREQ)
    if base_timeframe not in order:
        raise ValueError(f"Timeframe de base inconnu : {base_timeframe}")
    out: dict[str, pd.DataFrame] = {base_timeframe: base}
    for tf in timeframes:
        if tf == base_timeframe:
            continue
        if order.index(tf) < order.index(base_timeframe):
            raise ValueError(
                f"Impossible de dériver {tf} depuis {base_timeframe} (plus fin que la base)"
            )
        out[tf] = resample_ohlcv(base, tf, day_offset_hours)
    return out


def align_to_base(
    base_index: pd.DatetimeIndex,
    series_high_tf: pd.Series,
    shift: int = 1,
) -> pd.Series:
    """Projette une série d'un TF supérieur sur l'index de base, sans look-ahead.

    ``shift=1`` (défaut) : chaque bougie de base reçoit la valeur de la
    dernière bougie SUPÉRIEURE TERMINÉE (l'index du TF supérieur doit être le
    début de bougie, convention ``label='left'`` de :func:`resample_ohlcv`).
    ``shift=0`` n'est légitime que pour des valeurs connues en début de bougie.
    """
    if not base_index.is_monotonic_increasing:
        raise ValueError("align_to_base : l'index de base doit être trié")
    shifted = series_high_tf.shift(shift)
    left = pd.DataFrame({"_ts": base_index})
    right = pd.DataFrame({"_ts": shifted.index, "_val": shifted.to_numpy()})
    merged = pd.merge_asof(left, right, on="_ts", direction="backward")
    return pd.Series(
        merged["_val"].to_numpy(), index=base_index, name=series_high_tf.name
    )
