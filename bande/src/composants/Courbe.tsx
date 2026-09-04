import { couleurProfil } from "@/lib/couleurs";
import { enTexteCourt } from "@/lib/dates";
import type { Entree, Profil } from "@/lib/types";

/**
 * L'évolution des journées, une ligne par personne.
 *
 * Tracé à la main en SVG plutôt qu'avec une bibliothèque : il fallait des
 * courbes lissées, une grille qui s'efface et des points d'extrémité marqués,
 * et se battre contre les réglages d'une bibliothèque coûtait plus cher que
 * de poser les quarante lignes qui suivent.
 */
export function Courbe({
  entrees,
  profils,
  jours,
  hauteur = 168,
}: {
  entrees: Entree[];
  profils: Profil[];
  jours: string[];
  hauteur?: number;
}) {
  const largeur = 340;
  const marge = { haut: 10, bas: 20, gauche: 18, droite: 6 };

  const x = (index: number) =>
    marge.gauche + (index * (largeur - marge.gauche - marge.droite)) / Math.max(1, jours.length - 1);
  const y = (valeur: number) =>
    marge.haut + (1 - (valeur - 1) / 9) * (hauteur - marge.haut - marge.bas);

  return (
    <svg viewBox={`0 0 ${largeur} ${hauteur}`} className="w-full" role="img"
         aria-label="Évolution du niveau de joie de chaque membre de la bande">
      {/* L'échelle reste 1 → 10, jamais recadrée sur les données : resserrer
          l'axe donnerait à trois points d'écart l'allure d'un précipice. Les
          graduations disent où l'on se situe dans l'échelle entière. */}
      {[1, 4, 7, 10].map((valeur) => (
        <g key={valeur}>
          <line
            x1={marge.gauche} x2={largeur - marge.droite}
            y1={y(valeur)} y2={y(valeur)}
            stroke="var(--trait)" strokeWidth="1"
          />
          <text x={0} y={y(valeur) + 3.5} fontSize="9.5" fill="var(--encre-3)">
            {valeur}
          </text>
        </g>
      ))}

      {profils.map((profil) => {
        const siennes = jours.map((jour) => {
          const e = entrees.find((x) => x.jour === jour && x.profil === profil.id);
          return e ? e.joie : null;
        });

        // Une courbe lissée par des cubiques : les segments droits donnaient
        // un tracé nerveux qui suggérait des ruptures là où il n'y en a pas.
        const points: [number, number][] = [];
        siennes.forEach((valeur, i) => {
          if (valeur !== null) points.push([x(i), y(valeur)]);
        });
        if (points.length === 0) return null;

        // Catmull-Rom converti en cubiques : la version précédente plaçait
        // les points de contrôle à mi-chemin en gardant l'ordonnée de départ,
        // ce qui produisait un palier à chaque valeur répétée — une courbe en
        // marches d'escalier là où la vie ne fait que passer d'un jour à
        // l'autre.
        const tension = 0.5;
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

        const dernier = points[points.length - 1];
        return (
          <g key={profil.id}>
            <path d={d} fill="none" stroke={couleurProfil(profil)} strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={dernier[0]} cy={dernier[1]} r="3.6"
                    fill={couleurProfil(profil)} stroke="var(--surface)" strokeWidth="2" />
          </g>
        );
      })}

      <text x={marge.gauche} y={hauteur - 4} fontSize="10" fill="var(--encre-3)">
        {enTexteCourt(jours[0])}
      </text>
      <text x={largeur - marge.droite} y={hauteur - 4} fontSize="10" fill="var(--encre-3)" textAnchor="end">
        {enTexteCourt(jours[jours.length - 1])}
      </text>
    </svg>
  );
}
