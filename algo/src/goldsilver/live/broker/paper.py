"""PaperBroker : données de marché réelles, exécution simulée localement.

Phase 1 obligatoire du forward test. Aucun ordre ne quitte la machine :
- les fills d'entrée/sortie utilisent la VRAIE cotation courante (ask pour
  acheter, bid pour vendre) — c'est le point de mesure du slippage réel ;
- les SL/TP sont simulés en rejouant les bougies H1 entre deux cycles,
  avec les mêmes conventions pessimistes que le backtest : SL prioritaire
  si SL et TP touchés dans la même bougie, gap au-delà du SL exécuté au gap ;
- le compte (cash, positions, trades clos) vit dans l'état persistant du
  moteur : un redémarrage reprend exactement où on en était.

Le PaperBroker délègue données/cotations à un adaptateur source (OANDA
practice en pratique) et implémente la même interface que lui : le moteur
ne voit aucune différence entre paper, demo et live.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from goldsilver.live.broker.base import (
    AccountState,
    BrokerAdapter,
    BrokerPosition,
    ClosedTrade,
    OrderResult,
    Quote,
)

log = logging.getLogger(__name__)


def default_paper_state(initial_equity: float) -> dict[str, Any]:
    return {"cash": initial_equity, "positions": {}, "closed": [], "next_id": 1}


class PaperBroker(BrokerAdapter):
    name = "paper"

    def __init__(self, data_source: BrokerAdapter, state: dict[str, Any]) -> None:
        """``state`` : sous-dictionnaire persistant, muté en place."""
        self._src = data_source
        self._s = state

    def bind_state(self, state: dict[str, Any]) -> None:
        """Re-lie le broker au sous-état fraîchement rechargé du disque.

        Le moteur recharge l'état persistant à CHAQUE cycle (le disque fait
        foi) ; sans cette re-liaison, les fills simulés muteraient un
        dictionnaire orphelin et seraient perdus à la sauvegarde.
        """
        self._s = state

    # ------------------------------------------------------------------ données

    def get_candles(self, instrument: str, hours: int) -> pd.DataFrame:
        return self._src.get_candles(instrument, hours)

    def get_quote(self, instrument: str) -> Quote:
        return self._src.get_quote(instrument)

    # ------------------------------------------------------------------- compte

    def get_account(self) -> AccountState:
        equity = float(self._s["cash"])
        for instr, p in self._s["positions"].items():
            q = self.get_quote(instr)
            mark = q.bid if p["units"] > 0 else q.ask
            equity += p["units"] * (mark - p["entry"])
        return AccountState(equity=equity, balance=float(self._s["cash"]),
                            margin_available=equity, currency="USD")

    def get_open_positions(self) -> list[BrokerPosition]:
        out = []
        for instr, p in self._s["positions"].items():
            out.append(BrokerPosition(
                instrument=instr, units=float(p["units"]),
                avg_price=float(p["entry"]), trade_id=str(p["id"]),
                sl=float(p["sl"]), tp=float(p["tp"]),
                unrealized_pnl=0.0,
            ))
        return out

    # ------------------------------------------------------------------- ordres

    def place_market_order(self, instrument: str, units: float, sl_price: float,
                           tp_price: float, client_tag: str) -> OrderResult:
        if instrument in self._s["positions"]:
            return OrderResult(False, None, None, units,
                               "position déjà ouverte (pas de pyramidage)")
        q = self.get_quote(instrument)
        if not q.tradeable:
            return OrderResult(False, None, None, units, "marché fermé")
        fill = q.ask if units > 0 else q.bid
        tid = str(self._s["next_id"])
        self._s["next_id"] += 1
        self._s["positions"][instrument] = {
            "id": tid, "units": float(units), "entry": float(fill),
            "sl": float(sl_price), "tp": float(tp_price),
            "entry_time": q.time.isoformat(), "tag": client_tag,
        }
        log.info("PAPER fill %s %+.1f @ %.3f (sl %.3f, tp %.3f)",
                 instrument, units, fill, sl_price, tp_price)
        return OrderResult(True, tid, float(fill), float(units), "filled")

    def close_position(self, instrument: str) -> OrderResult:
        p = self._s["positions"].get(instrument)
        if p is None:
            return OrderResult(True, None, None, 0.0, "déjà plat")
        q = self.get_quote(instrument)
        px = q.bid if p["units"] > 0 else q.ask
        self._realize(instrument, p, px, q.time, "manual")
        return OrderResult(True, str(p["id"]), float(px), float(p["units"]), "filled")

    def get_closed_trades_since(self, since_trade_id: str | None) -> list[ClosedTrade]:
        out = []
        for c in self._s["closed"]:
            if since_trade_id is not None and int(c["id"]) <= int(since_trade_id):
                continue
            out.append(ClosedTrade(
                trade_id=str(c["id"]), instrument=c["instrument"],
                units=float(c["units"]), realized_pnl=float(c["pnl"]),
                close_price=float(c["exit"]),
                close_time=pd.Timestamp(c["exit_time"]),
            ))
        return out

    # --------------------------------------------------- simulation des SL/TP

    def simulate_fills(self, instrument: str, candles: pd.DataFrame) -> list[ClosedTrade]:
        """Rejoue les bougies H1 depuis l'entrée / le dernier contrôle.

        À appeler par le moteur à chaque cycle, AVANT toute décision, avec
        les bougies fraîchement téléchargées. Conventions identiques au
        backtest : gap d'ouverture au-delà du SL -> exécution à l'ouverture ;
        SL et TP dans la même bougie -> SL (pessimiste).
        """
        p = self._s["positions"].get(instrument)
        if p is None:
            return []
        start = pd.Timestamp(p.get("checked_until") or p["entry_time"]).floor("1h")
        window = candles[candles.index >= start]
        spread = window["spread"] if "spread" in window.columns else None
        for ts, bar in window.iterrows():
            o, h, l = float(bar["open"]), float(bar["high"]), float(bar["low"])
            spr = float(spread.loc[ts]) if spread is not None else 0.0
            units, sl, tp = p["units"], p["sl"], p["tp"]
            exit_px: float | None = None
            reason = ""
            if units > 0:
                if o <= sl:
                    exit_px, reason = o, "sl_gap"
                elif o >= tp:
                    exit_px, reason = o, "tp_gap"
                elif l <= sl:
                    exit_px, reason = sl, "sl"
                elif h >= tp:
                    exit_px, reason = tp, "tp"
            else:
                ao, ah, al = o + spr, h + spr, l + spr
                if ao >= sl:
                    exit_px, reason = ao, "sl_gap"
                elif ao <= tp:
                    exit_px, reason = ao, "tp_gap"
                elif ah >= sl:
                    exit_px, reason = sl, "sl"
                elif al <= tp:
                    exit_px, reason = tp, "tp"
            if exit_px is not None:
                closed = self._realize(instrument, p, exit_px, ts, reason)
                return [closed]
            p["checked_until"] = ts.isoformat()
        return []

    def _realize(self, instrument: str, p: dict[str, Any], px: float,
                 ts: pd.Timestamp, reason: str) -> ClosedTrade:
        pnl = p["units"] * (px - p["entry"])
        self._s["cash"] += pnl
        record = {
            "id": p["id"], "instrument": instrument, "units": p["units"],
            "entry": p["entry"], "exit": float(px), "pnl": float(pnl),
            "entry_time": p["entry_time"], "exit_time": pd.Timestamp(ts).isoformat(),
            "reason": reason, "tag": p.get("tag", ""),
        }
        self._s["closed"].append(record)
        del self._s["positions"][instrument]
        log.info("PAPER close %s @ %.3f (%s) pnl %+.2f", instrument, px, reason, pnl)
        return ClosedTrade(
            trade_id=str(record["id"]), instrument=instrument,
            units=float(record["units"]), realized_pnl=float(pnl),
            close_price=float(px), close_time=pd.Timestamp(ts),
        )
