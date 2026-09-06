"use client";

import { useState } from "react";

import { Carte } from "./Carte";
import { couleurProfil } from "@/lib/couleurs";
import { enHeure, enY, lignes, MAX, MIN, trace, type Axe, type Cadre, type Pouls } from "@/lib/pouls";
import type { Profil } from "@/lib/types";

/**
 * L'évolution du rire et de l'énergie, une couleur par personne.
 *
 * ## Deux onglets plutôt que six courbes
 *
 * Rire et énergie superposés à trois, ça fait six lignes dans deux cents
 * pixels de haut. On n'y lit plus rien, et surtout on ne SAIT plus laquelle
 * est laquelle. Un axe à la fois, trois lignes maximum : c'est la règle du
 * plan, et elle est juste.
 *
 * ## La valeur au tap, jamais au survol
 *
 * On est sur un téléphone. Un point survolé n'existe pas ; un point touché,
 * oui. Le point actif reste affiché jusqu'au suivant plutôt que de disparaître
 * au relâchement — sinon il faut garder le doigt dessus pour lire, et le doigt
 * cache justement ce qu'on lit.
 *
 * ## Le prénom au bout de la ligne
 *
 * Une légende oblige à faire l'aller-retour entre une pastille et une courbe.
 * Le prénom posé à l'extrémité se lit dans le même mouvement que la ligne.
 */
const HAUTEUR = 200;
const LARGEUR = 320;
const MARGE = 14;

export function GraphiquePouls({
  pouls,
  profils,
  aujourdhui,
  jours,
  cadreInitial,
}: {
  pouls: Pouls[];
  profils: Profil[];
  aujourdhui: string;
  /** Les sept derniers jours, du plus ancien au plus récent. */
  jours: string[];
  cadreInitial: Cadre;
}) {
  const [axe, setAxe] = useState<Axe>("rire");
  const [cadre, setCadre] = useState<Cadre>(cadreInitial);
  const [actif, setActif] = useState<{ membreId: string; y: number; quand: string } | null>(null);

  const tracees = lignes(pouls, axe, cadre, aujourdhui, jours);

  // L'abscisse : les heures du jour, ou le rang des sept jours.
  const bornes =
    cadre === "journee"
      ? { min: 6, max: 24 }
      : { min: 0, max: Math.max(1, jours.length - 1) };
  const enX = (x: number) => {
    const utile = LARGEUR - 2 * MARGE - 28; // 28 px réservés au prénom.
    const part = (x - bornes.min) / (bornes.max - bornes.min || 1);
    return MARGE + Math.min(1, Math.max(0, part)) * utile;
  };

  const parId = new Map(profils.map((p) => [p.id, p]));

  return (
    <Carte className="p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-1" role="tablist" aria-label="Ce qu'on regarde">
          {(["rire", "energie"] as const).map((cle) => (
            <button
              key={cle}
              type="button"
              role="tab"
              aria-selected={axe === cle}
              onClick={() => {
                setAxe(cle);
                setActif(null);
              }}
              className={`cible-tactile rounded-[var(--radius-pilule)] px-3 py-1.5 text-[13px] font-semibold ${
                axe === cle ? "bg-surface-3 text-encre" : "text-encre-3"
              }`}
            >
              {cle === "rire" ? "Rire" : "Énergie"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setCadre(cadre === "journee" ? "semaine" : "journee");
            setActif(null);
          }}
          className="text-[12px] text-encre-3 underline underline-offset-2"
        >
          {cadre === "journee" ? "7 jours" : "aujourd'hui"}
        </button>
      </div>

      {tracees.length === 0 ? (
        <p className="px-1 py-8 text-center text-[14px] leading-snug text-encre-3">
          {cadre === "journee"
            ? "Aucun pouls aujourd'hui. Deux curseurs au-dessus, et la courbe démarre."
            : "Pas encore de pouls cette semaine."}
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
          className="block w-full"
          style={{ maxHeight: HAUTEUR }}
          role="img"
          aria-label={`Évolution ${axe === "rire" ? "du rire" : "de l'énergie"}, ${
            cadre === "journee" ? "aujourd'hui" : "sur sept jours"
          }`}
        >
          {/* Trois repères, pas une grille : une grille lourde se lit avant
              les courbes, et ce sont les courbes qu'on est venu voir. */}
          {[MIN, (MIN + MAX) / 2, MAX].map((valeur) => (
            <g key={valeur}>
              <line
                x1={MARGE}
                y1={enY(valeur, HAUTEUR, MARGE)}
                x2={LARGEUR - MARGE}
                y2={enY(valeur, HAUTEUR, MARGE)}
                stroke="var(--trait)"
                strokeWidth="0.5"
              />
              <text
                x={2}
                y={enY(valeur, HAUTEUR, MARGE) + 3}
                fontSize="9"
                fill="var(--encre-3)"
                className="chiffres"
              >
                {valeur}
              </text>
            </g>
          ))}

          {tracees.map((ligne) => {
            const profil = parId.get(ligne.membreId);
            if (!profil) return null;
            const couleur = couleurProfil(profil);
            const points = ligne.points.map((p) => ({
              x: enX(p.x),
              y: enY(p.y, HAUTEUR, MARGE),
              brut: p,
            }));
            const dernier = points[points.length - 1];
            return (
              <g key={ligne.membreId}>
                <path
                  d={trace(points)}
                  fill="none"
                  stroke={couleur}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {points.map((p) => (
                  <circle
                    key={p.brut.quand}
                    cx={p.x}
                    cy={p.y}
                    r={
                      actif?.membreId === ligne.membreId && actif.quand === p.brut.quand ? 5 : 3
                    }
                    fill={couleur}
                    // Une cible tactile ne fait pas trois pixels : le cercle
                    // visible reste petit, celui qu'on touche est large.
                    stroke="transparent"
                    strokeWidth="16"
                    onClick={() =>
                      setActif({ membreId: ligne.membreId, y: p.brut.y, quand: p.brut.quand })
                    }
                  />
                ))}
                <text
                  x={Math.min(dernier.x + 6, LARGEUR - 4)}
                  y={dernier.y + 3}
                  fontSize="10"
                  fontWeight="600"
                  fill={couleur}
                >
                  {profil.pseudo.slice(0, 4)}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      <p className="mt-1.5 min-h-[18px] px-1 text-[12px] text-encre-3" aria-live="polite">
        {actif
          ? `${parId.get(actif.membreId)?.pseudo ?? ""} · ${actif.y
              .toFixed(1)
              .replace(".", ",")} · ${
              cadre === "journee" ? enHeure(actif.quand) : actif.quand
            }`
          : tracees.length > 0
            ? "Touche un point pour lire sa valeur."
            : ""}
      </p>
    </Carte>
  );
}
