#!/usr/bin/env python3
"""Rafraîchit les instantanés de données servis au navigateur.

Le poste `positions.html` interroge la CFTC en direct (son API autorise le
CORS), mais les autres sources utiles — FRED pour la macro, LBMA pour les
fixings, les flux RSS pour les news — ne renvoient pas d'en-tête
`Access-Control-Allow-Origin`. Un navigateur ne peut donc pas les lire
depuis une page GitHub Pages.

Plutôt que d'introduire un backend ou un proxy CORS tiers (fragile, et qui
verrait passer tout le trafic), ce script tourne dans GitHub Actions et
dépose trois fichiers JSON statiques dans `data/`. Le site reste
entièrement statique ; seule la fraîcheur dépend du cron.

    python3 scripts/refresh_data.py [--out data] [--skip-news]
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree

UA = "bullion-desk/1.0 (+https://github.com/; static data snapshot)"
TIMEOUT = 60

# ── Macro : séries FRED ──────────────────────────────────────
# `id` est le code FRED, `sign` indique le sens attendu pour l'or
# (-1 : une hausse de la série pèse sur l'or), utilisé par l'écran macro
# pour colorer le régime sans le recoder côté navigateur.
FRED_SERIES = [
    ("DFII10", "Taux réel 10 ans (TIPS)", "%", -1, "Le coût d'opportunité de détenir un actif sans rendement. Le premier moteur de l'or."),
    ("DFII5", "Taux réel 5 ans (TIPS)", "%", -1, "Version courte du taux réel, plus sensible aux virages de la Fed."),
    ("T10YIE", "Point mort d'inflation 10 ans", "%", 1, "Inflation anticipée par le marché obligataire."),
    ("DTWEXBGS", "Dollar — indice large (Fed)", "idx", -1, "L'or est coté en dollars : un dollar fort le comprime mécaniquement."),
    ("DGS10", "Rendement 10 ans", "%", -1, "Taux nominal de référence."),
    ("DGS2", "Rendement 2 ans", "%", -1, "Le plus lié aux anticipations de taux directeurs."),
    ("T10Y2Y", "Pente 10 ans − 2 ans", "%", 1, "Pentification = anticipation d'assouplissement, historiquement porteur."),
    ("DFF", "Taux effectif des Fed funds", "%", -1, "Le taux directeur réellement pratiqué."),
    ("GVZCLS", "Volatilité implicite de l'or (GVZ)", "idx", 0, "Le « VIX de l'or » : mesure du stress sur le métal lui-même."),
    ("VIXCLS", "VIX", "idx", 1, "Stress actions ; les pics soutiennent la demande de refuge."),
    ("BAMLH0A0HYM2", "Spread high yield", "%", 1, "Appétit pour le risque de crédit ; son écartement accompagne les fuites vers la qualité."),
    ("WALCL", "Bilan de la Fed", "M$", 1, "Liquidité banque centrale."),
    ("RRPONTSYD", "Reverse repo overnight", "Md$", 0, "Liquidité stérilisée au bilan de la Fed."),
    ("M2SL", "Masse monétaire M2", "Md$", 1, "Création monétaire, moteur de long terme."),
    ("CPIAUCSL", "IPC (indice)", "idx", 1, "Inflation réalisée."),
    ("UNRATE", "Taux de chômage", "%", 1, "Le second mandat de la Fed."),
]

# ── News : flux RSS ──────────────────────────────────────────
# Chaque entrée : (source affichée, url, portée). La portée sert au tri
# et au filtrage côté écran — « metal » pour ce qui touche directement les
# métaux, « macro » pour le contexte de taux et de banques centrales.
FEEDS = [
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml", "macro"),
    ("BCE", "https://www.ecb.europa.eu/rss/press.html", "macro"),
    ("WSJ Markets", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "macro"),
    ("Investing — matières premières", "https://www.investing.com/rss/commodities.rss", "metal"),
    ("Google News — or", "https://news.google.com/rss/search?q=gold+price+OR+%22gold+market%22&hl=en-US&gl=US&ceid=US:en", "metal"),
    ("Google News — argent", "https://news.google.com/rss/search?q=%22silver+price%22+OR+%22silver+market%22&hl=en-US&gl=US&ceid=US:en", "metal"),
    ("Google News — banques centrales", "https://news.google.com/rss/search?q=%22central+bank%22+gold+reserves+OR+%22Federal+Reserve%22+rate+decision&hl=en-US&gl=US&ceid=US:en", "macro"),
    ("Google News — COMEX", "https://news.google.com/rss/search?q=COMEX+gold+OR+silver+inventories+OR+%22managed+money%22&hl=en-US&gl=US&ceid=US:en", "metal"),
]

KEYWORDS = {
    "gold": 3, "silver": 3, "bullion": 3, "comex": 3, "lbma": 3, "precious metal": 3,
    "or ": 0, "argent": 0,
    "fed": 2, "federal reserve": 2, "fomc": 2, "powell": 2, "ecb": 2, "central bank": 2,
    "inflation": 2, "cpi": 2, "rate cut": 2, "rate hike": 2, "yield": 1, "treasury": 1,
    "dollar": 1, "tariff": 1, "recession": 1, "etf": 1, "mining": 1, "safe haven": 2,
}


def fetch(url: str, *, binary: bool = False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read()
    return raw if binary else raw.decode("utf-8", "replace")


# ══════════════════════════════════════════════════════════════
# Macro
# ══════════════════════════════════════════════════════════════

def thin(obs: list[tuple[str, float]], daily_days: int = 750) -> list[tuple[str, float]]:
    """Garde le détail quotidien récent et un point hebdomadaire au-delà.

    Sans cet amincissement une série FRED quotidienne depuis 2004 pèse
    plusieurs centaines de kilo-octets ; l'écran n'a besoin de finesse que
    sur la période récente, l'historique lointain ne sert qu'aux
    corrélations hebdomadaires.
    """
    if not obs:
        return obs
    cutoff = (date.today() - timedelta(days=daily_days)).isoformat()
    out: list[tuple[str, float]] = []
    last_week: tuple[int, int] | None = None
    for d, v in obs:
        if d >= cutoff:
            out.append((d, v))
            continue
        iso = date.fromisoformat(d).isocalendar()
        week = (iso[0], iso[1])
        if week != last_week:
            out.append((d, v))
            last_week = week
    return out


def fred_series(series_id: str, start: str = "2004-01-01") -> list[tuple[str, float]]:
    """Observations FRED via l'export CSV public (pas de clé API).

    Une seule série par requête : l'export multi-séries renvoie une archive
    ZIP, inexploitable telle quelle.
    """
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start}"
    text = fetch(url)
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    out: list[tuple[str, float]] = []
    for row in rows[1:]:
        if len(row) < 2 or row[1] in ("", "."):
            continue
        try:
            out.append((row[0], float(row[1])))
        except ValueError:
            continue
    return out


def build_macro() -> dict:
    series: dict[str, dict] = {}
    errors: list[str] = []
    for sid, label, unit, sign, desc in FRED_SERIES:
        try:
            obs = thin(fred_series(sid))
            if not obs:
                errors.append(f"{sid}: série vide")
                continue
            series[sid] = {
                "label": label, "unit": unit, "sign": sign, "desc": desc,
                "last": obs[-1][1], "lastDate": obs[-1][0],
                "obs": [[d, round(v, 4)] for d, v in obs],
            }
            print(f"  FRED {sid:14s} {len(obs):5d} obs  dernier {obs[-1][0]} = {obs[-1][1]}")
        except Exception as exc:  # noqa: BLE001 — un flux mort ne doit pas tout arrêter
            errors.append(f"{sid}: {exc}")
            print(f"  FRED {sid:14s} ÉCHEC — {exc}", file=sys.stderr)
    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Federal Reserve Bank of St. Louis (FRED)",
        "series": series,
        "errors": errors,
    }


# ══════════════════════════════════════════════════════════════
# Prix — fixings LBMA
# ══════════════════════════════════════════════════════════════

def lbma(url: str) -> list[tuple[str, float]]:
    """Fixings LBMA : [{"d": "2026-08-06", "v": [USD, GBP, EUR]}, …]."""
    data = json.loads(fetch(url))
    out: list[tuple[str, float]] = []
    for row in data:
        d = row.get("d")
        vals = row.get("v") or []
        if not d or not vals or vals[0] is None:
            continue
        try:
            out.append((d, float(vals[0])))
        except (TypeError, ValueError):
            continue
    out.sort()
    return out


def weekly(obs: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Un point par semaine ISO (le dernier fixing de la semaine)."""
    buckets: dict[tuple[int, int], tuple[str, float]] = {}
    for d, v in obs:
        iso = date.fromisoformat(d).isocalendar()
        buckets[(iso[0], iso[1])] = (d, v)
    return [buckets[k] for k in sorted(buckets)]


