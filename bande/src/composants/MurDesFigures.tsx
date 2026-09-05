import { Carte } from "./Carte";
import { FigureDuJour } from "./FigureDuJour";
import { enTexteCourt } from "@/lib/dates";
import type { Entree, Profil } from "@/lib/types";

/**
 * Les dernières figures, côte à côte.
 *
 * C'est là que le concept prend son sens : une figure seule est un dessin,
 * trente figures alignées sont une année. On y voit ce qu'aucune courbe ne
 * montre — les semaines où la bande était au diapason, celles où l'un
 * décrochait, les trous où personne n'a rien posé.
 *
 * Aucun chiffre n'apparaît. C'est délibéré : la grille se lit d'un coup d'œil,
 * et la traduire en notes reviendrait à en refaire un tableau de scores.
 */
const PAR_DEFAUT = 28;

export function MurDesFigures({
  entrees,
  profils,
  combien = PAR_DEFAUT,
}: {
  /** Toutes les entrées de la bande, tous jours confondus. */
  entrees: Entree[];
  profils: Profil[];
  combien?: number;
}) {
  // Un jour par figure, du plus récent au plus ancien. On ne comble pas les
  // jours sans personne : une grille de vides serait un reproche, et l'écran
  // en fait déjà assez sans compter les absences.
  const parJour = new Map<string, Entree[]>();
  for (const entree of entrees) {
    const jour = parJour.get(entree.jour);
    if (jour) jour.push(entree);
    else parJour.set(entree.jour, [entree]);
  }

  const jours = [...parJour.keys()].sort().reverse().slice(0, combien).reverse();
  if (jours.length < 3) return null;

  return (
    <Carte className="p-4">
      <ul className="grid grid-cols-7 gap-1.5">
        {jours.map((jour) => {
          const duJour = parJour.get(jour) ?? [];
          const notes = new Map<string, number | null>(
            profils.map((p) => [p.id, duJour.find((e) => e.profil === p.id)?.joie ?? null]),
          );
          const complet = duJour.length === profils.length;
          return (
            <li key={jour} title={enTexteCourt(jour)} className="grid place-items-center">
              <FigureDuJour profils={profils} notes={notes} taille={44} libelles={false} />
              <span className="sr-only">
                {enTexteCourt(jour)}
                {complet ? ", tout le monde a posé" : `, ${duJour.length} sur ${profils.length}`}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[12px] leading-snug text-encre-3">
        Une forme par jour : un sommet par personne, tiré vers l&apos;extérieur par sa
        journée. Pleine quand vous étiez d&apos;accord, penchée quand l&apos;un de vous
        vivait autre chose.
      </p>
    </Carte>
  );
}
