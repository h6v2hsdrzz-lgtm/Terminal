"""Adaptateur IG Markets (API REST). Compte DÉMO par défaut.

Identifiants — UNIQUEMENT en variables d'environnement, jamais en dur :
  IG_API_KEY     : clé API (My IG > Paramètres > API)
  IG_IDENTIFIER  : identifiant de connexion
  IG_PASSWORD    : mot de passe
  IG_ENV         : "demo" (défaut) | "live"
  IG_ACCOUNT_ID  : optionnel — sinon le compte "préféré" est utilisé

Particularités IG gérées ici :
- Session v2 : POST /session renvoie les jetons CST / X-SECURITY-TOKEN dans
  les EN-TÊTES ; ils signent chaque requête suivante. Un 401 déclenche une
  re-connexion automatique (une seule) puis rejoue la requête.
- Tailles en CONTRATS, pas en onces (or : 1 contrat = 100 oz typiquement).
  L'interface BrokerAdapter parle en ONCES ; la conversion (arrondi au pas,
  minimum) est faite ici via ``IgContractSpec`` — configuré par epic.
- QUOTA de données historiques (~10 000 points/semaine en démo) : les
  bougies sont mises en CACHE local (CSV) et seuls les points manquants
  sont demandés à chaque cycle. Quota dépassé -> BrokerError (le moteur
  saute le cycle sans trader, les SL/TP restent posés côté IG).
- Clôtures : IG n'expose pas un flux simple « mes trades fermés depuis X » ;
  on lit /history/transactions et le marqueur de progression est l'horodatage
  UTC de la transaction (chaîne ISO, ordonnée chronologiquement).
- Prix bid/ask fournis par bougie -> colonne ``spread`` comme au backtest.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Mapping

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
from goldsilver.live.config import IgContractSpec

log = logging.getLogger(__name__)

_HOSTS = {
    "demo": "https://demo-api.ig.com/gateway/deal",
    "live": "https://api.ig.com/gateway/deal",
}
_RETRIES = 3
_BACKOFF_S = 2.0
_PAGE_SIZE = 500


def oz_to_contracts(units_oz: float, spec: IgContractSpec) -> float:
    """Onces (signées) -> contrats IG (valeur absolue), arrondi AU PAS INFÉRIEUR.

    Retourne 0.0 si le résultat est sous ``min_contracts`` (ordre refusé en
    amont plutôt qu'un ordre trop gros : on n'arrondit jamais vers le haut).
    """
    contracts = abs(units_oz) / spec.oz_per_contract
    stepped = math.floor(contracts / spec.contract_step + 1e-9) * spec.contract_step
    if stepped + 1e-9 < spec.min_contracts:
        return 0.0
    return round(stepped, 6)


def parse_pnl(value: str | float | None) -> float:
    """``profitAndLoss`` IG arrive préfixé de la devise (ex. "USD-12.30")."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    m = re.search(r"-?\d+(?:[.,]\d+)?", value.replace(",", ""))
    return float(m.group(0)) if m else 0.0


