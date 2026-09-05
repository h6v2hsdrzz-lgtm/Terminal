import { CarteEntree } from "@/composants/CarteEntree";
import { Carte, TitreSection } from "@/composants/Carte";
import { CapsuleTemporelle } from "@/composants/CapsuleTemporelle";
import { MurDesFigures } from "@/composants/MurDesFigures";
import { Retrospective } from "@/composants/Retrospective";
import { listerCapsules } from "@/lib/depot";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";
import { ceJourLa, moisDisponibles, murDeSouvenirs, retrospective } from "@/lib/souvenirs";
import { enTexteLong, jourDeLaBande } from "@/lib/dates";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string }>;
}) {
  const contexte = await exigerContexte();
  const aujourdhui = jourDeLaBande();
  const entrees = await entreesDeLaBande(contexte.groupe.id);
  const annuaire = { profils: contexte.profils, declencheurs: contexte.declencheurs };

  const mois = moisDisponibles(entrees);
  const { mois: demande } = await searchParams;
  const choisi = demande && mois.includes(demande) ? demande : mois[0];

  const anniversaires = ceJourLa(entrees, aujourdhui);
  const moments = murDeSouvenirs(entrees);
  const capsules = await listerCapsules(contexte.groupe.id, contexte.moi.id, aujourdhui);

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Les souvenirs</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">
          Ce que la bande garde, et ce qu&apos;elle s&apos;envoie à elle-même.
        </p>
      </header>

      {choisi && (
        <Retrospective
          donnees={retrospective(entrees, choisi, contexte.profils.map((p) => p.id))}
          profils={contexte.profils}
          nomBande={contexte.groupe.nom}
          mois={mois}
          choisi={choisi}
        />
      )}

      <section className="mt-7">
        <TitreSection>Les dernières formes</TitreSection>
        <MurDesFigures entrees={entrees} profils={contexte.profils} />
      </section>

      <section className="mt-7">
        <TitreSection>Ce jour-là</TitreSection>
        {anniversaires.length === 0 ? (
          <Carte className="p-5">
            <p className="text-[14px] leading-snug text-encre-2">
              Rien à cette date les mois et les années d&apos;avant. Revenez dans un
              mois : il y aura quelque chose.
            </p>
          </Carte>
        ) : (
          <div className="space-y-6">
            {anniversaires.map((a) => (
              <div key={a.jour}>
                <p className="mb-2 px-1 text-[13px] text-encre-3">
                  {a.ecart} — {enTexteLong(a.jour)}
                </p>
                <div className="space-y-3">
                  {a.entrees.map((entree) => (
                    <CarteEntree key={entree.id} entree={entree} annuaire={annuaire} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <CapsuleTemporelle capsules={capsules} aujourdhui={aujourdhui} moi={contexte.moi.id} />

      <section className="mt-7">
        <TitreSection action={<span className="text-[13px] text-encre-3">{moments.length}</span>}>
          Le mur
        </TitreSection>
        {moments.length === 0 ? (
          <Carte className="p-5">
            <p className="text-[14px] leading-snug text-encre-2">
              Le mur se remplit tout seul : une photo, une journée racontée, une
              conversation dans les commentaires, et elle arrive ici.
            </p>
          </Carte>
        ) : (
          <div className="space-y-3">
            {moments.map(({ entree, raison }) => (
              <div key={entree.id}>
                <p className="mb-1.5 px-1 text-[12px] text-encre-3">
                  {enTexteLong(entree.jour)}
                  {raison && <> · {raison}</>}
                </p>
                <CarteEntree entree={entree} annuaire={annuaire} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
