import { Carte, TitreSection } from "@/composants/Carte";
import { jeuParCle } from "@/lib/jeux/catalogue";
import { enTexteCourt } from "@/lib/dates";

/**
 * Ce que la bande a dit pendant les jeux, et qu'on réécoute.
 *
 * Deux jeux s'enregistrent, et leur intérêt est **entièrement** là : une théorie
 * du complot défendue un samedi soir n'a aucun charme le samedi soir. Elle en a
 * le mardi suivant, dans les souvenirs, quand personne ne s'y attend.
 *
 * Le lecteur est celui du navigateur, sans décor : on vient écouter, pas
 * regarder une forme d'onde.
 */
export function MurDesParoles({
  paroles,
}: {
  paroles: {
    id: string;
    sujet: string;
    duree: number;
    note: number | null;
    creeLe: string;
    jeu: string;
    pseudo: string;
  }[];
}) {
  if (paroles.length === 0) return null;

  return (
    <section className="mt-7">
      <TitreSection>Ce qu&apos;on a dit</TitreSection>
      <Carte className="divide-y divide-trait">
        {paroles.map((parole) => (
          <div key={parole.id} className="p-4">
            <p className="text-[13px] text-encre-3">
              {parole.pseudo} · {jeuParCle(parole.jeu)?.nom ?? parole.jeu} ·{" "}
              {enTexteCourt(parole.creeLe.slice(0, 10))}
            </p>
            <p className="mt-1 text-[16px] font-semibold leading-snug tracking-tight">
              {parole.sujet}
            </p>
            <audio
              controls
              preload="none"
              src={`/api/parole/${parole.id}`}
              className="mt-2.5 w-full"
            />
          </div>
        ))}
      </Carte>
    </section>
  );
}
