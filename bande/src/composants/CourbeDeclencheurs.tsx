"use client";

import { useState } from "react";

import { Carte, TitreSection } from "@/composants/Carte";
import { enTexteCourt, moisEnTexte } from "@/lib/dates";
import { declencheursDansLeTemps, joursDe, SEUIL_MOYENNE, type Periode } from "@/lib/graphiques";
import type { Entree } from "@/lib/types";

/**
 * Les déclencheurs dans le temps.
 *
 * ## Des barres, et pas des courbes
 *
 * Trois courbes de plus sur la même page que le classement se liraient comme
 * trois personnes de plus. Des barres par semaine, dans des couleurs qui
 * n'appartiennent à personne (`--serie-*`), disent tout de suite qu'on parle
 * d'autre chose. Et c'est aussi la forme juste : on compte des occurrences, pas
 * une grandeur continue — un biberon le mardi et un le jeudi, ce n'est pas une
 * pente entre les deux.
 *
 * ## Et la moyenne se tait quand elle n'a rien à dire
 *
 * Sous cinq journées, un tiret. « 8,4 sur deux journées » a l'air d'un résultat
 * et n'en est pas un : c'est le genre de chiffre qu'on répète à table six mois
 * plus tard en croyant qu'il voulait dire quelque chose.
 */
const PERIODES: { valeur: Periode; nom: string }[] = [
  { valeur: 30, nom: "30 jours" },
  { valeur: 90, nom: "90 jours" },
  { valeur: 0, nom: "Tout" },
];

const HAUTEUR = 150;
const LARGEUR = 340;

