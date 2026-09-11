import Link from "next/link";
import { notFound } from "next/navigation";

import { Carte } from "@/composants/Carte";
import { CarteEntree } from "@/composants/CarteEntree";
import { aDejaPose, entreesDuJour, masquerEntree } from "@/lib/depot";
import { enTexteLongAvecAnnee, jourDeLaBande } from "@/lib/dates";
import { exigerContexte } from "@/lib/repaire";

/**
 * Une journée de la bande, seule sur son écran.
 *
 * Elle existe pour deux raisons, et les deux sont du lot Q :
 *
 * · **la recherche** a besoin d'un endroit où emmener. Faire défiler le fil
 *   jusqu'au 14 mars n'est pas un résultat de recherche, c'est une punition ;
 * · **les liens profonds** ont besoin d'une adresse. Une notification
 *   « Sam a posé sa journée » qui ouvre l'accueil n'ouvre rien du tout.
 *
 * Le voile s'applique ici comme ailleurs, et pour la même raison : sans lui,
 * il suffirait de taper l'adresse du jour pour lire tout le monde avant
 * d'écrire.
 */
export default async function Page({ params }: { params: Promise<{ jour: string }> }) {
  const { jour } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) notFound();

  const contexte = await exigerContexte();
  const aujourdhui = jourDeLaBande();
  const annuaire = { profils: contexte.profils, declencheurs: contexte.declencheurs };

  const entrees = await entreesDuJour(contexte.groupe.id, jour);
  const jaiPose = await aDejaPose(contexte.groupe.id, contexte.moi.id, aujourdhui);
  // Seule la journée EN COURS se voile. Le passé est déjà partagé.
  const voile = jour === aujourdhui && contexte.groupe.revelerApresPost && !jaiPose;

  return (
    <div className="px-4 pt-3">
      <header className="mb-5 zone-sure-haute">
        <Link href="/" className="mb-3 inline-block text-[14px] text-encre-3 hover:text-encre-2">
          ← Le fil
        </Link>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
          {jour === aujourdhui ? "Aujourd'hui" : enTexteLongAvecAnnee(jour, aujourdhui)}
        </h1>
        {jour === aujourdhui && (
          <p className="mt-0.5 text-[14px] text-encre-3">
            {enTexteLongAvecAnnee(jour, aujourdhui)}
          </p>
        )}
      </header>

      {entrees.length === 0 ? (
        <Carte className="p-5">
          <p className="text-[15px] leading-snug text-encre-2">
            Personne n&apos;a écrit ce jour-là. Ça arrive, et ce n&apos;est pas grave.
          </p>
        </Carte>
      ) : (
        <div className="space-y-3">
          {entrees.map((entree) => {
            const cachee = voile && entree.profil !== contexte.moi.id;
            return (
              <div key={entree.id} id={`entree-${entree.id}`} className="scroll-mt-24">
                <CarteEntree
                  entree={cachee ? masquerEntree(entree) : entree}
                  annuaire={annuaire}
                  moi={cachee ? undefined : contexte.moi.id}
                  floute={cachee}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
