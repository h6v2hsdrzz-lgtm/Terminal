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
import urllib.parse
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
# Le poste est en français, le fil doit l'être aussi. La plupart des flux
# RSS des titres financiers français sont fermés (403 ou 404 : Banque de
# France, La Tribune, Boursorama, Zonebourse, Capital…). Deux voies
# restent ouvertes et suffisent :
#
#   — Google News en `hl=fr&gl=FR&ceid=FR:fr`, interrogé par requête
#     thématique. C'est un agrégateur : il renvoie des articles de presse
#     francophone réels (Les Échos, Le Revenu, Gold.fr, Boursorama…) avec
#     leur éditeur dans le titre, ce dont on se sert plus bas.
#   — fr.investing.com, qui publie ses propres dépêches traduites.
#
# Chaque entrée : (source affichée, url, catégorie par défaut).
# Éditeurs francophones dont on veut bien lire les dépêches. La liste sert
# de contrainte `site:` dans la requête : sans elle, « cours de l'or »
# remonte massivement des cotations de détail vietnamiennes et maghrébines
# — francophones, mais sans rapport avec un poste institutionnel.
PUBLISHERS = [
    "lesechos.fr", "investir.lesechos.fr", "boursorama.com", "zonebourse.com",
    "latribune.fr", "lefigaro.fr", "lemonde.fr", "capital.fr", "challenges.fr",
    "agefi.fr", "lerevenu.com", "abcbourse.com", "fr.investing.com",
    "tradingsat.com", "gold.fr", "or.fr", "moneyvox.fr", "lecho.be",
    "trends.levif.be", "letemps.ch", "rtbf.be", "usinenouvelle.com",
]
SITE_FILTER = "(" + " OR ".join("site:" + s for s in PUBLISHERS) + ")"

GN = "https://news.google.com/rss/search?q={}&hl=fr&gl=FR&ceid=FR:fr"


def gn(query: str, days: int = 14) -> str:
    return GN.format(urllib.parse.quote(f"{query} {SITE_FILTER} when:{days}d"))


FEEDS = [
    ("Google Actualités", gn(
        '(or OR argent OR "métaux précieux") (cours OR prix OR marché OR once)'), "metaux"),
    ("Google Actualités", gn(
        '(Fed OR BCE OR "banque centrale" OR "banques centrales") (taux OR réserves OR or)'), "banques-centrales"),
    ("Google Actualités", gn(
        '(inflation OR dollar OR "taux réels" OR obligataire OR emploi OR récession) marchés'), "macro"),
    ("Google Actualités", gn(
        '("valeur refuge" OR géopolitique OR "droits de douane" OR sanctions) marchés'), "geopolitique"),
    ("Google Actualités", gn(
        '("mine d\'or" OR "mines d\'or" OR "production aurifère" OR Barrick OR Newmont OR Agnico) production'), "mines"),
    ("Google Actualités", gn(
        '(UBS OR "Goldman Sachs" OR "JP Morgan" OR "Morgan Stanley" OR "Bank of America" OR HSBC)'
        ' ("l\'or" OR "métaux précieux" OR "once d\'or")', 30), "recherche"),
    ("Investing.com", "https://fr.investing.com/rss/commodities.rss", "metaux"),
    ("Investing.com", "https://fr.investing.com/rss/news_25.rss", "macro"),
    ("Investing.com", "https://fr.investing.com/rss/news_1.rss", "macro"),
]

# Catégories du fil, dans l'ordre d'affichage. Le libellé et la
# description partent d'ici pour que l'écran n'ait rien à réinventer.
CATEGORIES = [
    ("metaux", "Or & Argent", "Ce qui touche directement le cours des métaux."),
    ("banques-centrales", "Banques centrales", "Fed, BCE, taux directeurs, réserves officielles."),
    ("recherche", "Recherche & prévisions", "Notes et objectifs de cours publiés par les banques."),
    ("macro", "Macro & taux", "Inflation, dollar, dette, croissance."),
    ("geopolitique", "Géopolitique & refuge", "Tensions, conflits, droits de douane."),
    ("mines", "Mines & physique", "Production, stocks, demande industrielle."),
]

