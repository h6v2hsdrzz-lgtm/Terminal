"use client";

import { useState } from "react";

import { Carte, TitreSection } from "@/composants/Carte";
import { couleurProfil } from "@/lib/couleurs";
import { enTexteCourt } from "@/lib/dates";
import { evolutionDesPoints, joursDe, type Periode } from "@/lib/graphiques";
import { cheminLisse } from "@/lib/trace";
import type { Entree, Profil } from "@/lib/types";

/**
 * L'évolution du classement général.
 *
 * ## Pourquoi des points et pas un rang
 *
 * Un rang saute d'un cran pour un point d'écart : trois lignes qui se croisent
 * toutes les semaines donnent à un coude à coude l'allure d'un renversement. Les
 * points cumulés montent doucement, se rapprochent, s'écartent — c'est ce qui
 * s'est vraiment passé.
 *
 * ## Pourquoi la fenêtre ne remet personne à zéro
 *
 * Regarder les trente derniers jours n'efface pas six mois de journal : les
 * lignes partent de ce que chacun avait déjà. Leur HAUTEUR dit où en est la
 * bande, leur PENTE dit ce qui s'est passé ce mois-ci. Repartir de zéro aurait
 * montré un classement qui n'existe pas.
 *
 * ## Les règles communes (P3)
 *
 * La couleur d'une personne est la même partout · trois lignes au maximum, ce
 * qui tombe bien, la bande en compte trois · courbe lissée · axes discrets ·
 * chiffres en chasse fixe · la valeur au TAP, jamais au survol — un téléphone
 * n'a pas de survol · deux cents pixels de haut, pas plus · un état vide dessiné
 * plutôt qu'un espace blanc.
 */
const PERIODES: { valeur: Periode; nom: string }[] = [
  { valeur: 30, nom: "30 jours" },
  { valeur: 90, nom: "90 jours" },
  { valeur: 0, nom: "Tout" },
];

const HAUTEUR = 190;
const LARGEUR = 340;

