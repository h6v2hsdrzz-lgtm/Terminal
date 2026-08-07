"""Export d'un HTML autonome : le dashboard dans UN fichier, sans serveur.

Utilité : consulter l'état de l'algo sur un téléphone, l'archiver avec un
rapport, ou l'envoyer par mail. Tout est embarqué (CSS, JS, bibliothèque de
chart, données) — le fichier s'ouvre hors connexion.

C'est un INSTANTANÉ : les boutons d'action et le rafraîchissement automatique
se désactivent d'eux-mêmes (cf. ``OFFLINE()`` dans app.js). Pour du temps
réel, lancer le serveur.
"""

from __future__ import annotations

import json
from pathlib import Path

from goldsilver.dashboard.data import DashboardData

STATIC = Path(__file__).parent / "static"


def _payload(dash: DashboardData) -> dict:
    return {
        "all": {
            "snapshot": dash.snapshot(),
            "trades": dash.trades(),
            "stats": dash.stats(),
            "macro": dash.macro(),
            "journal": dash.journal(200),
            "analytics": dash.analytics(),
        },
        "candles": {a: dash.candles(a) for a in dash.assets},
    }


def export_html(algo_root: Path, out: Path, live_config: str = "config/live.yaml",
                enable_broker: bool = True) -> Path:
    dash = DashboardData(algo_root, live_config=live_config,
                         enable_broker=enable_broker)
    data = _payload(dash)

    html = (STATIC / "index.html").read_text(encoding="utf-8")
    style = (STATIC / "style.css").read_text(encoding="utf-8")
    app = (STATIC / "app.js").read_text(encoding="utf-8")
    vendor = (STATIC / "vendor" / "lightweight-charts.js").read_text(encoding="utf-8")

    # </script> à l'intérieur d'une chaîne JSON fermerait la balise : on échappe.
    blob = json.dumps(data, ensure_ascii=False, default=str).replace("</", "<\\/")

    html = html.replace(
        '<link rel="stylesheet" href="/static/style.css">',
        f"<style>\n{style}\n</style>",
    )
    html = html.replace(
        '<script src="/static/vendor/lightweight-charts.js"></script>\n'
        '<script src="/static/app.js"></script>',
        f"<script>window.__GS_DATA__ = {blob};</script>\n"
        f"<script>{vendor}</script>\n"
        f"<script>{app}</script>",
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out
