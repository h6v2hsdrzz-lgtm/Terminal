"""Adaptateur OANDA v20 (REST). Compte practice par défaut.

Identifiants — UNIQUEMENT en variables d'environnement, jamais en dur :
  OANDA_API_TOKEN   : jeton API v20
  OANDA_ACCOUNT_ID  : ex. 101-004-1234567-001
  OANDA_ENV         : "practice" (défaut) | "live"

Sécurité : l'hôte live n'est utilisé que si OANDA_ENV=live ET que le moteur
a passé le verrou LIVE (voir modes.py) — l'adaptateur vérifie la cohérence
au moment de sa construction via ``expected_env``.

Alignement des bougies : dailyAlignment=0, alignmentTimezone=UTC — les H1
d'OANDA tombent alors sur les mêmes bornes que le backtest (resampling UTC).
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import pandas as pd

from goldsilver.live.broker.base import (
    AccountState,
    BrokerAdapter,
    BrokerError,
    BrokerPosition,
    ClosedTrade,
    OrderResult,
    Quote,
)

log = logging.getLogger(__name__)

_HOSTS = {
    "practice": "https://api-fxpractice.oanda.com",
    "live": "https://api-fxtrade.oanda.com",
}
_RETRIES = 3
_BACKOFF_S = 2.0


class OandaBroker(BrokerAdapter):
    name = "oanda"

    def __init__(self, expected_env: str = "practice", timeout_s: float = 20.0) -> None:
        token = os.environ.get("OANDA_API_TOKEN")
        account = os.environ.get("OANDA_ACCOUNT_ID")
        env = os.environ.get("OANDA_ENV", "practice").strip().lower()
        if not token or not account:
            raise BrokerError(
                "OANDA_API_TOKEN et OANDA_ACCOUNT_ID doivent être définis en "
                "variables d'environnement (jamais dans un fichier committé)."
            )
        if env not in _HOSTS:
            raise BrokerError(f"OANDA_ENV={env!r} invalide (practice|live)")
        if env != expected_env:
            raise BrokerError(
                f"Incohérence d'environnement : le moteur attend {expected_env!r} "
                f"mais OANDA_ENV={env!r}. Refus par sécurité."
            )
        self._host = _HOSTS[env]
        self._token = token
        self._account = account
        self._timeout = timeout_s
        self.env = env

    # ------------------------------------------------------------- HTTP bas niveau

    def _request(self, method: str, path: str, params: dict | None = None,
                 body: dict | None = None) -> dict:
        url = self._host + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        last_exc: Exception | None = None
        for attempt in range(_RETRIES + 1):
            req = urllib.request.Request(
                url, data=data, method=method,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="replace")[:400]
                # 4xx = erreur définitive (ordre rejeté, params invalides) :
                # inutile de retenter, on remonte tout de suite.
                if 400 <= exc.code < 500:
                    raise BrokerError(f"OANDA {exc.code} sur {path} : {detail}") from exc
                last_exc = BrokerError(f"OANDA {exc.code} sur {path} : {detail}")
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_exc = exc
            if attempt < _RETRIES:
                delay = _BACKOFF_S * 2**attempt
                log.warning("OANDA %s %s : tentative %d échouée, retry dans %.0f s",
                            method, path, attempt + 1, delay)
                time.sleep(delay)
        raise BrokerError(f"OANDA injoignable après {_RETRIES + 1} tentatives "
                          f"({method} {path}) : {last_exc}")

    # ---------------------------------------------------------------- interface

    def get_candles(self, instrument: str, hours: int) -> pd.DataFrame:
        out = self._request(
            "GET", f"/v3/instruments/{instrument}/candles",
            params={
                "granularity": "H1",
                "count": min(int(hours), 5000),
                "price": "BA",                      # bid + ask
                "dailyAlignment": 0,
                "alignmentTimezone": "UTC",
            },
        )
        rows = []
        for c in out.get("candles", []):
            if not c.get("complete", False):
                continue                             # jamais de bougie en cours
            bid, ask = c["bid"], c["ask"]
            rows.append({
                "time": pd.Timestamp(c["time"]).tz_convert("UTC"),
                "open": float(bid["o"]), "high": float(bid["h"]),
                "low": float(bid["l"]), "close": float(bid["c"]),
                "volume": float(c.get("volume", 0)),
                "spread": max(float(ask["c"]) - float(bid["c"]), 0.0),
            })
        if not rows:
            raise BrokerError(f"OANDA : aucune bougie H1 pour {instrument}")
        return pd.DataFrame(rows).set_index("time").sort_index()

    def get_quote(self, instrument: str) -> Quote:
        out = self._request(
            "GET", f"/v3/accounts/{self._account}/pricing",
            params={"instruments": instrument},
        )
        prices = out.get("prices", [])
        if not prices:
            raise BrokerError(f"OANDA : pas de prix pour {instrument}")
        p = prices[0]
        return Quote(
            instrument=instrument,
            bid=float(p["bids"][0]["price"]),
            ask=float(p["asks"][0]["price"]),
            time=pd.Timestamp(p["time"]).tz_convert("UTC"),
            tradeable=bool(p.get("tradeable", False)),
        )

    def get_account(self) -> AccountState:
        out = self._request("GET", f"/v3/accounts/{self._account}/summary")
        a = out["account"]
        return AccountState(
            equity=float(a["NAV"]),
            balance=float(a["balance"]),
            margin_available=float(a["marginAvailable"]),
            currency=str(a["currency"]),
        )

    def get_open_positions(self) -> list[BrokerPosition]:
        out = self._request("GET", f"/v3/accounts/{self._account}/openTrades")
        positions: list[BrokerPosition] = []
        for t in out.get("trades", []):
            sl = t.get("stopLossOrder", {}).get("price")
            tp = t.get("takeProfitOrder", {}).get("price")
            positions.append(BrokerPosition(
                instrument=str(t["instrument"]),
                units=float(t["currentUnits"]),
                avg_price=float(t["price"]),
                trade_id=str(t["id"]),
                sl=float(sl) if sl else None,
                tp=float(tp) if tp else None,
                unrealized_pnl=float(t.get("unrealizedPL", 0.0)),
            ))
        return positions

    def place_market_order(self, instrument: str, units: float, sl_price: float,
                           tp_price: float, client_tag: str) -> OrderResult:
        precision = 3 if instrument.startswith("XAG") else 2
        body = {
            "order": {
                "type": "MARKET",
                "instrument": instrument,
                "units": str(int(units)) if float(units).is_integer() else f"{units:.1f}",
                "timeInForce": "FOK",
                "positionFill": "DEFAULT",
                "stopLossOnFill": {"price": f"{sl_price:.{precision}f}"},
                "takeProfitOnFill": {"price": f"{tp_price:.{precision}f}"},
                "clientExtensions": {"tag": client_tag[:60]},
            }
        }
        out = self._request("POST", f"/v3/accounts/{self._account}/orders", body=body)
        fill = out.get("orderFillTransaction")
        if fill is not None:
            return OrderResult(
                accepted=True,
                trade_id=str(fill.get("tradeOpened", {}).get("tradeID", "")) or None,
                fill_price=float(fill["price"]),
                units=float(fill["units"]),
                reason="filled",
            )
        cancel = out.get("orderCancelTransaction", {})
        return OrderResult(accepted=False, trade_id=None, fill_price=None,
                           units=units, reason=str(cancel.get("reason", "unknown")))

    def close_position(self, instrument: str) -> OrderResult:
        body_long = {"longUnits": "ALL"}
        body_short = {"shortUnits": "ALL"}
        pos = [p for p in self.get_open_positions() if p.instrument == instrument]
        if not pos:
            return OrderResult(True, None, None, 0.0, "déjà plat")
        body = body_long if pos[0].units > 0 else body_short
        out = self._request(
            "PUT", f"/v3/accounts/{self._account}/positions/{instrument}/close",
            body=body,
        )
        fill = out.get("longOrderFillTransaction") or out.get("shortOrderFillTransaction")
        if fill is not None:
            return OrderResult(True, None, float(fill["price"]),
                               float(fill["units"]), "filled")
        return OrderResult(False, None, None, 0.0, "échec de clôture")

    def get_closed_trades_since(self, since_trade_id: str | None) -> list[ClosedTrade]:
        params = {"state": "CLOSED", "count": 100}
        out = self._request("GET", f"/v3/accounts/{self._account}/trades", params=params)
        closed: list[ClosedTrade] = []
        for t in out.get("trades", []):
            tid = str(t["id"])
            if since_trade_id is not None and int(tid) <= int(since_trade_id):
                continue
            closed.append(ClosedTrade(
                trade_id=tid,
                instrument=str(t["instrument"]),
                units=float(t["initialUnits"]),
                realized_pnl=float(t.get("realizedPL", 0.0)),
                close_price=float(t["averageClosePrice"]) if t.get("averageClosePrice") else None,
                close_time=pd.Timestamp(t["closeTime"]).tz_convert("UTC") if t.get("closeTime") else None,
            ))
        return closed