export function CourbePoints({
  entrees,
  profils,
  aujourdhui,
  scelles = [],
  parties = [],
}: {
  entrees: Entree[];
  profils: Profil[];
  aujourdhui: string;
  scelles?: { auteurId: string; creeLe: string }[];
  parties?: { membreId: string; jour: string; points: number }[];
}) {
  const [periode, setPeriode] = useState<Periode>(30);
  const [touche, setTouche] = useState<number | null>(null);

  const premier = entrees.length > 0 ? entrees.map((e) => e.jour).sort()[0] : aujourdhui;
  const jours = joursDe(aujourdhui, periode, premier);
  const lignes = evolutionDesPoints(entrees, profils, jours, scelles, parties);

  const totaux = lignes.flatMap((l) => l.valeurs);
  const haut = Math.max(10, ...totaux);
  const bas = Math.min(0, ...totaux);

  const marge = { haut: 12, bas: 22, gauche: 4, droite: 44 };
  const x = (index: number) =>
    marge.gauche + (index * (LARGEUR - marge.gauche - marge.droite)) / Math.max(1, jours.length - 1);
  const y = (valeur: number) =>
    marge.haut + (1 - (valeur - bas) / Math.max(1, haut - bas)) * (HAUTEUR - marge.haut - marge.bas);

  const classement = [...lignes].sort((a, b) => a.place - b.place);

  /**
   * Les prénoms en bout de ligne, écartés de force.
   *
   * Deux personnes au coude à coude — ce qui est le cas normal dans une bande de
   * trois — finissent avec deux courbes à trois pixels l'une de l'autre, et deux
   * prénoms superposés illisibles. On les repousse donc verticalement d'un
   * minimum, du haut vers le bas, sans toucher aux courbes elles-mêmes : c'est
   * l'étiquette qui se déplace, pas la donnée.
   */
  const ECART_MINIMAL = 12;
  const etiquettes = lignes
    .flatMap((ligne) => {
      const profil = profils.find((p) => p.id === ligne.membreId);
      if (!profil) return [];
      return [{ profil, y: y(ligne.valeurs[ligne.valeurs.length - 1]) }];
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < etiquettes.length; i += 1) {
    etiquettes[i].y = Math.max(etiquettes[i].y, etiquettes[i - 1].y + ECART_MINIMAL);
  }
  // Si la pile déborde par le bas, on la remonte en bloc : mieux vaut des
  // étiquettes légèrement décalées vers le haut qu'un prénom sous l'axe.
  const debordement = (etiquettes.at(-1)?.y ?? 0) - (HAUTEUR - marge.bas);
  if (debordement > 0) for (const e of etiquettes) e.y -= debordement;
  const ordonneeDe = new Map(etiquettes.map((e) => [e.profil.id, e.y]));

  return (
    <section className="mt-7">
      <TitreSection>L&apos;évolution du classement</TitreSection>
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
                periode === choix.valeur
                  ? "bg-surface-3 font-semibold text-encre"
                  : "text-encre-3"
              }`}
            >
              {choix.nom}
            </button>
          ))}
        </div>

        {totaux.every((v) => v === 0) ? (
          <p className="py-10 text-center text-[14px] leading-snug text-encre-3">
            Rien à tracer pour l&apos;instant. Les points arrivent en posant des
            journées, en réagissant chez les autres, et en jouant.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
              className="w-full touch-none"
              role="img"
              aria-label="Évolution des points cumulés de chaque membre de la bande"
              onPointerDown={(evenement) => {
                // La valeur au TAP : un téléphone n'a pas de survol, et un
                // graphique dont les chiffres n'apparaissent qu'à la souris ne
                // les montre jamais.
                const cadre = evenement.currentTarget.getBoundingClientRect();
                const part = (evenement.clientX - cadre.left) / cadre.width;
                const index = Math.round(
                  ((part * LARGEUR - marge.gauche) / (LARGEUR - marge.gauche - marge.droite)) *
                    (jours.length - 1),
                );
                setTouche(Math.max(0, Math.min(jours.length - 1, index)));
              }}
            >
              {/* Deux traits, pas une grille : on situe, on ne quadrille pas. */}
              {[bas, haut].map((valeur) => (
                <line
                  key={valeur}
                  x1={marge.gauche}
                  x2={LARGEUR - marge.droite}
                  y1={y(valeur)}
                  y2={y(valeur)}
                  stroke="var(--trait)"
                  strokeWidth="1"
                />
              ))}

              {touche !== null && (
                <line
                  x1={x(touche)}
                  x2={x(touche)}
                  y1={marge.haut}
                  y2={HAUTEUR - marge.bas}
                  stroke="var(--trait-fort)"
                  strokeWidth="1"
                />
              )}

              {lignes.map((ligne) => {
                const profil = profils.find((p) => p.id === ligne.membreId);
                if (!profil) return null;
                const points = ligne.valeurs.map(
                  (valeur, i) => [x(i), y(valeur)] as [number, number],
                );
                const dernier = points[points.length - 1];
                return (
                  <g key={ligne.membreId}>
                    <path
                      d={cheminLisse(points)}
                      fill="none"
                      stroke={couleurProfil(profil)}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {touche !== null && (
                      <circle
                        cx={x(touche)}
                        cy={y(ligne.valeurs[touche])}
                        r="3.4"
                        fill={couleurProfil(profil)}
                        stroke="var(--surface)"
                        strokeWidth="2"
                      />
                    )}
                    {/* Le prénom en bout de ligne plutôt qu'une légende : on
                        suit la courbe du doigt jusqu'à son nom. Un trait fin le
                        rattache à sa courbe quand il a fallu l'écarter. */}
                    {Math.abs((ordonneeDe.get(profil.id) ?? dernier[1]) - dernier[1]) > 2 && (
                      <line
                        x1={dernier[0]}
                        y1={dernier[1]}
                        x2={dernier[0] + 4}
                        y2={ordonneeDe.get(profil.id) ?? dernier[1]}
                        stroke={couleurProfil(profil)}
                        strokeWidth="1"
                        opacity="0.5"
                      />
                    )}
                    <text
                      x={dernier[0] + 6}
                      y={(ordonneeDe.get(profil.id) ?? dernier[1]) + 3.5}
                      fontSize="10.5"
                      fill={couleurProfil(profil)}
                    >
                      {profil.pseudo}
                    </text>
                  </g>
                );
              })}

              <text x={marge.gauche} y={HAUTEUR - 5} fontSize="10" fill="var(--encre-3)">
                {enTexteCourt(jours[0])}
              </text>
              <text
                x={LARGEUR - marge.droite}
                y={HAUTEUR - 5}
                fontSize="10"
                fill="var(--encre-3)"
                textAnchor="end"
              >
                {enTexteCourt(jours[jours.length - 1])}
              </text>
            </svg>

            {touche !== null && (
              <p className="mt-1 text-center text-[12px] text-encre-3">
                {enTexteCourt(jours[touche])} ·{" "}
                {classement
                  .map((ligne) => {
                    const profil = profils.find((p) => p.id === ligne.membreId);
                    return `${profil?.pseudo ?? "?"} ${ligne.valeurs[touche]}`;
                  })
                  .join(" · ")}
              </p>
            )}

            <ul className="mt-3 space-y-1.5 border-t border-trait pt-3">
              {classement.map((ligne) => {
                const profil = profils.find((p) => p.id === ligne.membreId);
                if (!profil) return null;
                return (
                  <li key={ligne.membreId} className="flex items-baseline gap-2 text-[14px]">
                    <span className="chiffres w-8 shrink-0 tabular-nums text-encre-3">
                      {ligne.place}
                      {ligne.place === 1 ? "er" : "e"}
                    </span>
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: couleurProfil(profil) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{profil.pseudo}</span>
                    <span className="chiffres shrink-0 tabular-nums font-semibold">
                      {ligne.total.toLocaleString("fr-FR")}
                      <span className="ml-1 text-[12px] font-normal text-encre-3">pts</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Carte>
    </section>
  );
}
