"""Panel de marche aligne : une grille temporelle unique pour tous les actifs.

Tout le moteur consomme ce panel. Il aligne sur une grille horaire UTC :
OHLCV, mark price, index price, funding reel (pose aux heures de settlement
0/8/16 UTC uniquement) et open interest. Les barres 1 minute sont conservees
a part, avec un index barre-horaire -> tranche 1m, pour la resolution intrabar.

Aucune valeur n'est interpolee vers l'avant au-dela de ce qui existe : les
periodes ou un actif n'est pas encore cote restent NaN et sont masquees.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..core.config import Config
from ..core.persist import ComputeCache
from .store import ParquetStore

log = logging.getLogger("okx_algo.panel")


@dataclass
class SymbolData:
    symbol: str
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray          # volume en contrats
    volume_quote: np.ndarray    # volume en USDT
    mark_high: np.ndarray
    mark_low: np.ndarray
    mark_close: np.ndarray
    index_close: np.ndarray
    funding: np.ndarray         # taux paye a cette heure, 0 sinon
    open_interest: np.ndarray
    valid: np.ndarray           # True quand l'actif est cote et la barre exploitable
    long_short_ratio: np.ndarray | None = None   # positionnement des comptes
    taker_ls_ratio: np.ndarray | None = None     # desequilibre du flux agressif
    # 1 minute
    m1_close: np.ndarray = field(default_factory=lambda: np.array([]))
    m1_high: np.ndarray = field(default_factory=lambda: np.array([]))
    m1_low: np.ndarray = field(default_factory=lambda: np.array([]))
    m1_open: np.ndarray = field(default_factory=lambda: np.array([]))
    m1_volume: np.ndarray = field(default_factory=lambda: np.array([]))
    m1_slice: np.ndarray = field(default_factory=lambda: np.array([]))  # (n_bars, 2) int32


@dataclass
class Panel:
    index: pd.DatetimeIndex
    symbols: list[str]
    data: dict[str, SymbolData]
    timeframe: str = "1H"

    def __len__(self) -> int:
        return len(self.index)

    @property
    def n(self) -> int:
        return len(self.index)

    def slice(self, start: dt.datetime | str | None,
              end: dt.datetime | str | None) -> tuple[int, int]:
        """Bornes [i0, i1) de la fenetre demandee."""
        i0 = 0 if start is None else int(self.index.searchsorted(_as_utc(start)))
        i1 = (self.n if end is None
              else int(self.index.searchsorted(_as_utc(end), side="right")))
        return i0, i1

    def close_matrix(self) -> np.ndarray:
        return np.column_stack([self.data[s].close for s in self.symbols])

    def valid_matrix(self) -> np.ndarray:
        return np.column_stack([self.data[s].valid for s in self.symbols])


def _as_utc(value) -> pd.Timestamp:
    """Accepte indifferemment une chaine, un datetime naif ou deja localise."""
    t = pd.Timestamp(value)
    return t.tz_localize("UTC") if t.tz is None else t.tz_convert("UTC")


# ----------------------------------------------------------------------
def _to_grid(df: pd.DataFrame | None, grid: pd.DatetimeIndex, cols: list[str],
             how: str = "ffill") -> dict[str, np.ndarray]:
    """Reindexe un dataframe horodate sur la grille.

    how='ffill'  : etat persistant (mark, index, open interest)
    how='exact'  : evenement ponctuel, aucune propagation (funding)
    how='none'   : valeurs de barre, aucune propagation (OHLCV)
    """
    out = {c: np.full(len(grid), np.nan) for c in cols}
    if df is None or not len(df):
        return out
    d = df.dropna(subset=["datetime"]).set_index("datetime").sort_index()
    d = d[~d.index.duplicated(keep="last")]
    if how == "ffill":
        d = d.reindex(d.index.union(grid)).sort_index().ffill().reindex(grid)
    else:
        d = d.reindex(grid)
    for c in cols:
        if c in d.columns:
            out[c] = d[c].to_numpy(dtype=float)
    return out


def build_panel(cfg: Config, symbols: list[str] | None = None,
                timeframe: str = "1H", with_minute: bool = True,
                start: str | None = None, end: str | None = None) -> Panel:
    symbols = symbols or cfg.get("universe.symbols")
    store = ParquetStore(cfg.data_root)
    cache = ComputeCache(cfg.data_root, "panel")

    start_ts = pd.Timestamp(start or cfg.get("data.start"), tz="UTC")
    end_dt = cfg.data_end()

    key = {"symbols": symbols, "tf": timeframe, "minute": with_minute,
           "start": str(start_ts), "end": str(end or ""),
           # le cache doit s'invalider quand de nouvelles donnees arrivent
           "sig": {s: _dataset_signature(store, s) for s in symbols}}

    def build() -> Panel:
        return _build_panel_uncached(cfg, store, symbols, timeframe,
                                     with_minute, start_ts, end_dt, end)

    # Un panel avec le 1 minute pese plus d'un Go et son empreinte change a
    # chaque nouvelle barre telechargee : le mettre en cache disque remplirait
    # le volume pour un gain nul, le panel etant construit une fois par run et
    # reutilise en memoire ensuite.
    if with_minute:
        return build()
    return cache.get_or_compute(key, build)


def _dataset_signature(store: ParquetStore, symbol: str) -> dict:
    """Empreinte des fichiers presents : taille + mtime. Suffit a invalider."""
    sig = {}
    for ds, tf in [("ohlcv", "1m"), ("ohlcv", "15m"), ("ohlcv", "1H"), ("ohlcv", "4H"),
                   ("ohlcv", "1D"), ("mark", "1H"), ("index", "1H"),
                   ("funding", None), ("open_interest", None)]:
        p = store.path(ds, symbol, tf)
        sig[f"{ds}:{tf}"] = [p.stat().st_size, int(p.stat().st_mtime)] if p.exists() else None
    return sig


def _build_panel_uncached(cfg: Config, store: ParquetStore, symbols: list[str],
                          timeframe: str, with_minute: bool,
                          start_ts: pd.Timestamp, end_dt: dt.datetime,
                          end: str | None) -> Panel:
    end_ts = pd.Timestamp(end, tz="UTC") if end else pd.Timestamp(end_dt)
    freq = {"1H": "1h", "4H": "4h", "1D": "1D", "15m": "15min"}[timeframe]
    grid = pd.date_range(start_ts.floor(freq), end_ts.floor(freq), freq=freq, tz="UTC")

    data: dict[str, SymbolData] = {}
    for sym in symbols:
        ohlcv = store.try_read("ohlcv", sym, timeframe)
        if ohlcv is None:
            raise FileNotFoundError(f"OHLCV {timeframe} manquant pour {sym}")
        o = _to_grid(ohlcv, grid, ["open", "high", "low", "close", "volume", "volume_quote"],
                     how="none")
        mk = _to_grid(store.try_read("mark", sym, "1H"), grid, ["high", "low", "close"],
                      how="ffill")
        ix = _to_grid(store.try_read("index", sym, "1H"), grid, ["close"], how="ffill")
        oi = _to_grid(store.try_read("open_interest", sym), grid,
                      ["open_interest", "long_short_ratio", "taker_ls_ratio"], how="ffill")

        fund_df = store.try_read("funding", sym)
        fund = _to_grid(fund_df, grid, ["funding_rate"], how="exact")["funding_rate"]
        fund = np.nan_to_num(fund, nan=0.0)

        close = o["close"]
        valid = np.isfinite(close) & (close > 0)
        # une barre a volume nul reste valide pour le mark-to-market mais est
        # signalee au controle qualite ; elle n'est pas negociable.
        mark_close = np.where(np.isfinite(mk["close"]), mk["close"], close)
        sd = SymbolData(
            symbol=sym,
            open=o["open"], high=o["high"], low=o["low"], close=close,
            volume=np.nan_to_num(o["volume"]), volume_quote=np.nan_to_num(o["volume_quote"]),
            mark_high=np.where(np.isfinite(mk["high"]), mk["high"], o["high"]),
            mark_low=np.where(np.isfinite(mk["low"]), mk["low"], o["low"]),
            mark_close=mark_close,
            index_close=np.where(np.isfinite(ix["close"]), ix["close"], mark_close),
            funding=fund,
            open_interest=oi["open_interest"],
            long_short_ratio=oi.get("long_short_ratio"),
            taker_ls_ratio=oi.get("taker_ls_ratio"),
            valid=valid,
        )
        if with_minute:
            _attach_minute(store, sym, grid, sd, timeframe)
        data[sym] = sd
        log.info("panel %s: %d barres valides / %d", sym, int(valid.sum()), len(grid))

    return Panel(index=grid, symbols=list(symbols), data=data, timeframe=timeframe)


def _attach_minute(store: ParquetStore, sym: str, grid: pd.DatetimeIndex,
                   sd: SymbolData, timeframe: str) -> None:
    m1 = store.try_read("ohlcv", sym, "1m")
    if m1 is None or not len(m1):
        log.warning("1m absent pour %s : resolution intrabar degradee", sym)
        sd.m1_slice = np.zeros((len(grid), 2), dtype=np.int64)
        return
    m1 = m1.sort_values("datetime")
    ts = m1["datetime"].to_numpy()
    sd.m1_open = m1["open"].to_numpy(dtype=float)
    sd.m1_high = m1["high"].to_numpy(dtype=float)
    sd.m1_low = m1["low"].to_numpy(dtype=float)
    sd.m1_close = m1["close"].to_numpy(dtype=float)
    sd.m1_volume = m1["volume"].to_numpy(dtype=float)
    step = pd.Timedelta(grid.freq if grid.freq else "1h")
    starts = np.searchsorted(ts, grid.to_numpy(), side="left")
    ends = np.searchsorted(ts, (grid + step).to_numpy(), side="left")
    sd.m1_slice = np.column_stack([starts, ends]).astype(np.int64)
