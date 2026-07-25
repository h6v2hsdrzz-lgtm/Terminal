"""Fabrique de clients ccxt, avec proxy, rate-limit et politique de retry.

Note environnement : ccxt crée sa session ``requests`` avec ``trust_env=False``.
Derrière un proxy sortant (cas des environnements CI/agent), il faut donc
transmettre explicitement le proxy, sinon toute requête échoue en NetworkError.
"""

from __future__ import annotations

import os
import time
from typing import Any

from ..utils import get_logger

log = get_logger("data.exchange")


class ExchangeUnavailable(RuntimeError):
    """Aucune source de données n'est joignable."""


def _proxy_from_env() -> str | None:
    for key in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        value = os.environ.get(key)
        if value:
            return value
    return None


def make_exchange(name: str, timeout_ms: int = 30_000, **kwargs: Any):
    """Instancie un exchange ccxt configuré pour les perpétuels USDT."""
    import ccxt

    if not hasattr(ccxt, name):
        raise ValueError(f"Exchange ccxt inconnu : {name!r}")

    params: dict[str, Any] = {
        "enableRateLimit": True,
        "timeout": timeout_ms,
        "options": {"defaultType": "swap"},
    }
    proxy = _proxy_from_env()
    if proxy:
        params["httpsProxy"] = proxy
    params.update(kwargs)

    ex = getattr(ccxt, name)(params)
    return ex


def resolve_exchange(preferred: str, fallbacks: list[str] | None = None, **kwargs: Any):
    """Renvoie le premier exchange réellement joignable (OKX en priorité)."""
    candidates = [preferred] + [f for f in (fallbacks or []) if f != preferred]
    errors: list[str] = []
    for name in candidates:
        try:
            ex = make_exchange(name, **kwargs)
            ex.load_markets()
            log.info("Source de données : %s (%d marchés)", name, len(ex.markets))
            return ex
        except Exception as exc:  # noqa: BLE001 - on veut le message brut
            msg = f"{name}: {type(exc).__name__}: {str(exc)[:160]}"
            errors.append(msg)
            log.warning("Exchange indisponible — %s", msg)
    raise ExchangeUnavailable("Aucun exchange joignable :\n  " + "\n  ".join(errors))


def call_with_retry(fn, *args, max_retries: int = 6, backoff: list[int] | None = None, **kwargs):
    """Retry avec backoff exponentiel sur erreurs réseau / rate limit."""
    import ccxt

    backoff = backoff or [2, 4, 8, 16, 32, 60]
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            return fn(*args, **kwargs)
        except (ccxt.NetworkError, ccxt.RateLimitExceeded, ccxt.ExchangeNotAvailable) as exc:
            last_exc = exc
            wait = backoff[min(attempt, len(backoff) - 1)]
            log.warning(
                "Requête échouée (%s) tentative %d/%d, nouvelle tentative dans %ds",
                type(exc).__name__, attempt + 1, max_retries, wait,
            )
            time.sleep(wait)
        except ccxt.BadSymbol:
            raise
    raise ExchangeUnavailable(f"Échec après {max_retries} tentatives : {last_exc}")
