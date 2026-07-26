"""Chargement des données en mémoire, avec verrou out-of-sample.

Le verrou est la traduction en code de la règle §8.1 : l'OOS n'est regardé
qu'une seule fois, à la fin. Tant que ``splits.oos_unlocked`` est ``false``,
toute tentative de chargement de la période OOS lève une exception.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import Config, resolve_path
from ..utils import dt_to_ms, get_logger, timeframe_to_ms, to_utc, utc_index
from .store import ParquetStore

log = get_logger("data.loader")


class OutOfSampleLocked(RuntimeError):
    """Tentative de lecture de l'out-of-sample avant la fin de la recherche."""


@dataclass
class MarketData:
    """Conteneur de séries alignées en UTC, indexées sur l'heure d'ouverture de barre."""

    symbols: list[str]
    ohlcv: dict[tuple[str, str], pd.DataFrame] = field(default_factory=dict)
    funding: dict[str, pd.DataFrame] = field(default_factory=dict)
    mark: dict[str, pd.DataFrame] = field(default_factory=dict)
    index: dict[str, pd.DataFrame] = field(default_factory=dict)
    open_interest: dict[str, pd.DataFrame] = field(default_factory=dict)
    split: str = "custom"

    # ------------------------------------------------------------------ accès
    def get(self, symbol: str, timeframe: str) -> pd.DataFrame:
        key = (symbol, timeframe)
        if key not in self.ohlcv:
            raise KeyError(f"Série absente : {symbol} {timeframe}")
        return self.ohlcv[key]

    def has(self, symbol: str, timeframe: str) -> bool:
        return (symbol, timeframe) in self.ohlcv and not self.ohlcv[(symbol, timeframe)].empty

    @property
    def timeframes(self) -> list[str]:
        return sorted({tf for _, tf in self.ohlcv}, key=timeframe_to_ms)

    def funding_series(self, symbol: str) -> pd.Series:
        df = self.funding.get(symbol)
        if df is None or df.empty:
            return pd.Series(dtype=float)
        return df.set_index(df.index)["funding_rate"]

    def slice(self, start=None, end=None) -> "MarketData":
        start, end = to_utc(start), to_utc(end)

        def _cut(df: pd.DataFrame) -> pd.DataFrame:
            if df is None or df.empty:
                return df
            out = df
            if start is not None:
                out = out[out.index >= start]
            if end is not None:
                out = out[out.index < end]
            return out

        return MarketData(
            symbols=list(self.symbols),
            ohlcv={k: _cut(v) for k, v in self.ohlcv.items()},
            funding={k: _cut(v) for k, v in self.funding.items()},
            mark={k: _cut(v) for k, v in self.mark.items()},
            index={k: _cut(v) for k, v in self.index.items()},
            open_interest={k: _cut(v) for k, v in self.open_interest.items()},
            split=self.split,
        )

    def describe(self) -> pd.DataFrame:
        rows = []
        for (sym, tf), df in sorted(self.ohlcv.items()):
            rows.append(
                {
                    "symbol": sym,
                    "timeframe": tf,
                    "bars": len(df),
                    "start": df.index.min() if len(df) else None,
                    "end": df.index.max() if len(df) else None,
                }
            )
        return pd.DataFrame(rows)


