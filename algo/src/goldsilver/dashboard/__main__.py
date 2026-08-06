"""Point d'entrée : ``python -m goldsilver.dashboard``.

    python -m goldsilver.dashboard                 # ouvre le navigateur
    python -m goldsilver.dashboard --offline       # sans appel IG (cache seul)
    python -m goldsilver.dashboard --host 0.0.0.0  # accès depuis le téléphone
    python -m goldsilver.dashboard --export out.html   # fichier autonome
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="goldsilver-dashboard",
        description="Dashboard temps réel de l'algo (positions, stats, macro).",
    )
    p.add_argument("-c", "--config", default="config/live.yaml")
    p.add_argument("--root", default=".", help="dossier algo/ (défaut : courant)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--offline", action="store_true",
                   help="n'interroge pas IG : cache disque uniquement")
    p.add_argument("--no-browser", action="store_true")
    p.add_argument("--export", metavar="FICHIER",
                   help="écrit un HTML autonome (consultable sans serveur) "
                        "au lieu de démarrer le serveur")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-7s %(name)s: %(message)s",
    )
    root = Path(args.root).resolve()

    if args.export:
        from goldsilver.dashboard.export import export_html
        out = export_html(root, Path(args.export), live_config=args.config,
                          enable_broker=not args.offline)
        print(f"✅ HTML autonome écrit : {out} ({out.stat().st_size / 1e6:.1f} Mo)")
        return 0

    from goldsilver.dashboard.server import serve
    serve(root, host=args.host, port=args.port, live_config=args.config,
          enable_broker=not args.offline, open_browser=not args.no_browser)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
