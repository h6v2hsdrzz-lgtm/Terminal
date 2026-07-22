"""Backtest bar-par-bar, multi-actifs, à exécution réaliste.

Choix d'exécution (volontairement pessimistes — un backtest doit coûter au
moins aussi cher que le réel) :

- Les signaux sont évalués à la clôture d'une bougie et exécutés à
  l'OUVERTURE de la suivante (aucun trade à la clôture qui a généré le signal).
- Prix BID en données ; les longs paient l'ask (bid + spread) à l'entrée, les
  shorts au débouclage : le spread complet est payé une fois par aller-retour.
  Spread réel par bougie x multiplicateur pessimiste, ou spread fixe.
- Slippage sur toute exécution au marché et sur les stops, jamais en faveur
  du trader. Les TP sont des limites : remplis au prix limite exactement.
- SL et TP touchés dans la même bougie => le SL est réputé touché en premier
  (``intrabar_worst_case``). Gap d'ouverture au-delà du SL => exécution à
  l'ouverture (pire que le stop), comme en réel.
- Swap/financement overnight facturé à l'heure de rollover, triple le
  mercredi (convention métaux : couvre le week-end).
- Une seule position par actif, pas de pyramidage. En cas de sortie dans une
  bougie, pas de ré-entrée dans cette même bougie (conservateur).
- Sizing en % de risque avec plafond de risque cumulé, réduction de
  corrélation or/argent et plafond de levier. Les actifs sont servis dans
  l'ordre de la config (l'or d'abord par défaut).

Approximation assumée : dans une même bougie, les sorties de positions
existantes sont traitées avant les nouvelles entrées (l'ordre réel des
événements intrabar est inconnaissable en OHLC).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Mapping

import numpy as np
import pandas as pd

from goldsilver.config import Config
from goldsilver.engine.sizing import position_size
from goldsilver.engine.trades import Position, Trade

log = logging.getLogger(__name__)


@dataclass
class BacktestResult:
    equity: pd.Series               # equity mark-to-market à chaque clôture
    trades: list[Trade]
    initial_equity: float
    exposure: float                 # fraction des bougies avec >= 1 position
    _frame: pd.DataFrame | None = field(default=None, repr=False)

    @property
    def trades_frame(self) -> pd.DataFrame:
        if self._frame is None:
            self._frame = Trade.to_frame(self.trades)
        return self._frame


@dataclass
class _OpenPosition(Position):
    equity_at_entry: float = 0.0


class Backtester:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.e = cfg.engine
        self.costs = cfg.engine.costs

    # ------------------------------------------------------------------ utils

    def _spread_eff(self, asset: str, df: pd.DataFrame) -> np.ndarray:
        """Spread effectif par bougie (vectorisé)."""
        c = self.costs
        ac = c.per_asset[asset]
        n = len(df)
        if c.spread_mode == "from_data":
            raw = (
                df["spread"].to_numpy(dtype=np.float64)
                if "spread" in df.columns
                else np.full(n, np.nan)
            )
            fallback = ac.fixed_spread
            raw = np.where(np.isnan(raw) | (raw <= 0), fallback, raw)
            return raw * c.pessimistic_spread_mult
        return np.full(n, ac.fixed_spread)

    # ------------------------------------------------------------------- run

    def run(
        self,
        signals: Mapping[str, pd.DataFrame],
        max_bars_held: int | None = None,
        no_trade_before: pd.Timestamp | None = None,
    ) -> BacktestResult:
        cfg, e = self.cfg, self.e
        assets = list(signals)
        arr: dict[str, dict[str, np.ndarray]] = {}
        for a in assets:
            df = signals[a]
            arr[a] = {
                # unité ns explicite : pandas 3 stocke les dates en µs par défaut
                "ts": df.index.as_unit("ns").asi8,
                "o": df["open"].to_numpy(dtype=np.float64),
                "h": df["high"].to_numpy(dtype=np.float64),
                "l": df["low"].to_numpy(dtype=np.float64),
                "c": df["close"].to_numpy(dtype=np.float64),
                "spr": self._spread_eff(a, df),
                "sig": df["signal"].to_numpy(dtype=np.int64),
                "sld": df["sl_dist"].to_numpy(dtype=np.float64),
                "tpd": df["tp_dist"].to_numpy(dtype=np.float64),
            }

        union = arr[assets[0]]["ts"]
        for a in assets[1:]:
            union = np.union1d(union, arr[a]["ts"])
        u_index = pd.DatetimeIndex(union.view("datetime64[ns]")).tz_localize("UTC")
        u_hour = u_index.hour.to_numpy()
        u_wd = u_index.dayofweek.to_numpy()

        def _ptr(ts: np.ndarray) -> np.ndarray:
            p = np.searchsorted(ts, union)
            p_c = np.minimum(p, len(ts) - 1)
            return np.where(ts[p_c] == union, p_c, -1)

        ptr = {a: _ptr(arr[a]["ts"]) for a in assets}
        cs = {a: cfg.data.assets[a].contract_size for a in assets}
        slip = {a: self.costs.per_asset[a].slippage for a in assets}
        swap_l = {a: self.costs.per_asset[a].swap_long for a in assets}
        swap_s = {a: self.costs.per_asset[a].swap_short for a in assets}
        ntb = (
            int(no_trade_before.as_unit("ns").value)
            if no_trade_before is not None
            else None
        )

        cash = e.initial_equity
        positions: dict[str, _OpenPosition | None] = {a: None for a in assets}
        last_close: dict[str, float] = {a: np.nan for a in assets}
        last_spr: dict[str, float] = {a: 0.0 for a in assets}
        equity_arr = np.empty(len(union), dtype=np.float64)
        trades: list[Trade] = []
        last_equity = cash
        exposed_bars = 0
        worst_case = e.intrabar_worst_case

        def _close(a: str, pos: _OpenPosition, px: float, reason: str, ts: pd.Timestamp) -> None:
            nonlocal cash
            pnl_price = pos.units * (px - pos.entry) * cs[a] * pos.side
            cash += pnl_price
            pnl = pnl_price + pos.swap_paid
            trades.append(
                Trade(
                    asset=a, side=pos.side, entry_time=pos.entry_time, exit_time=ts,
                    entry=pos.entry, exit=px, units=pos.units, sl=pos.sl, tp=pos.tp,
                    pnl=pnl,
                    pnl_pct=pnl / pos.equity_at_entry if pos.equity_at_entry > 0 else 0.0,
                    r_multiple=pnl / pos.risk_amount if pos.risk_amount > 0 else 0.0,
                    reason=reason, bars_held=pos.bars_held,
                    swap_paid=pos.swap_paid, risk_amount=pos.risk_amount,
                )
            )
            positions[a] = None

        def _exit_price(
            pos: _OpenPosition, o: float, h: float, l: float, c: float,
            spr: float, sl_pips: float, pre_existing: bool, time_due: bool,
        ) -> tuple[float, str] | None:
            if pos.side > 0:  # sorties au bid
                if pre_existing and o <= pos.sl:
                    return o - sl_pips, "sl"
                if pre_existing and o >= pos.tp:
                    return o, "tp"
                hit_sl, hit_tp = l <= pos.sl, h >= pos.tp
                if hit_sl and hit_tp:
                    return (pos.sl - sl_pips, "sl") if worst_case else (pos.tp, "tp")
                if hit_sl:
                    return pos.sl - sl_pips, "sl"
                if hit_tp:
                    return pos.tp, "tp"
                if time_due:
                    return c - sl_pips, "time"
            else:  # sorties à l'ask = bid + spread
                ao, ah, al, ac_ = o + spr, h + spr, l + spr, c + spr
                if pre_existing and ao >= pos.sl:
                    return ao + sl_pips, "sl"
                if pre_existing and ao <= pos.tp:
                    return ao, "tp"
                hit_sl, hit_tp = ah >= pos.sl, al <= pos.tp
                if hit_sl and hit_tp:
                    return (pos.sl + sl_pips, "sl") if worst_case else (pos.tp, "tp")
                if hit_sl:
                    return pos.sl + sl_pips, "sl"
                if hit_tp:
                    return pos.tp, "tp"
                if time_due:
                    return ac_ + sl_pips, "time"
            return None

        for i in range(len(union)):
            exited_this_bar: set[str] = set()

            # 1) swap + sorties des positions existantes
            for a in assets:
                j = ptr[a][i]
                if j < 0:
                    continue
                A = arr[a]
                last_close[a] = A["c"][j]
                last_spr[a] = A["spr"][j]
                pos = positions[a]
                if pos is None:
                    continue
                pos.bars_held += 1
                if u_hour[i] == self.costs.rollover_hour_utc:
                    per_night = swap_l[a] if pos.side > 0 else swap_s[a]
                    mult = 3.0 if u_wd[i] == self.costs.triple_swap_weekday else 1.0
                    charge = pos.units * cs[a] * per_night * mult
                    cash += charge
                    pos.swap_paid += charge
                time_due = max_bars_held is not None and pos.bars_held >= max_bars_held
                res = _exit_price(
                    pos, A["o"][j], A["h"][j], A["l"][j], A["c"][j], A["spr"][j],
                    slip[a], pre_existing=True, time_due=time_due,
                )
                if res is not None:
                    _close(a, pos, res[0], res[1], u_index[i])
                    exited_this_bar.add(a)

            # 2) entrées à l'ouverture, sur le signal de la bougie précédente
            opened_this_bar: list[str] = []
            for a in assets:
                j = ptr[a][i]
                if j <= 0 or positions[a] is not None or a in exited_this_bar:
                    continue
                sig = int(arr[a]["sig"][j - 1])
                if sig == 0:
                    continue
                if ntb is not None and union[i] < ntb:
                    continue
                sl_dist = float(arr[a]["sld"][j - 1])
                tp_dist = float(arr[a]["tpd"][j - 1])
                same_dir_open = any(
                    p is not None and p.side == sig
                    for b, p in positions.items()
                    if b != a
                )
                open_risk = sum(p.risk_amount for p in positions.values() if p is not None)
                open_notional = sum(
                    p.units * last_close[b] * cs[b]
                    for b, p in positions.items()
                    if p is not None and not np.isnan(last_close[b])
                )
                o = float(arr[a]["o"][j])
                dec = position_size(
                    equity=last_equity,
                    risk_pct=e.risk_pct,
                    sl_dist=sl_dist,
                    price=o,
                    spec=cfg.data.assets[a],
                    risk_factor=e.corr_risk_factor if same_dir_open else 1.0,
                    risk_budget_left=last_equity * e.max_open_risk_pct - open_risk,
                    max_leverage=e.max_leverage,
                    open_notional=open_notional,
                )
                if dec.units <= 0:
                    continue
                spr = float(arr[a]["spr"][j])
                fill = o + spr + slip[a] if sig > 0 else o - slip[a]
                positions[a] = _OpenPosition(
                    asset=a, side=sig, units=dec.units, entry=fill,
                    sl=fill - sig * sl_dist, tp=fill + sig * tp_dist,
                    entry_time=u_index[i], risk_amount=dec.risk_amount,
                    sl_dist=sl_dist, equity_at_entry=last_equity,
                )
                opened_this_bar.append(a)

            # 3) une position ouverte à l'ouverture peut sortir dans la même bougie
            for a in opened_this_bar:
                pos = positions[a]
                if pos is None:
                    continue
                j = ptr[a][i]
                A = arr[a]
                res = _exit_price(
                    pos, A["o"][j], A["h"][j], A["l"][j], A["c"][j], A["spr"][j],
                    slip[a], pre_existing=False, time_due=False,
                )
                if res is not None:
                    _close(a, pos, res[0], res[1], u_index[i])

            # 4) mark-to-market à la clôture
            eq = cash
            any_open = False
            for a in assets:
                pos = positions[a]
                if pos is None or np.isnan(last_close[a]):
                    continue
                any_open = True
                if pos.side > 0:
                    eq += pos.units * (last_close[a] - pos.entry) * cs[a]
                else:
                    eq += pos.units * (pos.entry - (last_close[a] + last_spr[a])) * cs[a]
            exposed_bars += int(any_open)
            equity_arr[i] = eq
            last_equity = eq

        # clôture forcée en fin de données (marque le trade, reason="end")
        for a in assets:
            pos = positions[a]
            if pos is None:
                continue
            px = (
                last_close[a] - slip[a]
                if pos.side > 0
                else last_close[a] + last_spr[a] + slip[a]
            )
            _close(a, pos, px, "end", u_index[-1])
        if len(union):
            eq = cash
            equity_arr[-1] = eq

        equity = pd.Series(equity_arr, index=u_index, name="equity")
        return BacktestResult(
            equity=equity,
            trades=trades,
            initial_equity=e.initial_equity,
            exposure=exposed_bars / len(union) if len(union) else 0.0,
        )