def _prepare(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    out = utc_index(df).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    return out


def split_bounds(cfg: Config, split: str) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
    if split == "in_sample":
        return to_utc(cfg.get_path("splits.in_sample.start")), to_utc(cfg.get_path("splits.in_sample.end"))
    if split == "out_of_sample":
        return to_utc(cfg.get_path("splits.out_of_sample.start")), to_utc(cfg.get_path("splits.out_of_sample.end"))
    if split in ("full", "all"):
        return to_utc(cfg.get_path("data.start")), to_utc(cfg.get_path("data.end"))
    raise ValueError(f"Split inconnu : {split!r}")


def assert_split_allowed(cfg: Config, split: str) -> None:
    if split in ("out_of_sample", "full", "all") and not bool(cfg.get_path("splits.oos_unlocked")):
        raise OutOfSampleLocked(
            f"Le split {split!r} touche l'out-of-sample, verrouillé "
            "(splits.oos_unlocked=false). L'OOS ne s'ouvre qu'une fois, en fin d'audit, "
            "et aucun paramètre ne doit être modifié après son ouverture."
        )


def load_market_data(
    cfg: Config,
    split: str = "in_sample",
    symbols: list[str] | None = None,
    timeframes: list[str] | None = None,
    include_intrabar: bool = False,
    store: ParquetStore | None = None,
    warmup_pad: bool = True,
) -> MarketData:
    """Charge les séries du cache pour un split donné.

    ``warmup_pad`` charge en plus l'historique nécessaire au calcul des
    features (EMA 200 en 4h = 33 jours, percentiles d'ATR = 83 jours). Sans ce
    pré-chargement, les premiers mois de chaque split seraient tradés sur des
    indicateurs incomplets — ou pas tradés du tout, ce qui fausse la
    comparaison entre splits.
    """
    assert_split_allowed(cfg, split)
    start, end = split_bounds(cfg, split)
    if warmup_pad and start is not None:
        from ..features.pipeline import effective_warmup
        from ..utils import timeframe_to_timedelta

        pad = effective_warmup(cfg) * timeframe_to_timedelta(str(cfg.get_path("data.execution_timeframe")))
        start = start - pad

    store = store or ParquetStore(resolve_path(cfg, cfg.get_path("data.store_path")))
    symbols = symbols or list(cfg.get_path("universe.symbols"))
    tfs = list(timeframes or cfg.get_path("data.signal_timeframes"))
    exec_tf = cfg.get_path("data.execution_timeframe")
    if exec_tf not in tfs:
        tfs.append(exec_tf)
    if include_intrabar:
        itf = cfg.get_path("data.intrabar_timeframe")
        if itf not in tfs:
            tfs.append(itf)

    md = MarketData(symbols=list(symbols), split=split)
    for sym in symbols:
        for tf in tfs:
            df = _prepare(store.read("ohlcv", sym, tf, start=start, end=end))
            if df.empty:
                log.warning("Aucune donnée en cache pour %s %s", sym, tf)
            md.ohlcv[(sym, tf)] = df
        for kind, target in (("mark", md.mark), ("index", md.index)):
            target[sym] = _prepare(store.read(kind, sym, exec_tf, start=start, end=end))
        # la série 'funding_full' (réel + reconstruit) prime sur le brut d'API
        full = _prepare(store.read("funding_full", sym, start=start, end=end))
        md.funding[sym] = full if not full.empty else _prepare(store.read("funding", sym, start=start, end=end))
        md.open_interest[sym] = _prepare(store.read("open_interest", sym, start=start, end=end))
    log.info("Données chargées (%s) :\n%s", split, md.describe().to_string(index=False))
    return md


# ---------------------------------------------------------------------------
# Générateur synthétique — utilisé par les tests et les scénarios de validation
# du moteur (aucun accès réseau requis).
# ---------------------------------------------------------------------------
def synthetic_ohlcv(
    n_bars: int = 2000,
    timeframe: str = "5m",
    start: str = "2021-01-01T00:00:00Z",
    seed: int = 7,
    drift: float = 0.0,
    vol: float = 0.004,
    start_price: float = 30000.0,
    regime: str = "random_walk",
) -> pd.DataFrame:
    """Série OHLCV synthétique reproductible (marche aléatoire, tendance ou range)."""
    rng = np.random.default_rng(seed)
    step_ms = timeframe_to_ms(timeframe)
    ts = np.arange(n_bars, dtype=np.int64) * step_ms + int(pd.Timestamp(start).value // 1_000_000)

    if regime == "trend":
        shocks = rng.normal(drift or vol * 0.35, vol, n_bars)
    elif regime == "range":
        shocks = np.zeros(n_bars)
        level = 0.0
        for i in range(n_bars):
            level = 0.90 * level + rng.normal(0.0, vol)
            shocks[i] = level - (0.90 * level)
        base = start_price * (1 + 0.02 * np.sin(np.linspace(0, 12 * np.pi, n_bars)))
        close = base * (1 + np.cumsum(rng.normal(0, vol * 0.25, n_bars)))
        close = np.maximum(close, 1e-6)
    else:
        shocks = rng.normal(drift, vol, n_bars)

    if regime != "range":
        close = start_price * np.exp(np.cumsum(shocks))

    open_ = np.concatenate([[start_price], close[:-1]])
    wick = np.abs(rng.normal(0, vol * 0.8, n_bars)) * close
    high = np.maximum(open_, close) + wick
    low = np.minimum(open_, close) - wick
    volume = np.abs(rng.normal(1000, 250, n_bars)) + 50

    return pd.DataFrame(
        {
            "timestamp": ts,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    )


def synthetic_market_data(
    symbols: list[str] | None = None,
    timeframes: list[str] | None = None,
    n_bars: int = 2000,
    exec_timeframe: str = "5m",
    seed: int = 7,
    regime: str = "random_walk",
    funding_rate: float = 0.0001,
) -> MarketData:
    """MarketData synthétique cohérent multi-TF (les TF hauts sont agrégés du TF bas)."""
    symbols = symbols or ["BTC/USDT:USDT"]
    timeframes = timeframes or [exec_timeframe]
    md = MarketData(symbols=list(symbols), split="synthetic")
    for i, sym in enumerate(symbols):
        base = synthetic_ohlcv(
            n_bars=n_bars, timeframe=exec_timeframe, seed=seed + i, regime=regime,
            start_price=30000.0 / (1 + i * 3),
        )
        md.ohlcv[(sym, exec_timeframe)] = _prepare(base)
        for tf in timeframes:
            if tf == exec_timeframe:
                continue
            md.ohlcv[(sym, tf)] = _prepare(resample_ohlcv(base, exec_timeframe, tf))
        # funding synthétique toutes les 8h
        idx = md.ohlcv[(sym, exec_timeframe)].index
        f_idx = pd.date_range(idx.min().floor("8h"), idx.max(), freq="8h", tz="UTC")
        md.funding[sym] = pd.DataFrame(
            {
                "timestamp": dt_to_ms(f_idx),
                "funding_rate": np.full(len(f_idx), funding_rate),
            },
            index=f_idx,
        )
        md.mark[sym] = md.ohlcv[(sym, exec_timeframe)].copy()
        md.index[sym] = md.ohlcv[(sym, exec_timeframe)].copy()
        md.open_interest[sym] = pd.DataFrame()
    return md


def resample_ohlcv(df: pd.DataFrame, src_tf: str, dst_tf: str) -> pd.DataFrame:
    """Agrégation TF bas -> TF haut (bornes alignées sur l'epoch, comme les exchanges)."""
    if timeframe_to_ms(dst_tf) % timeframe_to_ms(src_tf) != 0:
        raise ValueError(f"{dst_tf} n'est pas un multiple de {src_tf}")
    src = utc_index(df).sort_index()
    rule = pd.Timedelta(milliseconds=timeframe_to_ms(dst_tf))
    agg = src.resample(rule, label="left", closed="left", origin="epoch").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    ).dropna(subset=["open"])
    agg["timestamp"] = dt_to_ms(agg.index)
    return agg[["timestamp", "open", "high", "low", "close", "volume"]].reset_index(drop=True)
