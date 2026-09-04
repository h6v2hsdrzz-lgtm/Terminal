import { couleurJoie } from "@/lib/couleurs";
import { decaler, jourSemaine } from "@/lib/dates";
import type { Entree } from "@/lib/types";

/**
 * Dix semaines, une case par jour, teintée par la moyenne du jour.
 *
 * Les cases sont de taille fixe : laissées élastiques, la grille devenait
 * deux fois plus haute que les cartes voisines et cassait le rythme de la
 * page.
 */
export function Calendrier({
  entrees,
  jusquA,
  semaines = 10,
}: {
  entrees: Entree[];
  jusquA: string;
  semaines?: number;
}) {
  const parJour = new Map<string, number[]>();
  for (const e of entrees) {
    if (!parJour.has(e.jour)) parJour.set(e.jour, []);
    parJour.get(e.jour)!.push(e.joie);
  }

  // On remonte jusqu'au lundi qui ouvre la première semaine affichée.
  const finSemaine = (jourSemaine(jusquA) + 6) % 7;
  const debut = decaler(jusquA, -(semaines - 1) * 7 - finSemaine);

  const cases: { jour: string; moyenne: number | null }[] = [];
  for (let i = 0; i < semaines * 7; i += 1) {
    const jour = decaler(debut, i);
    if (jour > jusquA) break;
    const scores = parJour.get(jour);
    cases.push({
      jour,
      moyenne: scores ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
    });
  }

  return (
    <div
      className="grid grid-flow-col justify-start gap-[3px]"
      style={{ gridAutoColumns: "13px", gridTemplateRows: "repeat(7, 13px)" }}
    >
      {cases.map(({ jour, moyenne }) => (
        <span
          key={jour}
          title={moyenne === null ? `${jour} — personne` : `${jour} — ${moyenne.toFixed(1)}`}
          className="h-[13px] w-[13px] rounded-[3px]"
          style={{
            background: moyenne === null ? "var(--surface-2)" : couleurJoie(moyenne),
            boxShadow: moyenne === null ? "inset 0 0 0 1px var(--trait)" : undefined,
          }}
        />
      ))}
    </div>
  );
}