def build_prices() -> dict:
    out: dict[str, dict] = {}
    errors: list[str] = []
    sources = {
        "gold": ("https://prices.lbma.org.uk/json/gold_pm.json", "LBMA Gold Price PM (USD/oz)"),
        "silver": ("https://prices.lbma.org.uk/json/silver.json", "LBMA Silver Price (USD/oz)"),
    }
    for key, (url, label) in sources.items():
        try:
            obs = lbma(url)
            recent_cut = (date.today() - timedelta(days=1095)).isoformat()
            daily = [(d, v) for d, v in obs if d >= recent_cut]
            hist = weekly([(d, v) for d, v in obs if d >= "1986-01-01"])
            out[key] = {
                "label": label,
                "last": obs[-1][1], "lastDate": obs[-1][0],
                "daily": [[d, round(v, 4)] for d, v in daily],
                "weekly": [[d, round(v, 4)] for d, v in hist],
            }
            print(f"  LBMA {key:8s} {len(daily):5d} quotidiens + {len(hist)} hebdo  dernier {obs[-1][0]} = {obs[-1][1]}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{key}: {exc}")
            print(f"  LBMA {key:8s} ÉCHEC — {exc}", file=sys.stderr)
    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "London Bullion Market Association — fixings quotidiens",
        "metals": out,
        "errors": errors,
    }