# Pertinence pour un poste métaux précieux. Volontairement simple et
# transparent : l'interprétation fine est le travail de l'agent, pas
# d'une heuristique. Ce score ne sert qu'à trier et à écarter le bruit.
KEYWORDS = {
    "or ": 2, "l'or": 3, "d'or": 3, "argent métal": 3, "l'argent": 2,
    "métaux précieux": 4, "once": 3, "lingot": 3, "comex": 4, "lbma": 4,
    "gold": 3, "silver": 3, "bullion": 3,
    "banque centrale": 3, "banques centrales": 3, "réserves d'or": 4,
    "fed": 3, "réserve fédérale": 3, "fomc": 3, "powell": 3, "bce": 3, "lagarde": 2,
    "taux directeur": 3, "taux réel": 3, "baisse des taux": 3, "hausse des taux": 3,
    "inflation": 2, "désinflation": 2, "ipc": 2, "obligataire": 2, "rendement": 1,
    "dollar": 2, "dette": 1, "récession": 2, "emploi": 1,
    "etf": 2, "minier": 2, "mine": 1, "extraction": 1,
    "valeur refuge": 4, "refuge": 2, "géopolitique": 2, "tensions": 1,
    "droits de douane": 2, "sanctions": 1, "guerre": 1,
    "ubs": 3, "goldman": 3, "jp morgan": 3, "jpmorgan": 3, "morgan stanley": 3,
    "citi": 2, "hsbc": 2, "bank of america": 3, "société générale": 2, "deutsche bank": 2,
    "prévision": 2, "objectif de cours": 3, "hedge fund": 3, "fonds spéculatif": 3,
}

# Barrière de pertinence. Boursorama et Zonebourse republient l'intégralité
# des fils Reuters : une requête sur l'or ramène aussi les résultats de
# Cloudflare et les rachats d'entreprises. Une dépêche n'entre dans le fil
# que si elle parle du métal, ou d'un moteur reconnu du métal.
# « or » est aussi une conjonction en français : ne jamais le tester seul,
# uniquement dans des tournures où il désigne le métal.
METAL_TERMS = (
    "l'or", "d'or", "or :", "l'argent", "métaux précieux", "métal précieux",
    "once", "lingot", "comex", "lbma", "aurifère", "bullion", "palladium", "platine",
)
DRIVER_TERMS = (
    "fed", "réserve fédérale", "fomc", "powell", "bce", "banque centrale",
    "banques centrales", "taux directeur", "taux réel", "taux d'intérêt",
    "inflation", "désinflation", "obligataire", "treasuries", "rendement",
    "dollar", "valeur refuge", "droits de douane", "récession",
    "emploi américain", "marché du travail", "dette publique",
)
# Dépêches d'entreprise : sans métal explicite, elles n'ont rien à faire ici.
CORPORATE_TERMS = (
    "chiffre d'affaires", "bénéfice", "résultats trimestriels", "rachète",
    "acquisition", "va racheter", "revoit à la hausse ses prévisions",
    "revoit à la baisse", "au sein de sa direction", "actualités bourse",
    "nomme", "recrute", "augmentation de capital", "introduction en bourse",
)

# Reclassement : un titre qui contient l'un de ces motifs part dans la
# catégorie indiquée, quelle que soit la requête qui l'a ramené. Les
# requêtes se recoupent, le classement final doit venir du contenu.
# L'ordre compte : du plus spécifique au plus général. « La banque
# centrale de Chine accroît ses réserves d'or » contient « d'or » et
# « banque centrale » ; c'est une nouvelle de banque centrale, pas une
# nouvelle de cours, et c'est la règle la plus spécifique qui doit gagner.
RECLASS = [
    # Une note de banque, pas une prévision quelconque : le motif exige le
    # nom d'un établissement. « La banque centrale tchèque abaisse ses
    # prévisions » n'est pas de la recherche de marché, et un simple verbe
    # de prévision suffirait à l'y envoyer par erreur.
    ("recherche", ("ubs", "goldman", "jp morgan", "jpmorgan", "morgan stanley",
                   "bank of america", "bofa", "hsbc", "citigroup", "deutsche bank",
                   "société générale", "natixis", "barclays", "macquarie",
                   "bmi", "metals focus", "world gold council", "wgc",
                   "objectif de cours", "relève son objectif", "abaisse son objectif",
                   "note de recherche", "hedge fund", "fonds spéculatif")),
    ("mines", ("mine d'or", "mines d'or", "minier", "minière", "aurifère", "barrick",
               "newmont", "agnico", "gisement", "production d'or", "raffinerie")),
    ("banques-centrales", ("banque centrale", "banques centrales", "réserve fédérale",
                           "fomc", "taux directeur", "powell", "lagarde", "réserves d'or",
                           "hausse des taux", "baisse des taux", "politique monétaire",
                           "fed ", "bce ", "(fed)", "(bce)")),
    ("geopolitique", ("guerre", "conflit", "sanctions", "droits de douane", "tarifs douaniers",
                      "géopolitique", "valeur refuge", "moyen-orient", "tensions commerciales")),
    ("metaux", ("l'or", "d'or", "once d'or", "l'argent", "métaux précieux", "métal précieux",
                "lingot", "comex", "lbma", "or physique", "précieux")),
]