export function CourbeDeclencheurs({
  entrees,
  declencheurs,
  aujourdhui,
}: {
  entrees: Entree[];
  declencheurs: { id: string; nom: string; emoji: string }[];
  aujourdhui: string;
}) {
  const [periode, setPeriode] = useState<Periode>(90);
  const [touche, setTouche] = useState<number | null>(null);

  // Trois séries au maximum : c'est la règle commune des graphiques, et au-delà
  // les barres d'une semaine deviennent des traits.
  const retenus = declencheurs.slice(0, 3);
  const premier = entrees.length > 0 ? entrees.map((e) => e.jour).sort()[0] : aujourdhui;
  const jours = joursDe(aujourdhui, periode, premier);
  const { periodes: semaines, pas, series } = declencheursDansLeTemps(
    entrees,
    // Les identifiants, pas les noms : une entrée ne porte que des
    // identifiants, et comparer sur le nom rend toutes les séries à zéro.
    retenus.map((d) => d.id),
    jours,
  );

  const haut = Math.max(1, ...series.flatMap((s) => s.parSemaine));
  const marge = { haut: 10, bas: 20, gauche: 4, droite: 4 };
  const large = (LARGEUR - marge.gauche - marge.droite) / Math.max(1, semaines.length);
  // Deux pixels d'écart entre deux périodes, le reste pour les trois barres :
  // au pas du mois, chaque groupe est large ; à la semaine sur trois mois, il
  // fait cinq pixels, et les fixer à deux les faisait déborder sur le voisin.
  const barre = Math.max(1.2, (large - 2) / retenus.length);
  const y = (valeur: number) =>
    marge.haut + (1 - valeur / haut) * (HAUTEUR - marge.haut - marge.bas);

  const rien = series.every((s) => s.parSemaine.every((n) => n === 0));

  return (
    <section className="mt-7">
      <TitreSection>Les déclencheurs dans le temps</TitreSection>
      <Carte className="p-4">
        <div className="mb-3 flex gap-1.5">
          {PERIODES.map((choix) => (
            <button
              key={choix.nom}
              type="button"
              onClick={() => {
                setPeriode(choix.valeur);
                setTouche(null);
              }}
              aria-pressed={periode === choix.valeur}
              className={`cible-tactile rounded-full px-3 py-1.5 text-[13px] transition ${
                periode === choix.valeur ? "bg-surface-3 font-semibold text-encre" : "text-encre-3"
              }`}
            >
              {choix.nom}
            </button>
          ))}
        </div>

        {rien ? (
          <p className="py-8 text-center text-[14px] leading-snug text-encre-3">
            Aucun déclencheur coché sur cette période. Ils se cochent le soir, en
            posant sa journée — et ne rien cocher est une réponse aussi.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
              className="w-full touch-none"
              role="img"
              aria-label="Occurrences de chaque déclencheur, par semaine"
              onPointerDown={(evenement) => {
                const cadre = evenement.currentTarget.getBoundingClientRect();
                const part = (evenement.clientX - cadre.left) / cadre.width;
                const index = Math.floor((part * LARGEUR - marge.gauche) / large);
                setTouche(Math.max(0, Math.min(semaines.length - 1, index)));
              }}
            >
              <line
                x1={marge.gauche}
                x2={LARGEUR - marge.droite}
                y1={y(0)}
                y2={y(0)}
                stroke="var(--trait)"
                strokeWidth="1"
              />

              {semaines.map((lundi, s) => (
                <g key={lundi}>
                  {touche === s && (
                    <rect
                      x={marge.gauche + s * large}
                      y={marge.haut}
                      width={large}
                      height={HAUTEUR - marge.haut - marge.bas}
                      fill="var(--surface-2)"
                    />
                  )}
                  {series.map((serie, i) => {
                    const valeur = serie.parSemaine[s];
                    if (valeur === 0) return null;
                    return (
                      <rect
                        key={serie.declencheur}
                        x={marge.gauche + s * large + 2 + i * barre}
                        y={y(valeur)}
                        width={Math.max(1.5, barre - 1)}
                        height={y(0) - y(valeur)}
                        rx={Math.min(2, barre / 2)}
                        fill={`var(--serie-${i + 1})`}
                      />
                    );
                  })}
                </g>
              ))}

              {/* La valeur la plus haute, annoncée une fois : sans elle on ne
                  sait pas si la plus grande barre vaut trois ou trente. */}
              <line
                x1={marge.gauche}
                x2={LARGEUR - marge.droite}
                y1={y(haut)}
                y2={y(haut)}
                stroke="var(--trait)"
                strokeWidth="1"
              />
              <text
                x={LARGEUR - marge.droite}
                y={y(haut) - 3}
                fontSize="9.5"
                fill="var(--encre-3)"
                textAnchor="end"
              >
                {haut} par {pas}
              </text>

              <text x={marge.gauche} y={HAUTEUR - 5} fontSize="10" fill="var(--encre-3)">
                {pas === "mois" ? moisEnTexte(semaines[0]) : enTexteCourt(semaines[0])}
              </text>
              <text
                x={LARGEUR - marge.droite}
                y={HAUTEUR - 5}
                fontSize="10"
                fill="var(--encre-3)"
                textAnchor="end"
              >
                {pas === "mois"
                  ? moisEnTexte(semaines[semaines.length - 1])
                  : enTexteCourt(semaines[semaines.length - 1])}
              </text>
            </svg>

            {touche !== null && (
              <p className="mt-1 text-center text-[12px] text-encre-3">
                {pas === "mois"
                  ? moisEnTexte(semaines[touche])
                  : `semaine du ${enTexteCourt(semaines[touche])}`}{" "}
                ·{" "}
                {series
                  .map((serie) => {
                    const nom = retenus.find((d) => d.id === serie.declencheur)?.nom ?? "?";
                    return `${nom} ${serie.parSemaine[touche]}`;
                  })
                  .join(" · ")}
              </p>
            )}
          </>
        )}

        {/* Les trois pastilles : la note moyenne des journées où chacun était
            là. C'est la seule chose de ce graphique qui parle de la JOIE, et
            elle se tait plutôt que de mentir. */}
        <ul className="mt-3 flex flex-wrap gap-2 border-t border-trait pt-3">
          {series.map((serie, i) => {
            const declencheur = retenus.find((d) => d.id === serie.declencheur);
            return (
              <li
                key={serie.declencheur}
                className="flex items-baseline gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[13px]"
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 self-center rounded-full"
                  style={{ background: `var(--serie-${i + 1})` }}
                />
                <span aria-hidden>{declencheur?.emoji ?? ""}</span>
                <span className="text-encre-2">{declencheur?.nom ?? serie.declencheur}</span>
                {serie.moyenne === null ? (
                  <span className="chiffres text-encre-3" title="pas assez de données">
                    —
                  </span>
                ) : (
                  <span className="chiffres font-semibold tabular-nums">
                    {serie.moyenne.toFixed(1).replace(".", ",")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {series.some((s) => s.moyenne === null) && (
          <p className="mt-2 text-[12px] leading-snug text-encre-3">
            Un tiret veut dire « pas assez de données » : sous {SEUIL_MOYENNE} journées,
            une moyenne ne raconte que le hasard.
          </p>
        )}
      </Carte>
    </section>
  );
}
