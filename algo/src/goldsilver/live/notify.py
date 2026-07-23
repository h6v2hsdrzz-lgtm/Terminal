"""Alertes Telegram. Identifiants en variables d'environnement uniquement :

  TELEGRAM_BOT_TOKEN  : jeton du bot (via @BotFather)
  TELEGRAM_CHAT_ID    : id du chat destinataire

Sans ces variables, le notifier est un no-op silencieux (log warning au
démarrage) : l'absence de Telegram ne doit jamais empêcher le bot de
fonctionner ni, surtout, de S'ARRÊTER proprement.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request

log = logging.getLogger(__name__)


class TelegramNotifier:
    def __init__(self, enabled: bool = True, timeout_s: float = 10.0) -> None:
        self._token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        self._chat = os.environ.get("TELEGRAM_CHAT_ID", "")
        self.active = bool(enabled and self._token and self._chat)
        self._timeout = timeout_s
        if enabled and not self.active:
            log.warning(
                "Telegram désactivé : TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID absents"
            )

    def send(self, text: str) -> bool:
        """Envoie le message ; n'échoue JAMAIS bruyamment (best-effort)."""
        if not self.active:
            return False
        url = f"https://api.telegram.org/bot{self._token}/sendMessage"
        data = urllib.parse.urlencode(
            {"chat_id": self._chat, "text": text[:4000]}
        ).encode()
        try:
            with urllib.request.urlopen(
                urllib.request.Request(url, data=data), timeout=self._timeout
            ) as resp:
                return bool(json.loads(resp.read().decode()).get("ok"))
        except Exception as exc:  # noqa: BLE001 — la notif ne doit rien casser
            log.error("Telegram échec: %s", exc)
            return False
