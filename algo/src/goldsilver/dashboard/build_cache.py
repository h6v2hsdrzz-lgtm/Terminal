"""Génère le cache du dashboard : rejoue le backtest et sérialise tout en JSON.

POURQUOI un cache versionné plutôt qu'un calcul à la volée : le backtest
complet (7,5 ans de bougies 1h sur deux actifs) prend plusieurs secondes et
exige ``data/raw/`` — or ce dossier est gitignoré (27 Mo de CSV). Sans cache,
le dashboard serait vide sur un clone neuf ou sur le runner GitHub Actions.
On paie donc ~1 Mo de JSON versionné pour un dashboard qui s'ouvre
instantanément et partout.

    python -m goldsilver.dashboard.build_cache            # config par défaut
    python -m goldsilver.dashboard.build_cache -c config/breakout_4h.yaml

Régénérer après tout changement de stratégie, de paramètres ou de données.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from goldsilver.config import load_config
from goldsilver.data.loader import load_market
from goldsilver.data.timeframes import build_timeframes
from goldsilver.pipeline import run_backtest

log = logging.getLogger(__name__)

#: actifs de contexte macro (déjà téléchargés pour l'étude de décorrélation)
MACRO_ASSETS = {
    "USA500IDXUSD": "S&P 500",
    "LIGHTCMDUSD": "Pétrole WTI",
    "BTCUSD": "Bitcoin",
}

DEFAULT_OUT = "dashboard_data"


def _round(x: Any, nd: int = 2) -> Any:
    """Arrondi sûr : les NaN/inf deviennent None (JSON n'a pas de NaN)."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(v):
        return None
    return round(v, nd)


def _candles_payload(df: pd.DataFrame, price_nd: int) -> list[list[Any]]:
    """OHLC compact : [epoch_s, open, high, low, close] — format lightweight-charts."""
    idx = df.index.tz_convert("UTC") if df.index.tz is not None else df.index
    secs = (idx.as_unit("ns").asi8 // 1_000_000_000).tolist()
    return [
        [t, _round(o, price_nd), _round(h, price_nd),
         _round(low, price_nd), _round(c, price_nd)]
        for t, o, h, low, c in zip(
            secs, df["open"], df["high"], df["low"], df["close"]
        )
    ]


def _series_payload(s: pd.Series, nd: int = 2) -> list[list[Any]]:
    idx = s.index.tz_convert("UTC") if s.index.tz is not None else s.index
    secs = (idx.as_unit("ns").asi8 // 1_000_000_000).tolist()
    return [[t, _round(v, nd)] for t, v in zip(secs, s.to_numpy())]


def _trades_payload(trades: pd.DataFrame) -> list[dict[str, Any]]:
    """Un trade = une entrée + une sortie horodatées, prêtes à poser sur le chart."""
    out: list[dict[str, Any]] = []
    for i, t in enumerate(trades.itertuples(index=False)):
        entry_ts = pd.Timestamp(t.entry_time)
        exit_ts = pd.Timestamp(t.exit_time)
        out.append({
            "id": f"bt-{i}",
            "source": "backtest",
            "asset": t.asset,
            "side": int(t.side),
            "entry_time": int(entry_ts.timestamp()),
            "exit_time": int(exit_ts.timestamp()),
            "entry": _round(t.entry, 4),
            "exit": _round(t.exit, 4),
            "units": _round(t.units, 4),
            "sl": _round(t.sl, 4),
            "tp": _round(t.tp, 4),
            "pnl": _round(t.pnl),
            "pnl_pct": _round(t.pnl_pct, 5),
            "r_multiple": _round(t.r_multiple, 3),
            "reason": str(t.reason),
            "bars_held": int(t.bars_held),
            "risk_amount": _round(t.risk_amount),
        })
    return out


def _monthly_payload(equity: pd.Series, initial: float) -> list[dict[str, Any]]:
    monthly = equity.resample("ME").last().dropna()
    if monthly.empty:
        return []
    ret = pd.concat([pd.Series([initial]), monthly]).pct_change().dropna()
    ret.index = monthly.index
    return [
        {"year": int(ts.year), "month": int(ts.month), "ret": _round(v, 5)}
        for ts, v in ret.items()
    ]


def _drawdown_payload(equity: pd.Series) -> list[list[Any]]:
    dd = equity / equity.cummax() - 1.0
    return _series_payload(dd.resample("1D").min().dropna(), nd=5)


def _macro_payload(cfg_start: str, out_dir: Path, raw_dir: Path) -> dict[str, Any]:
    """Contexte cross-asset : clôtures journalières + corrélations glissantes.

    Sert à répondre « le marché est-il porteur pour cette stratégie ? » sans
    quitter le dashboard. Les fichiers manquants sont simplement ignorés :
    le panneau macro se dégrade, le reste du dashboard fonctionne.
    """
    closes: dict[str, pd.Series] = {}
    for symbol in ("XAUUSD", "XAGUSD", *MACRO_ASSETS):
        path = raw_dir / f"{symbol}_1h.csv"
        if not path.exists():
            log.warning("macro : %s absent, ignoré", path.name)
            continue
        df = pd.read_csv(path, parse_dates=["time"]).set_index("time").sort_index()
        if df.index.tz is None:
            df.index = df.index.tz_localize("UTC")
        closes[symbol] = df["close"].resample("1D").last().dropna()

    if not closes:
        return {"series": {}, "correlation": {}, "ratio": []}

    frame = pd.DataFrame(closes).dropna(how="all").ffill().dropna()
    rets = frame.pct_change().dropna()
    corr = rets.corr()

    ratio = (
        (frame["XAUUSD"] / frame["XAGUSD"]).dropna()
        if {"XAUUSD", "XAGUSD"} <= set(frame.columns)
        else pd.Series(dtype=float)
    )

    labels = {"XAUUSD": "Or", "XAGUSD": "Argent", **MACRO_ASSETS}
    return {
        "labels": labels,
        "series": {
            sym: _series_payload(frame[sym], nd=4) for sym in frame.columns
        },
        "correlation": {
            "symbols": list(corr.columns),
            "matrix": [[_round(v, 3) for v in row] for row in corr.to_numpy()],
            "note": "corrélation de Pearson des rendements JOURNALIERS "
                    f"depuis {cfg_start}",
        },
        "ratio": _series_payload(ratio, nd=3),
    }


def build(config_path: str, out_dir: Path, candle_tf: str = "4h") -> dict[str, Any]:
    cfg = load_config(config_path)
    log.info("Chargement des données de marché…")
    market = load_market(cfg)

    log.info("Backtest %s sur %s…", cfg.strategy.name, ", ".join(market))
    run = run_backtest(market, cfg)
    equity = run.equity
    trades = run.trades

    out_dir.mkdir(parents=True, exist_ok=True)

    # bougies au timeframe de décision, pour poser les trades dessus
    price_nd = {"XAUUSD": 2, "XAGUSD": 3}
    for asset, base in market.items():
        tfs = build_timeframes(
            base, cfg.data.base_timeframe, cfg.data.timeframes,
            cfg.data.session_day_offset_hours,
        )
        payload = _candles_payload(tfs[candle_tf], price_nd.get(asset, 2))
        path = out_dir / f"candles_{asset}_{candle_tf}.json"
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        log.info("  %s : %d bougies %s -> %s",
                 asset, len(payload), candle_tf, path.name)

    backtest = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "config": config_path,
        "strategy": cfg.strategy.name,
        "params": dict(cfg.strategy.params),
        "candle_timeframe": candle_tf,
        "initial_equity": run.result.initial_equity,
        "risk_pct": cfg.engine.risk_pct,
        "assets": list(market),
        "metrics": {k: _round(v, 6) if isinstance(v, float) else v
                    for k, v in run.metrics.to_dict().items()},
        "equity": _series_payload(equity.resample("1D").last().dropna()),
        "drawdown": _drawdown_payload(equity),
        "monthly": _monthly_payload(equity, run.result.initial_equity),
        "trades": _trades_payload(trades),
    }
    (out_dir / "backtest.json").write_text(
        json.dumps(backtest, separators=(",", ":"), default=str), encoding="utf-8"
    )
    log.info("  backtest.json : %d trades, %d points d'equity",
             len(backtest["trades"]), len(backtest["equity"]))

    macro = _macro_payload(str(cfg.data.start), out_dir, Path(cfg.fetch.out_dir))
    (out_dir / "macro.json").write_text(
        json.dumps(macro, separators=(",", ":"), default=str), encoding="utf-8"
    )
    log.info("  macro.json : %d séries", len(macro.get("series", {})))

    return backtest


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="goldsilver-dashboard-cache",
        description="Génère le cache JSON du dashboard (backtest + macro).",
    )
    p.add_argument("-c", "--config", default="config/breakout_4h.yaml")
    p.add_argument("-o", "--out", default=DEFAULT_OUT)
    p.add_argument("--timeframe", default="4h",
                   help="timeframe des bougies du chart (défaut : 4h)")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(levelname)-7s %(message)s"
    )
    bt = build(args.config, Path(args.out), args.timeframe)
    m = bt["metrics"]
    print(f"\n✅ Cache écrit dans {args.out}/")
    print(f"   {m['n_trades']} trades — rendement total "
          f"{100 * m['total_return']:.1f} % — DD max {100 * m['max_drawdown']:.1f} %")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
