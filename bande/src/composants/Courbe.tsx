"use client";

import { useState } from "react";

import { couleurProfil } from "@/lib/couleurs";
import { cheminLisse } from "@/lib/trace";
import { enTexteCourt } from "@/lib/dates";
import type { Entree, Profil } from "@/lib/types";

/**
 * L'évolution des journées, une ligne par personne.
 *
 * Tracé à la main en SVG plutôt qu'avec une bibliothèque : il fallait des
 * courbes lissées, une grille qui s'efface et des points d'extrémité marqués,
 * et se battre contre les réglages d'une bibliothèque coûtait plus cher que
 * de poser les quarante lignes qui suivent.
 *
 * La valeur s'affiche au TAP depuis le lot P, comme sur les deux graphiques du
 * profil : un téléphone n'a pas de survol, et un chiffre qui n'apparaît qu'à la
 * souris ne s'affiche jamais.
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

  const [touche, setTouche] = useState<number | null>(null);

  const x = (index: number) =>
    marge.gauche + (index * (largeur - marge.gauche - marge.droite)) / Math.max(1, jours.length - 1);
  const y = (valeur: number) =>
    marge.haut + (1 - (valeur - 1) / 9) * (hauteur - marge.haut - marge.bas);

  const lues =
    touche === null
      ? []
      : profils.flatMap((profil) => {
          const e = entrees.find((x) => x.jour === jours[touche] && x.profil === profil.id);
          return e ? [{ pseudo: profil.pseudo, joie: e.joie }] : [];
        });

  return (
    <>
    <svg viewBox={`0 0 ${largeur} ${hauteur}`} className="w-full touch-none" role="img"
         aria-label="Évolution du niveau de joie de chaque membre de la bande"
         onPointerDown={(evenement) => {
           const cadre = evenement.currentTarget.getBoundingClientRect();
           const part = (evenement.clientX - cadre.left) / cadre.width;
           const index = Math.round(
             ((part * largeur - marge.gauche) / (largeur - marge.gauche - marge.droite)) *
               (jours.length - 1),
           );
           setTouche(Math.max(0, Math.min(jours.length - 1, index)));
         }}>
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

      {touche !== null && (
        <line x1={x(touche)} x2={x(touche)} y1={marge.haut} y2={hauteur - marge.bas}
              stroke="var(--trait-fort)" strokeWidth="1" />
      )}

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

        // Le lissage vit dans `lib/trace.ts` depuis le lot P : deux graphiques
        // de la même page s'en servent, et deux copies finiraient par ne plus
        // lisser pareil.
        const d = cheminLisse(points);

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

    {touche !== null && (
      <p className="mt-1 text-center text-[12px] text-encre-3">
        {enTexteCourt(jours[touche])}
        {lues.length === 0
          ? " · personne n'a posé ce jour-là"
          : ` · ${lues.map((l) => `${l.pseudo} ${l.joie}`).join(" · ")}`}
      </p>
    )}
    </>
  );
}
