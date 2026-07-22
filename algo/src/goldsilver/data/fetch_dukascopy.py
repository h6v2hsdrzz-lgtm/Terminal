"""Téléchargement de bougies horaires BID + ASK depuis le datafeed public Dukascopy.

Format .bi5 : flux LZMA d'enregistrements de 24 octets big-endian
    (offset_secondes u32, open u32, close u32, low u32, high u32, volume f32)
Les prix sont des entiers en millièmes (scale 1000 pour XAUUSD / XAGUSD).
Un fichier par mois et par côté : .../{SYMBOL}/{YYYY}/{MM-1}/BID_candles_hour_1.bi5
(le mois est indexé à partir de 0 dans les URL Dukascopy).

Le CSV produit contient les OHLCV **bid** + une colonne `spread` (ask_close -
bid_close) : le moteur peut ainsi utiliser le spread réel bougie par bougie.
"""

from __future__ import annotations

import logging
import lzma
import struct
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from goldsilver.config import FetchConfig

log = logging.getLogger(__name__)

_BASE_URL = "https://datafeed.dukascopy.com/datafeed"
_RECORD = struct.Struct(">5If")  # t_offset, open, close, low, high, volume

# Bornes de vraisemblance pour détecter une erreur de scale ou un flux corrompu.
_PLAUSIBLE_RANGE: dict[str, tuple[float, float]] = {
    "XAUUSD": (500.0, 20000.0),
    "XAGUSD": (5.0, 500.0),
}


def _fetch_month(
    symbol: str, year: int, month0: int, side: str, retries: int = 4
) -> bytes | None:
    """Retourne le contenu .bi5 du mois, ou None si absent (404).

    Retente jusqu'à ``retries`` fois avec backoff exponentiel (2, 4, 8, 16 s)
    sur les erreurs réseau transitoires.
    """
    url = f"{_BASE_URL}/{symbol}/{year}/{month0:02d}/{side}_candles_hour_1.bi5"
    req = urllib.request.Request(url, headers={"User-Agent": "goldsilver-backtest/0.1"})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            if attempt == retries:
                raise
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
            if attempt == retries:
                raise
        delay = 2.0 * 2**attempt
        log.warning("%s %d-%02d %s : erreur réseau, retry dans %.0f s",
                    symbol, year, month0 + 1, side, delay)
        time.sleep(delay)
    return None


def _decode(blob: bytes, month_start: datetime, scale: float) -> pd.DataFrame:
    raw = lzma.decompress(blob)
    n = len(raw) // _RECORD.size
    rows = []
    base = int(month_start.timestamp())
    for i in range(n):
        t, o, c, lo, hi, v = _RECORD.unpack_from(raw, i * _RECORD.size)
        rows.append((base + t, o / scale, hi / scale, lo / scale, c / scale, float(v)))
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["time"] = pd.to_datetime(df.pop("ts"), unit="s", utc=True)
    return df.set_index("time")


def fetch_symbol(symbol: str, cfg: FetchConfig, out_dir: Path) -> Path:
    """Télécharge bid+ask horaires du symbole et écrit ``{symbol}_1h.csv``."""
    start = datetime.strptime(cfg.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end = (
        datetime.strptime(cfg.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if cfg.end
        else datetime.now(timezone.utc)
    )
    months: list[datetime] = []
    cur = datetime(start.year, start.month, 1, tzinfo=timezone.utc)
    while cur <= end:
        months.append(cur)
        cur = datetime(cur.year + (cur.month == 12), cur.month % 12 + 1, 1, tzinfo=timezone.utc)

    bid_parts: list[pd.DataFrame] = []
    ask_close_parts: list[pd.Series] = []
    for m in months:
        blob_bid = _fetch_month(symbol, m.year, m.month - 1, "BID")
        time.sleep(cfg.pause_seconds)
        blob_ask = _fetch_month(symbol, m.year, m.month - 1, "ASK")
        time.sleep(cfg.pause_seconds)
        if blob_bid is None:
            log.warning("%s %s : pas de données BID, mois ignoré", symbol, m.strftime("%Y-%m"))
            continue
        bid = _decode(blob_bid, m, cfg.price_scale)
        bid_parts.append(bid)
        if blob_ask is not None:
            ask_close_parts.append(_decode(blob_ask, m, cfg.price_scale)["close"])
        log.info("%s %s : %d bougies", symbol, m.strftime("%Y-%m"), len(bid))

    if not bid_parts:
        raise RuntimeError(f"Aucune donnée téléchargée pour {symbol}")

    df = pd.concat(bid_parts).sort_index()
    df = df[~df.index.duplicated(keep="last")]
    if ask_close_parts:
        ask_close = pd.concat(ask_close_parts).sort_index()
        ask_close = ask_close[~ask_close.index.duplicated(keep="last")]
        df["spread"] = (ask_close.reindex(df.index) - df["close"]).clip(lower=0.0)

    lo, hi = _PLAUSIBLE_RANGE.get(symbol, (0.0, float("inf")))
    med = float(df["close"].median())
    if not (lo <= med <= hi):
        raise RuntimeError(
            f"{symbol} : prix médian {med} hors plage plausible [{lo}, {hi}] — "
            "scale probablement incorrect, CSV non écrit."
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{symbol}_1h.csv"
    df.to_csv(out, index_label="time", float_format="%.5f")
    log.info("%s : %d bougies écrites -> %s", symbol, len(df), out)
    return out


def fetch_all(cfg: FetchConfig, root: Path) -> list[Path]:
    out_dir = root / cfg.out_dir
    return [fetch_symbol(sym, cfg, out_dir) for sym in cfg.symbols]