# ══════════════════════════════════════════════════════════════
# News
# ══════════════════════════════════════════════════════════════

TAG_RE = re.compile(r"<[^>]+>")


def clean(text: str | None, limit: int = 400) -> str:
    if not text:
        return ""
    text = TAG_RE.sub(" ", text)
    text = (text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " "))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def parse_date(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat(timespec="seconds")
        except ValueError:
            continue
    return None


def score(title: str, summary: str) -> tuple[int, list[str]]:
    """Pertinence grossière pour un poste métaux précieux.

    Volontairement simple et transparent : l'interprétation fine est le
    travail de l'agent IA, pas d'une heuristique de mots-clés. Ce score ne
    sert qu'à trier et à filtrer le bruit.
    """
    blob = f"{title} {summary}".lower()
    total, hits = 0, []
    for kw, weight in KEYWORDS.items():
        if weight and kw in blob:
            total += weight
            hits.append(kw)
    return total, hits[:6]


def parse_feed(source: str, url: str, scope: str) -> list[dict]:
    xml = fetch(url)
    root = ElementTree.fromstring(xml.encode("utf-8", "replace"))
    ns = {"atom": "http://www.w3.org/2005/Atom", "dc": "http://purl.org/dc/elements/1.1/"}
    items: list[dict] = []

    nodes = root.iter("item")
    entries = list(nodes)
    if not entries:
        entries = list(root.iter("{http://www.w3.org/2005/Atom}entry"))

    for node in entries:
        def text(*names: str) -> str | None:
            for n in names:
                el = node.find(n) if not n.startswith("{") else node.find(n)
                if el is None:
                    el = node.find(n, ns)
                if el is not None:
                    if el.text:
                        return el.text
                    if el.get("href"):
                        return el.get("href")
            return None

        title = clean(text("title", "atom:title"), 260)
        if not title:
            continue
        link = text("link", "atom:link") or ""
        summary = clean(text("description", "summary", "atom:summary", "content"), 400)
        published = parse_date(text("pubDate", "published", "updated", "dc:date"))
        rank, hits = score(title, summary)
        items.append({
            "title": title, "url": link.strip(), "source": source, "scope": scope,
            "summary": summary, "published": published, "score": rank, "tags": hits,
        })
    return items


def build_news(limit: int = 70) -> dict:
    seen: set[str] = set()
    items: list[dict] = []
    errors: list[str] = []
    for source, url, scope in FEEDS:
        try:
            got = parse_feed(source, url, scope)
            kept = 0
            for it in got:
                key = it["title"].lower()[:90]
                if key in seen:
                    continue
                seen.add(key)
                items.append(it)
                kept += 1
            print(f"  RSS  {source:34s} {kept:3d} items")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{source}: {exc}")
            print(f"  RSS  {source:34s} ÉCHEC — {exc}", file=sys.stderr)

    # les dépêches sans pertinence métaux ni macro ne servent qu'à diluer
    items = [i for i in items if i["score"] > 0]
    items.sort(key=lambda i: (i["published"] or "", i["score"]), reverse=True)
    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "items": items[:limit],
        "errors": errors,
    }


# ══════════════════════════════════════════════════════════════

def write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8")
    print(f"→ {path} ({path.stat().st_size / 1024:.0f} Ko)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="data", help="dossier de sortie (défaut : data)")
    ap.add_argument("--skip-news", action="store_true")
    ap.add_argument("--skip-macro", action="store_true")
    ap.add_argument("--skip-prices", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)

    failed = []
    if not args.skip_macro:
        print("Macro (FRED) :")
        macro = build_macro()
        if not macro["series"]:
            failed.append("macro")
        else:
            write(out / "macro.json", macro)
    if not args.skip_prices:
        print("Prix (LBMA) :")
        prices = build_prices()
        if not prices["metals"]:
            failed.append("prices")
        else:
            write(out / "prices.json", prices)
    if not args.skip_news:
        print("News (RSS) :")
        news = build_news()
        if not news["items"]:
            failed.append("news")
        else:
            write(out / "news.json", news)

    if failed:
        print(f"Aucune donnée récupérée pour : {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