class IgBroker(BrokerAdapter):
    name = "ig"

    def __init__(
        self,
        expected_env: str = "demo",
        contracts: Mapping[str, IgContractSpec] | None = None,
        cache_dir: Path | None = None,
        timeout_s: float = 20.0,
    ) -> None:
        api_key = os.environ.get("IG_API_KEY")
        identifier = os.environ.get("IG_IDENTIFIER")
        password = os.environ.get("IG_PASSWORD")
        env = os.environ.get("IG_ENV", "demo").strip().lower()
        if not api_key or not identifier or not password:
            raise BrokerError(
                "IG_API_KEY, IG_IDENTIFIER et IG_PASSWORD doivent être définis "
                "en variables d'environnement (jamais dans un fichier committé)."
            )
        if env not in _HOSTS:
            raise BrokerError(f"IG_ENV={env!r} invalide (demo|live)")
        if env != expected_env:
            raise BrokerError(
                f"Incohérence d'environnement : le moteur attend {expected_env!r} "
                f"mais IG_ENV={env!r}. Refus par sécurité."
            )
        self.env = env
        self._host = _HOSTS[env]
        self._api_key = api_key
        self._identifier = identifier
        self._password = password
        self._account_pref = os.environ.get("IG_ACCOUNT_ID")
        self._timeout = timeout_s
        self._contracts = dict(contracts or {})
        self._cache_dir = cache_dir
        # Authentification OAuth v3 : IG rejette le flux v2 (CST/X-SECURITY-TOKEN)
        # pour certains comptes ; v3 (Bearer) fonctionne pour tous. Le compte
        # ciblé est IG_ACCOUNT_ID (obligatoire si le compte par défaut n'est pas
        # celui qu'on veut trader, ex. compte "Investir" par défaut).
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._active_account: str | None = None

    # ------------------------------------------------------------- session/HTTP

    def _login(self) -> None:
        """Ouvre une session OAuth v3 et fixe le compte actif (IG_ACCOUNT_ID)."""
        req = urllib.request.Request(
            self._host + "/session",
            data=json.dumps(
                {"identifier": self._identifier, "password": self._password}
            ).encode(),
            method="POST",
            headers={
                "X-IG-API-KEY": self._api_key,
                "Content-Type": "application/json; charset=UTF-8",
                "Accept": "application/json; charset=UTF-8",
                "Version": "3",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            raise BrokerError(
                f"Connexion IG refusée ({exc.code}) : "
                f"{exc.read().decode(errors='replace')[:300]}"
            ) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise BrokerError(f"IG injoignable à la connexion : {exc}") from exc
        oauth = data.get("oauthToken") or {}
        self._access_token = oauth.get("access_token")
        self._refresh_token = oauth.get("refresh_token")
        if not self._access_token:
            raise BrokerError("IG : jeton OAuth absent de la réponse de session")
        # compte à trader : IG_ACCOUNT_ID prioritaire, sinon compte par défaut
        self._active_account = self._account_pref or data.get("accountId")
        if not self._active_account:
            raise BrokerError("IG : aucun compte cible (définir IG_ACCOUNT_ID)")
        log.info("Session IG OAuth ouverte (%s) — compte actif %s",
                 self.env, self._active_account)

    def _refresh(self) -> bool:
        """Rafraîchit le jeton (v3 expire en ~60 s). True si réussi."""
        if not self._refresh_token:
            return False
        req = urllib.request.Request(
            self._host + "/session/refresh-token",
            data=json.dumps({"refresh_token": self._refresh_token}).encode(),
            method="POST",
            headers={
                "X-IG-API-KEY": self._api_key,
                "Content-Type": "application/json; charset=UTF-8",
                "Accept": "application/json; charset=UTF-8",
                "Version": "1",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                data = json.loads(resp.read().decode())
        except Exception:  # noqa: BLE001 — sur échec on retombera sur un login complet
            return False
        self._access_token = data.get("access_token") or self._access_token
        self._refresh_token = data.get("refresh_token") or self._refresh_token
        return bool(data.get("access_token"))

    def _request(self, method: str, path: str, *, version: str,
                 params: dict | None = None, body: dict | None = None,
                 extra_headers: dict | None = None, _retry_auth: bool = True) -> dict:
        if self._access_token is None:
            self._login()
        url = self._host + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        last_exc: Exception | None = None
        for attempt in range(_RETRIES + 1):
            headers = {
                "X-IG-API-KEY": self._api_key,
                "Authorization": f"Bearer {self._access_token}",
                "IG-ACCOUNT-ID": self._active_account or "",
                "Content-Type": "application/json; charset=UTF-8",
                "Accept": "application/json; charset=UTF-8",
                "Version": version,
                **(extra_headers or {}),
            }
            req = urllib.request.Request(
                url, data=json.dumps(body).encode() if body is not None else None,
                method=method, headers=headers,
            )
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    raw = resp.read().decode()
                    return json.loads(raw) if raw.strip() else {}
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="replace")[:400]
                if exc.code == 401 and _retry_auth:
                    log.info("Jeton IG expiré, rafraîchissement…")
                    if not self._refresh():
                        self._login()
                    return self._request(method, path, version=version,
                                         params=params, body=body,
                                         extra_headers=extra_headers,
                                         _retry_auth=False)
                if 400 <= exc.code < 500:
                    raise BrokerError(f"IG {exc.code} sur {path} : {detail}") from exc
                last_exc = BrokerError(f"IG {exc.code} sur {path} : {detail}")
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_exc = exc
            if attempt < _RETRIES:
                delay = _BACKOFF_S * 2**attempt
                log.warning("IG %s %s : tentative %d échouée, retry dans %.0f s",
                            method, path, attempt + 1, delay)
                time.sleep(delay)
        raise BrokerError(f"IG injoignable après {_RETRIES + 1} tentatives "
                          f"({method} {path}) : {last_exc}")

    # ----------------------------------------------------------------- bougies

    def _cache_path(self, epic: str) -> Path | None:
        if self._cache_dir is None:
            return None
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", epic)
        return self._cache_dir / f"{safe}_H1.csv"

    def _load_cache(self, epic: str) -> pd.DataFrame | None:
        p = self._cache_path(epic)
        if p is None or not p.exists():
            return None
        df = pd.read_csv(p, parse_dates=["time"], index_col="time")
        df.index = (df.index.tz_localize("UTC") if df.index.tz is None
                    else df.index.tz_convert("UTC"))
        return df

    def _fetch_prices(self, epic: str, since: pd.Timestamp,
                      until: pd.Timestamp) -> pd.DataFrame:
        """Récupère les H1 [since, until] en paginant. Consomme le quota IG."""
        rows: list[dict[str, Any]] = []
        page = 1
        while True:
            out = self._request(
                "GET", f"/prices/{epic}", version="3",
                params={
                    "resolution": "HOUR",
                    "from": since.strftime("%Y-%m-%dT%H:%M:%S"),
                    "to": until.strftime("%Y-%m-%dT%H:%M:%S"),
                    "pageSize": _PAGE_SIZE,
                    "pageNumber": page,
                },
            )
            for c in out.get("prices", []):
                op, cl = c.get("openPrice", {}), c.get("closePrice", {})
                hi, lo = c.get("highPrice", {}), c.get("lowPrice", {})
                if op.get("bid") is None or cl.get("bid") is None:
                    continue
                ts = pd.to_datetime(
                    c.get("snapshotTimeUTC") or c.get("snapshotTime"), utc=True
                )
                rows.append({
                    "time": ts,
                    "open": float(op["bid"]), "high": float(hi["bid"]),
                    "low": float(lo["bid"]), "close": float(cl["bid"]),
                    "volume": float(c.get("lastTradedVolume") or 0.0),
                    "spread": max(float(cl.get("ask", cl["bid"])) - float(cl["bid"]), 0.0),
                })
            meta = out.get("metadata", {}).get("pageData", {})
            allowance = out.get("metadata", {}).get("allowance", {})
            if allowance and int(allowance.get("remainingAllowance", 1)) <= 0:
                log.warning("IG : quota de données historiques quasi épuisé "
                            "(reset dans %s s)", allowance.get("allowanceExpiry"))
            if page >= int(meta.get("totalPages", 1)):
                break
            page += 1
        if not rows:
            return pd.DataFrame(
                columns=["open", "high", "low", "close", "volume", "spread"]
            )
        return pd.DataFrame(rows).set_index("time").sort_index()

    def get_candles(self, instrument: str, hours: int) -> pd.DataFrame:
        now = pd.Timestamp.now(tz="UTC")
        cache = self._load_cache(instrument)
        window_start = now - pd.Timedelta(hours=hours)
        if cache is not None and len(cache) and cache.index[-1] >= window_start:
            since = cache.index[-1] + pd.Timedelta(hours=1)
        else:
            since = window_start
        if since < now:
            fresh = self._fetch_prices(instrument, since, now)
            cache = (pd.concat([cache, fresh]) if cache is not None else fresh)
            cache = cache[~cache.index.duplicated(keep="last")].sort_index()
        if cache is None or cache.empty:
            raise BrokerError(f"IG : aucune bougie H1 pour {instrument} "
                              "(quota de données épuisé ?)")
        # jamais de bougie en cours de formation
        cache = cache[cache.index + pd.Timedelta(hours=1) <= now]
        p = self._cache_path(instrument)
        if p is not None:
            cache.to_csv(p, index_label="time")
        return cache.tail(hours)

    # ---------------------------------------------------------------- cotation

    def get_quote(self, instrument: str) -> Quote:
        out = self._request("GET", f"/markets/{instrument}", version="3")
        snap = out.get("snapshot", {})
        bid, offer = snap.get("bid"), snap.get("offer")
        if bid is None or offer is None:
            raise BrokerError(f"IG : pas de cotation pour {instrument}")
        return Quote(
            instrument=instrument,
            bid=float(bid),
            ask=float(offer),
            time=pd.Timestamp.now(tz="UTC"),
            tradeable=str(snap.get("marketStatus", "")) == "TRADEABLE",
        )

    # ------------------------------------------------------------------ compte

    def _account(self) -> dict[str, Any]:
        out = self._request("GET", "/accounts", version="1")
        accounts = out.get("accounts", [])
        if not accounts:
            raise BrokerError("IG : aucun compte accessible avec ces identifiants")
        if self._account_pref:
            for a in accounts:
                if a.get("accountId") == self._account_pref:
                    return a
            raise BrokerError(f"IG : compte {self._account_pref} introuvable")
        for a in accounts:
            if a.get("preferred"):
                return a
        return accounts[0]

    def get_account(self) -> AccountState:
        a = self._account()
        bal = a.get("balance", {})
        balance = float(bal.get("balance", 0.0))
        pnl = float(bal.get("profitLoss", 0.0))
        return AccountState(
            equity=balance + pnl,
            balance=balance,
            margin_available=float(bal.get("available", 0.0)),
            currency=str(a.get("currency", "USD")),
        )

    # --------------------------------------------------------------- positions

    def _spec(self, epic: str) -> IgContractSpec:
        spec = self._contracts.get(epic)
        if spec is None:
            raise BrokerError(
                f"IG : pas de spécification de contrat pour {epic} — la "
                "renseigner dans broker.ig.contracts de config/live.yaml."
            )
        return spec

    def get_open_positions(self) -> list[BrokerPosition]:
        out = self._request("GET", "/positions", version="2")
        positions: list[BrokerPosition] = []
        for entry in out.get("positions", []):
            pos, market = entry.get("position", {}), entry.get("market", {})
            epic = str(market.get("epic", ""))
            spec = self._contracts.get(epic)
            size = float(pos.get("dealSize") or pos.get("size", 0.0))
            sign = 1.0 if str(pos.get("direction")) == "BUY" else -1.0
            units = size * (spec.oz_per_contract if spec else 1.0) * sign
            positions.append(BrokerPosition(
                instrument=epic,
                units=units,
                avg_price=float(pos.get("openLevel", 0.0)),
                trade_id=str(pos.get("dealId", "")),
                sl=float(pos["stopLevel"]) if pos.get("stopLevel") else None,
                tp=float(pos["limitLevel"]) if pos.get("limitLevel") else None,
                unrealized_pnl=0.0,
            ))
        return positions

    # ------------------------------------------------------------------ ordres

    def place_market_order(self, instrument: str, units: float, sl_price: float,
                           tp_price: float, client_tag: str) -> OrderResult:
        spec = self._spec(instrument)
        contracts = oz_to_contracts(units, spec)
        if contracts <= 0:
            return OrderResult(
                False, None, None, units,
                f"taille {abs(units):g} oz < minimum broker "
                f"({spec.min_contracts:g} contrat(s) = "
                f"{spec.min_contracts * spec.oz_per_contract:g} oz)",
            )
        nd = spec.level_decimals
        body = {
            "epic": instrument,
            "expiry": "-",
            "direction": "BUY" if units > 0 else "SELL",
            "size": contracts,
            "orderType": "MARKET",
            "guaranteedStop": False,
            "forceOpen": True,
            "stopLevel": round(sl_price, nd),
            "limitLevel": round(tp_price, nd),
            "currencyCode": "USD",
        }
        out = self._request("POST", "/positions/otc", version="2", body=body)
        ref = out.get("dealReference")
        if not ref:
            return OrderResult(False, None, None, units, "pas de dealReference")
        confirm = self._request("GET", f"/confirms/{ref}", version="1")
        if str(confirm.get("dealStatus")) != "ACCEPTED":
            return OrderResult(False, None, None, units,
                               str(confirm.get("reason", "REJECTED")))
        return OrderResult(
            accepted=True,
            trade_id=str(confirm.get("dealId", "")) or None,
            fill_price=float(confirm["level"]) if confirm.get("level") else None,
            units=math.copysign(contracts * spec.oz_per_contract, units),
            reason="filled",
        )

    def close_position(self, instrument: str) -> OrderResult:
        mine = [p for p in self.get_open_positions() if p.instrument == instrument]
        if not mine:
            return OrderResult(True, None, None, 0.0, "déjà plat")
        p = mine[0]
        spec = self._spec(instrument)
        body = {
            "dealId": p.trade_id,
            "direction": "SELL" if p.units > 0 else "BUY",
            "size": round(abs(p.units) / spec.oz_per_contract, 6),
            "orderType": "MARKET",
        }
        # convention IG : clôture = POST /positions/otc avec l'en-tête _method
        out = self._request("POST", "/positions/otc", version="1", body=body,
                            extra_headers={"_method": "DELETE"})
        ref = out.get("dealReference")
        if not ref:
            return OrderResult(False, None, None, 0.0, "pas de dealReference")
        confirm = self._request("GET", f"/confirms/{ref}", version="1")
        if str(confirm.get("dealStatus")) != "ACCEPTED":
            return OrderResult(False, None, None, 0.0,
                               str(confirm.get("reason", "REJECTED")))
        return OrderResult(True, p.trade_id,
                           float(confirm["level"]) if confirm.get("level") else None,
                           p.units, "filled")

    # ------------------------------------------------------------ réconciliation

    def get_closed_trades_since(self, since_trade_id: str | None) -> list[ClosedTrade]:
        """Transactions de deal clôturées ; marqueur = horodatage UTC ISO."""
        params = {"type": "ALL_DEAL", "pageSize": 50}
        if since_trade_id:
            params["from"] = since_trade_id[:19]
        out = self._request("GET", "/history/transactions", version="2",
                            params=params)
        closed: list[ClosedTrade] = []
        for t in out.get("transactions", []):
            ts_raw = t.get("dateUtc") or t.get("date")
            if not ts_raw:
                continue
            ts = pd.to_datetime(ts_raw, utc=True)
            marker = ts.isoformat()
            if since_trade_id and marker <= since_trade_id:
                continue
            pnl = parse_pnl(t.get("profitAndLoss"))
            if str(t.get("transactionType", "")).upper() not in ("DEAL", "TRADE"):
                continue
            closed.append(ClosedTrade(
                trade_id=marker,
                instrument=str(t.get("instrumentName", "")),
                units=parse_pnl(t.get("size")),
                realized_pnl=pnl,
                close_price=parse_pnl(t.get("closeLevel")) or None,
                close_time=ts,
            ))
        closed.sort(key=lambda c: c.trade_id)
        return closed

    # ------------------------------------------------------------------- outils

    def search_markets(self, term: str) -> list[dict[str, Any]]:
        """Recherche d'epics (``goldsilver-live find-epic or``)."""
        out = self._request("GET", "/markets", version="1",
                            params={"searchTerm": term})
        return [
            {"epic": m.get("epic"), "name": m.get("instrumentName"),
             "type": m.get("instrumentType"), "expiry": m.get("expiry")}
            for m in out.get("markets", [])
        ]
