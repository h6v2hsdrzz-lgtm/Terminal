"""Serveur du dashboard — bibliothèque standard uniquement.

Pourquoi pas Flask/FastAPI : le bot tourne sur un runner GitHub Actions, un
VPS minimal ou un PC quelconque. Ajouter un framework web à ``pyproject``
signifie l'installer partout où le bot tourne, pour une poignée de routes
JSON. ``http.server`` suffit et ne coûte rien.

Sécurité : l'interface expose l'equity, les positions et les identifiants de
trades. Le serveur écoute donc **127.0.0.1 uniquement** par défaut : rien ne
sort de la machine. ``--host 0.0.0.0`` est possible (accès depuis le
téléphone sur le réseau local) mais l'avertissement est explicite.
"""

from __future__ import annotations

import gzip
import json
import logging
import mimetypes
import threading
import webbrowser
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from goldsilver.dashboard.data import DashboardData

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
#: au-delà de cette taille on compresse (les bougies pèsent ~500 Ko en JSON)
GZIP_MIN_BYTES = 4096


class _Handler(BaseHTTPRequestHandler):
    server_version = "goldsilver-dashboard"

    def __init__(self, *args: Any, dash: DashboardData, **kwargs: Any) -> None:
        self.dash = dash
        super().__init__(*args, **kwargs)

    # journalisation silencieuse : le terminal reste lisible
    def log_message(self, fmt: str, *args: Any) -> None:
        log.debug("%s - %s", self.address_string(), fmt % args)

    # ------------------------------------------------------------- primitives

    def _send(self, body: bytes, content_type: str, status: int = 200,
              cache_seconds: int = 0) -> None:
        headers: list[tuple[str, str]] = [("Content-Type", content_type)]
        if "gzip" in self.headers.get("Accept-Encoding", "") and len(body) > GZIP_MIN_BYTES:
            body = gzip.compress(body, compresslevel=6)
            headers.append(("Content-Encoding", "gzip"))
        headers.append(("Content-Length", str(len(body))))
        headers.append((
            "Cache-Control",
            f"max-age={cache_seconds}" if cache_seconds else "no-store",
        ))
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass    # onglet fermé pendant l'envoi : sans conséquence

    def _json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self._send(body, "application/json; charset=utf-8", status)

    def _static(self, rel: str) -> None:
        # empêche toute remontée hors du dossier statique
        target = (STATIC_DIR / rel).resolve()
        if not target.is_file() or STATIC_DIR.resolve() not in target.parents:
            self._json({"error": "not found"}, 404)
            return
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        # la lib de chart est versionnée et immuable : cache long
        cache = 86400 if "vendor" in rel else 0
        self._send(target.read_bytes(), ctype, cache_seconds=cache)

    # ---------------------------------------------------------------- routage

    def do_GET(self) -> None:  # noqa: N802 — imposé par BaseHTTPRequestHandler
        url = urlparse(self.path)
        route = url.path
        query = parse_qs(url.query)
        try:
            if route in ("/", "/index.html"):
                self._static("index.html")
            elif route.startswith("/static/"):
                self._static(route[len("/static/"):])
            elif route == "/api/snapshot":
                self._json(self.dash.snapshot())
            elif route == "/api/trades":
                self._json(self.dash.trades())
            elif route == "/api/candles":
                asset = (query.get("asset") or [self.dash.assets[0]])[0]
                if asset not in self.dash.assets:
                    self._json({"error": f"actif inconnu : {asset}"}, 400)
                else:
                    self._json(self.dash.candles(asset))
            elif route == "/api/stats":
                self._json(self.dash.stats())
            elif route == "/api/analytics":
                self._json(self.dash.analytics())
            elif route == "/api/macro":
                self._json(self.dash.macro())
            elif route == "/api/journal":
                limit = int((query.get("limit") or ["200"])[0])
                self._json(self.dash.journal(max(1, min(limit, 5000))))
            elif route == "/api/all":
                # un seul aller-retour au chargement : moins de latence perçue
                self._json({
                    "snapshot": self.dash.snapshot(),
                    "trades": self.dash.trades(),
                    "stats": self.dash.stats(),
                    "macro": self.dash.macro(),
                    "journal": self.dash.journal(200),
                    "analytics": self.dash.analytics(),
                })
            else:
                self._json({"error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001 — une route qui casse ne doit
            log.exception("route %s", route)          # pas tuer le serveur
            self._json({"error": str(exc)}, 500)

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path != "/api/kill":
            self._json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            # double sécurité : le front exige déjà une confirmation tapée
            if payload.get("confirm") != "KILL":
                self._json({"error": "confirmation manquante"}, 400)
                return
            self._json(self.dash.arm_kill())
        except Exception as exc:  # noqa: BLE001
            log.exception("kill")
            self._json({"error": str(exc)}, 500)


def serve(algo_root: Path, host: str = "127.0.0.1", port: int = 8765,
          live_config: str = "config/live.yaml", enable_broker: bool = True,
          open_browser: bool = True) -> None:
    dash = DashboardData(algo_root, live_config=live_config,
                         enable_broker=enable_broker)
    handler = partial(_Handler, dash=dash)
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True

    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}/"
    print(f"\n  ● Dashboard goldsilver — {url}")
    print(f"    mode {dash.cfg.mode.value} · stratégie {dash.strategy_cfg.strategy.name}"
          f" · risque {100 * dash.cfg.risk.risk_pct:.0f} %/trade")
    if not enable_broker:
        print("    (mode hors-ligne : cache disque, aucun appel IG)")
    if host == "0.0.0.0":
        print("    ⚠ écoute sur TOUTES les interfaces : accessible depuis le "
              "réseau local (equity et positions visibles).")
    print("    Ctrl-C pour arrêter.\n")

    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Dashboard arrêté.")
    finally:
        httpd.server_close()
