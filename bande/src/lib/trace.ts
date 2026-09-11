/**
 * Le tracé d'une courbe lissée, en SVG.
 *
 * Extrait de `Courbe.tsx` au lot P, quand un deuxième graphique en a eu besoin.
 * Une deuxième copie de ce calcul, c'est la garantie que les deux courbes de la
 * même page ne seront plus lissées pareil dans six mois.
 *
 * Catmull-Rom converti en cubiques : la version naïve plaçait les points de
 * contrôle à mi-chemin en gardant l'ordonnée de départ, ce qui produisait un
 * palier à chaque valeur répétée — une courbe en marches d'escalier là où les
 * données ne font que passer d'un point à l'autre.
 */
export function cheminLisse(points: [number, number][], tension = 0.5): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}