# « Or » est un mot très courant en français, et un adverbe. Ces motifs
# marquent des dépêches qui contiennent le mot sans parler du métal, ou
# des cotations de détail qui n'ont aucune valeur pour un poste. Un seul
# suffit à écarter l'article.
TITLE_REJECT = (
    "prix d'or", "à prix d'or", "en or massif", "médaille d'or", "âge d'or",
    "règle d'or", "but en or", "livre d'or", "palme d'or", "ballon d'or",
    "mine d'informations", "dong vietnamien", " sjc", "or 9999", "or 24k",
    "tour d'horizon de la recherche", "cours du dong",
    "comparaison sectorielle", "santé financière",
    "au sein de sa direction", "actualités bourse", "agenda du",
)

# Éditeurs à écarter : Google News ramène parfois des sites de contenu
# promotionnel sur les requêtes « prix de l'or ».
PUBLISHER_BLOCKLIST = ("achat-or-et-argent", "comparateur", "publi-rédactionnel")


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
    sert qu'à trier et à filtrer le bruit. Le titre pèse double : une
    dépêche qui parle d'or dans son titre parle d'or, une dépêche qui le
    mentionne au détour d'un résumé parle souvent d'autre chose.
    """
    t, s = title.lower(), summary.lower()
    total, hits = 0, []
    for kw, weight in KEYWORDS.items():
        if not weight:
            continue
        if kw in t:
            total += weight * 2
            hits.append(kw)
        elif kw in s:
            total += weight
            hits.append(kw)
    return total, hits[:6]


def relevance(title: str, summary: str) -> tuple[bool, bool, bool]:
    """(parle du métal, parle d'un moteur du métal, dépêche d'entreprise)."""
    blob = f"{title} {summary}".lower().replace("’", "'")
    return (
        any(t in blob for t in METAL_TERMS),
        any(t in blob for t in DRIVER_TERMS),
        any(t in blob for t in CORPORATE_TERMS),
    )


def classify(title: str, summary: str) -> str:
    """Catégorie finale d'une dépêche, déduite de son contenu.

    Elle ne vient délibérément pas de la requête qui a ramené l'article :
    les requêtes se recoupent — « réserves d'or des banques centrales »
    remonte aussi bien sur la requête métaux que sur la requête banques
    centrales — et une catégorie héritée de la requête serait fausse la
    moitié du temps. Sans motif reconnu, l'article part en macro plutôt
    que de gonfler une catégorie à laquelle il n'appartient pas.
    """
    blob = f"{title} {title} {summary}".lower().replace("’", "'")
    for cat, patterns in RECLASS:
        if any(p in blob for p in patterns):
            return cat
    return "macro"


def split_publisher(title: str) -> tuple[str, str | None]:
    """Google News suffixe ses titres par « — Éditeur ».

    On extrait l'éditeur : c'est lui qui compte pour juger d'une source,
    pas « Google Actualités » qui n'est qu'un tuyau.
    """
    for sep in (" - ", " — ", " – "):
        head, _, tail = title.rpartition(sep)
        if head and tail and len(tail) <= 45 and "," not in tail:
            return head.strip(), tail.strip()
    return title, None


def norm_key(title: str) -> str:
    """Clé de dédoublonnage tolérante à la ponctuation et aux accents.

    Le même papier remonte sur plusieurs requêtes avec des apostrophes
    typographiques différentes ; comparer les titres bruts laisserait
    passer les doublons.
    """
    t = title.lower().replace("’", "'")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return " ".join(t.split())[:70]


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

        raw_title = clean(text("title", "atom:title"), 260)
        if not raw_title:
            continue
        title, publisher = split_publisher(raw_title)
        link = text("link", "atom:link") or ""
        summary = clean(text("description", "summary", "atom:summary", "content"), 400)
        # Google News ne fournit pas de vrai résumé : sa description est le
        # titre suivi du nom de l'éditeur, parfois un bloc de liens. Un
        # résumé qui répète le titre n'apporte rien et double la hauteur de
        # chaque ligne du fil.
        if summary and (summary.count("http") > 2 or norm_key(summary).startswith(norm_key(title)[:40])):
            summary = ""
        published = parse_date(text("pubDate", "published", "updated", "dc:date"))
        rank, hits = score(title, summary)
        metal, driver, corporate = relevance(title, summary)
        category = classify(title, summary)
        items.append({
            "title": title,
            "url": link.strip(),
            "source": publisher or source,
            "via": source if publisher else None,
            "category": category,
            # conservé pour le filtre métaux / macro déjà en place
            "scope": "metal" if category in ("metaux", "mines") else "macro",
            "summary": summary,
            "published": published,
            "score": rank,
            "tags": hits,
            "_metal": metal, "_driver": driver, "_corporate": corporate,
        })
    return items


def build_news(limit: int = 140) -> dict:
    seen: set[str] = set()
    items: list[dict] = []
    errors: list[str] = []
    for source, url, scope in FEEDS:
        label = f"{source} · {scope}"
        try:
            got = parse_feed(source, url, scope)
            kept = 0
            for it in got:
                key = norm_key(it["title"])
                low = it["title"].lower().replace("’", "'")
                if key in seen or not key:
                    continue
                if any(b in (it["source"] or "").lower() for b in PUBLISHER_BLOCKLIST):
                    continue
                if any(p in low for p in TITLE_REJECT):
                    continue
                seen.add(key)
                items.append(it)
                kept += 1
            print(f"  RSS  {label:40s} {kept:3d} items")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{label}: {exc}")
            print(f"  RSS  {label:40s} ÉCHEC — {exc}", file=sys.stderr)

    # ── Barrière de pertinence ────────────────────────────────
    # Un article passe s'il parle du métal, ou s'il traite d'un moteur
    # reconnu du métal avec une pertinence nette. Les dépêches
    # d'entreprise sans mention du métal sont écartées : elles ne sont là
    # que parce que Boursorama et Zonebourse republient tout Reuters.
    kept = []
    for it in items:
        # une dépêche d'entreprise ne passe que si le métal est franchement
        # au cœur du sujet — sinon c'est un résultat trimestriel qui a
        # simplement croisé le mot « or »
        if it["_corporate"] and not (it["_metal"] and it["score"] >= 12):
            continue
        if it["_metal"] and it["score"] >= 6:
            kept.append(it)
        elif it["_driver"] and it["score"] >= 12:
            kept.append(it)
    for it in kept:
        for k in ("_metal", "_driver", "_corporate"):
            it.pop(k, None)

    # Classement : la pertinence décide de ce qui entre, la date décide de
    # l'ordre. Trier d'abord par date seule ferait remonter la dépêche la
    # plus récente même si elle est la moins pertinente du lot.
    now = datetime.now(timezone.utc)

    def freshness(it: dict) -> float:
        if not it["published"]:
            return 0.0
        try:
            age = (now - datetime.fromisoformat(it["published"])).total_seconds() / 86400
        except ValueError:
            return 0.0
        return max(0.0, 14.0 - age)      # ~1 point de score par jour de fraîcheur

    kept.sort(key=lambda i: i["score"] + freshness(i), reverse=True)

    # Quota par catégorie : sans lui, « Or & Argent » — la catégorie la
    # plus fournie — mange toute la place et les cinq autres onglets
    # arrivent vides, ce qui ferait mentir le classement.
    per_cat = max(12, limit // 3)
    taken: dict[str, int] = {}
    items = []
    for it in kept:
        c = it["category"]
        if taken.get(c, 0) >= per_cat or len(items) >= limit:
            continue
        taken[c] = taken.get(c, 0) + 1
        items.append(it)
    items.sort(key=lambda i: (i["published"] or ""), reverse=True)

    counts: dict[str, int] = {}
    for it in items:
        counts[it["category"]] = counts.get(it["category"], 0) + 1
    for cat, label, _ in CATEGORIES:
        print(f"  cat  {label:40s} {counts.get(cat, 0):3d}")

    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "categories": [
            {"key": k, "label": lab, "desc": d, "count": counts.get(k, 0)}
            for k, lab, d in CATEGORIES
        ],
        "items": items,
        "errors": errors,
    }


# ══════════════════════════════════════════════════════════════

def write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8")
    print(f"→ {path} ({path.stat().st_size / 1024:.0f} Ko)")


# ══════════════════════════════════════════════════════════════
# Réserves d'or officielles
# ══════════════════════════════════════════════════════════════
#
# Le COT ne voit que le COMEX. Le premier acheteur structurel d'or depuis
# 2022 est ailleurs : les banques centrales, qui achètent en gré à gré et
# déclarent au FMI avec plusieurs mois de retard. Ce bloc n'est donc pas
# décoratif — c'est le moteur que le positionnement des futures ne montre
# jamais.
#
# La source d'origine est la série « World Official Gold Holdings » du
# World Gold Council, compilée à partir des statistiques financières
# internationales du FMI. Son fichier n'est téléchargeable qu'après
# inscription (le lien direct répond 403), et le FMI ne sert pas ces
# séries en accès libre. Le tableau maintenu sur Wikipédia reprend ce
# classement en citant sa date d'arrêté ; c'est la seule voie ouverte, et
# l'écran affiche la provenance sans la maquiller.

WIKI_API = ("https://en.wikipedia.org/w/api.php"
            "?action=parse&page=Gold_reserve&format=json&prop=wikitext")

# Nom anglais du tableau → (nom français, code ISO, latitude, longitude).
# Les coordonnées sont celles de la capitale, ou du siège pour les
# institutions : elles servent uniquement à poser un point sur le globe.
COUNTRY_GEO = {
    "United States": ("États-Unis", "USA", 38.9, -77.0),
    "Germany": ("Allemagne", "DEU", 52.5, 13.4),
    "Italy": ("Italie", "ITA", 41.9, 12.5),
    "France": ("France", "FRA", 48.9, 2.4),
    "Russia": ("Russie", "RUS", 55.8, 37.6),
    "China": ("Chine", "CHN", 39.9, 116.4),
    "Switzerland": ("Suisse", "CHE", 46.9, 7.4),
    "India": ("Inde", "IND", 28.6, 77.2),
    "Japan": ("Japon", "JPN", 35.7, 139.7),
    "Turkey": ("Turquie", "TUR", 39.9, 32.9),
    "Netherlands": ("Pays-Bas", "NLD", 52.4, 4.9),
    "Poland": ("Pologne", "POL", 52.2, 21.0),
    "Taiwan": ("Taïwan", "TWN", 25.0, 121.6),
    "Portugal": ("Portugal", "PRT", 38.7, -9.1),
    "Uzbekistan": ("Ouzbékistan", "UZB", 41.3, 69.2),
    "Saudi Arabia": ("Arabie saoudite", "SAU", 24.7, 46.7),
    "Kazakhstan": ("Kazakhstan", "KAZ", 51.2, 71.4),
    "United Kingdom": ("Royaume-Uni", "GBR", 51.5, -0.1),
    "Lebanon": ("Liban", "LBN", 33.9, 35.5),
    "Spain": ("Espagne", "ESP", 40.4, -3.7),
    "Austria": ("Autriche", "AUT", 48.2, 16.4),
    "Thailand": ("Thaïlande", "THA", 13.8, 100.5),
    "Belgium": ("Belgique", "BEL", 50.8, 4.4),
    "Algeria": ("Algérie", "DZA", 36.8, 3.1),
    "Venezuela": ("Venezuela", "VEN", 10.5, -66.9),
    "Philippines": ("Philippines", "PHL", 14.6, 121.0),
    "Singapore": ("Singapour", "SGP", 1.3, 103.8),
    "Libya": ("Libye", "LBY", 32.9, 13.2),
    "Brazil": ("Brésil", "BRA", -15.8, -47.9),
    "Sweden": ("Suède", "SWE", 59.3, 18.1),
    "South Africa": ("Afrique du Sud", "ZAF", -25.7, 28.2),
    "Mexico": ("Mexique", "MEX", 19.4, -99.1),
    "Iraq": ("Irak", "IRQ", 33.3, 44.4),
    "Greece": ("Grèce", "GRC", 38.0, 23.7),
    "Egypt": ("Égypte", "EGY", 30.0, 31.2),
    "South Korea": ("Corée du Sud", "KOR", 37.6, 127.0),
    "Romania": ("Roumanie", "ROU", 44.4, 26.1),
    "Qatar": ("Qatar", "QAT", 25.3, 51.5),
    "Australia": ("Australie", "AUS", -35.3, 149.1),
    "Indonesia": ("Indonésie", "IDN", -6.2, 106.8),
    "Hungary": ("Hongrie", "HUN", 47.5, 19.0),
    "Kuwait": ("Koweït", "KWT", 29.4, 48.0),
    "Denmark": ("Danemark", "DNK", 55.7, 12.6),
    "Pakistan": ("Pakistan", "PAK", 33.7, 73.1),
    "Argentina": ("Argentine", "ARG", -34.6, -58.4),
    "Belarus": ("Biélorussie", "BLR", 53.9, 27.6),
    "Finland": ("Finlande", "FIN", 60.2, 24.9),
    "Jordan": ("Jordanie", "JOR", 31.9, 35.9),
    "Bolivia": ("Bolivie", "BOL", -16.5, -68.1),
    "Bulgaria": ("Bulgarie", "BGR", 42.7, 23.3),
    "Malaysia": ("Malaisie", "MYS", 3.1, 101.7),
    "Peru": ("Pérou", "PER", -12.0, -77.0),
    "Serbia": ("Serbie", "SRB", 44.8, 20.5),
    "Ukraine": ("Ukraine", "UKR", 50.4, 30.5),
    "Ecuador": ("Équateur", "ECU", -0.2, -78.5),
    "Syria": ("Syrie", "SYR", 33.5, 36.3),
    "Morocco": ("Maroc", "MAR", 34.0, -6.8),
    "Nigeria": ("Nigeria", "NGA", 9.1, 7.4),
    "Czech Republic": ("Tchéquie", "CZE", 50.1, 14.4),
    "Bangladesh": ("Bangladesh", "BGD", 23.8, 90.4),
    "Cyprus": ("Chypre", "CYP", 35.2, 33.4),
    "Ghana": ("Ghana", "GHA", 5.6, -0.2),
    "Cambodia": ("Cambodge", "KHM", 11.6, 104.9),
    "Colombia": ("Colombie", "COL", 4.7, -74.1),
    "Azerbaijan": ("Azerbaïdjan", "AZE", 40.4, 49.9),
    "United Arab Emirates": ("Émirats arabes unis", "ARE", 24.5, 54.4),
    "Mongolia": ("Mongolie", "MNG", 47.9, 106.9),
    "Ireland": ("Irlande", "IRL", 53.3, -6.3),
    "Slovakia": ("Slovaquie", "SVK", 48.1, 17.1),
    "Sri Lanka": ("Sri Lanka", "LKA", 6.9, 79.9),
    "Nepal": ("Népal", "NPL", 27.7, 85.3),
    "Guatemala": ("Guatemala", "GTM", 14.6, -90.5),
    "Tunisia": ("Tunisie", "TUN", 36.8, 10.2),
    "Chile": ("Chili", "CHL", -33.5, -70.7),
    "Canada": ("Canada", "CAN", 45.4, -75.7),
    "Norway": ("Norvège", "NOR", 59.9, 10.8),
    "New Zealand": ("Nouvelle-Zélande", "NZL", -41.3, 174.8),
    # institutions supranationales : sans capitale, mais avec un siège
    "International Monetary Fund": ("Fonds monétaire international", "FMI", 38.9, -77.0),
    "European Central Bank": ("Banque centrale européenne", "BCE", 50.1, 8.7),
    "Bank for International Settlements": ("Banque des règlements internationaux", "BRI", 47.5, 7.6),
}


def parse_reserves() -> dict:
    """Classement des détenteurs officiels d'or, en tonnes."""
    raw = json.loads(fetch(WIKI_API))
    text = raw["parse"]["wikitext"]["*"]

    start = text.find("Top 50 UN countries")
    if start < 0:
        raise ValueError("tableau du classement introuvable")
    start = text.rindex("{|", 0, start)
    table = text[start:text.index("|}", start)]

    # date d'arrêté citée dans la légende du tableau : elle est le seul
    # repère de fraîcheur, ces séries ayant plusieurs mois de retard
    m = re.search(r"rankings \(as of ([^)]+)\)", table)
    as_of = m.group(1).strip() if m else None

    holders, missing = [], []
    for chunk in table.split("|-")[1:]:
        line = chunk.replace("\n", " ")
        cells = [c.strip() for c in line.split("||")]
        if len(cells) < 3:
            continue

        # ── nom du détenteur (2ᵉ cellule) ──
        who = cells[1]
        name = None
        fm = re.search(r"\{\{flag(?:country|icon)?\|\s*([^}|]+)", who)
        if fm:
            name = fm.group(1).strip()
        else:
            # les institutions n'ont pas de drapeau : leur cellule commence
            # par un logo en [[File:…]], et le nom est le lien suivant
            for lm in re.finditer(r"\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]", who):
                cand = lm.group(1).strip()
                if not cand.startswith(("File:", "Image:")):
                    name = cand
                    break
        if not name:
            continue

        # « Euro area » agrège l'Allemagne, la France, l'Italie et les
        # autres membres déjà listés séparément : la garder doublerait
        # 10 800 tonnes sur le total et poserait un point de la taille de
        # l'Europe sur Francfort.
        if name.lower().startswith("euro area"):
            continue

        # ── tonnage (3ᵉ cellule) ── il arrive qu'il soit enveloppé dans
        # un lien wiki, d'où le nettoyage du balisage avant lecture
        plain = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", cells[2])
        tm = re.search(r"([\d,]+(?:\.\d+)?)", plain)
        if not tm:
            continue
        try:
            tonnes = float(tm.group(1).replace(",", ""))
        except ValueError:
            continue

        share = None
        sm = re.search(r"([\d.]+)\s*%", cells[3] if len(cells) > 3 else "")
        if sm:
            share = float(sm.group(1))

        geo = COUNTRY_GEO.get(name)
        if not geo:
            missing.append(name)
            continue
        label, iso, lat, lon = geo
        holders.append({
            "name": label, "en": name, "iso": iso,
            "tonnes": tonnes, "share": share, "lat": lat, "lon": lon,
            "institution": iso in ("FMI", "BCE", "BRI"),
        })

    holders.sort(key=lambda h: -h["tonnes"])
    for i, h in enumerate(holders):
        h["rank"] = i + 1
    if missing:
        print(f"  réserves : {len(missing)} entrées sans coordonnées — {', '.join(missing[:6])}",
              file=sys.stderr)
    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "asOf": as_of,
        "source": "World Gold Council / FMI — International Financial Statistics",
        "via": "https://en.wikipedia.org/wiki/Gold_reserve",
        "holders": holders,
    }


def build_reserves() -> dict:
    try:
        data = parse_reserves()
        tot = sum(h["tonnes"] for h in data["holders"])
        print(f"  réserves : {len(data['holders'])} détenteurs, {tot:,.0f} t, arrêté {data['asOf']}")
        return data
    except Exception as exc:  # noqa: BLE001
        print(f"  réserves : ÉCHEC — {exc}", file=sys.stderr)
        return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "holders": [], "errors": [str(exc)]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="data", help="dossier de sortie (défaut : data)")
    ap.add_argument("--skip-news", action="store_true")
    ap.add_argument("--skip-macro", action="store_true")
    ap.add_argument("--skip-prices", action="store_true")
    ap.add_argument("--skip-reserves", action="store_true")
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
    if not args.skip_reserves:
        print("Réserves officielles (WGC / FMI) :")
        res = build_reserves()
        if not res["holders"]:
            failed.append("reserves")
        else:
            write(out / "reserves.json", res)
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
