#!/usr/bin/env python3
"""Construit `data/land.json` — les contours des continents, une fois.

La vue mondiale a besoin d'un fond de carte. Charger une bibliothèque
cartographique et un TopoJSON depuis un CDN à chaque ouverture de page
serait absurde pour un poste qui tient dans un dépôt statique : le
contour du monde ne change pas.

Ce script décode donc une fois pour toutes le TopoJSON `land-110m` de
Natural Earth (domaine public) en une liste d'anneaux [lon, lat],
simplifiés et arrondis au dixième de degré. Le résultat pèse une
soixantaine de kilo-octets, se lit sans aucune dépendance, et se projette
directement en orthographique côté navigateur.

    python3 scripts/build_land.py [--src land-110m.json] [--out data/land.json]

Source : https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


def decode_arcs(topo: dict) -> list[list[tuple[float, float]]]:
    """Déroule les arcs delta-encodés du TopoJSON en coordonnées absolues."""
    tr = topo["transform"]
    sx, sy = tr["scale"]
    tx, ty = tr["translate"]
    out = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        out.append(pts)
    return out


def ring_of(arc_ids: list[int], arcs: list[list[tuple[float, float]]]) -> list[tuple[float, float]]:
    """Assemble un anneau à partir de ses indices d'arcs.

    Un indice négatif désigne l'arc ~i parcouru à l'envers — c'est la
    convention TopoJSON pour partager un même arc entre deux polygones
    voisins sans le stocker deux fois.
    """
    ring: list[tuple[float, float]] = []
    for i in arc_ids:
        seg = arcs[~i][::-1] if i < 0 else arcs[i]
        ring.extend(seg[1:] if ring else seg)
    return ring


def simplify(ring: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas-Peucker, version courte.

    Sur un globe de 400 pixels, un point tous les dixièmes de degré est
    invisible ; garder tout le détail de Natural Earth ne ferait que
    tripler le poids du fichier.
    """
    if len(ring) < 3:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = ring[a]
        bx, by = ring[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, best_d = -1, tol
        for i in range(a + 1, b):
            px, py = ring[i]
            if norm < 1e-9:
                # Segment dégénéré : sur un anneau fermé, le premier et le
                # dernier point sont confondus, et la « distance à la
                # droite AB » vaut alors zéro partout. C'est le cas au
                # tout premier appel, sur chaque anneau — sans ce test,
                # aucun point ne dépasse jamais la tolérance et le
                # continent entier se réduit à deux points.
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best_d:
                best, best_d = i, d
        if best > 0:
            keep[best] = True
            stack.append((a, best))
            stack.append((best, b))
    return [p for p, k in zip(ring, keep) if k]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="land-110m.json")
    ap.add_argument("--out", default="data/land.json")
    ap.add_argument("--tol", type=float, default=0.35, help="tolérance de simplification, en degrés")
    ap.add_argument("--min-points", type=int, default=6)
    args = ap.parse_args()

    topo = json.loads(Path(args.src).read_text())
    arcs = decode_arcs(topo)
    obj = topo["objects"]["land"]

    geoms = obj["geometries"] if obj["type"] == "GeometryCollection" else [obj]
    rings: list[list[list[float]]] = []
    for g in geoms:
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        for poly in polys:
            for arc_ids in poly:
                ring = simplify(ring_of(arc_ids, arcs), args.tol)
                if len(ring) >= args.min_points:
                    rings.append([[round(x, 2), round(y, 2)] for x, y in ring])

    rings.sort(key=len, reverse=True)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "source": "Natural Earth 110m via world-atlas (domaine public)",
        "rings": rings,
    }, separators=(",", ":")))
    pts = sum(len(r) for r in rings)
    print(f"→ {out} : {len(rings)} anneaux, {pts} points, {out.stat().st_size // 1024} Ko")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
