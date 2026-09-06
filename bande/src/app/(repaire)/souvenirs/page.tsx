import Image from "next/image";

import { CarteEntree } from "@/composants/CarteEntree";
import { Carte, TitreSection } from "@/composants/Carte";
import { Scelles } from "@/composants/Scelles";
import { MurDesFigures } from "@/composants/MurDesFigures";
import { Stats } from "@/composants/Stats";
import { Retrospective } from "@/composants/Retrospective";
import Link from "next/link";

import { CarteDesLieux } from "@/composants/CarteDesLieux";
import { compterMedias, etiquettesDeLaBande, listerCapsules, mediasDeLaBande } from "@/lib/depot";
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
  // Huit cases d'aperçu : on en demande huit, pas les mille de la bande.
  const medias = await mediasDeLaBande(contexte.groupe.id, 8);
  const combienMedias = await compterMedias(contexte.groupe.id);
  const lieux = await etiquettesDeLaBande(contexte.groupe.id);

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Les souvenirs</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">
          Ce que la bande garde, et ce qu&apos;elle s&apos;envoie à elle-même.
        </p>
      </header>

      {medias.length > 0 && (
        <section className="mt-7">
          <TitreSection
            action={
              <Link href="/galerie" className="text-[13px] text-encre-3 hover:text-encre-2">
                tout voir →
              </Link>
            }
          >
            La galerie
          </TitreSection>
          <Link href="/galerie" className="block">
            <Carte className="overflow-hidden p-2">
              <ul className="grid grid-cols-4 gap-1.5">
                {medias.map((media) => (
                  <li key={media.id} className="relative overflow-hidden rounded-lg">
                    {/* Des vignettes, jamais les originaux : c'est un aperçu de
                        huit cases, pas une raison de tirer huit méga-octets. */}
                    <Image
                      src={media.vignette}
                      alt=""
                      width={400}
                      height={400}
                      unoptimized
                      className="aspect-square w-full object-cover"
                    />
                    {media.genre === "video" && (
                      <span
                        aria-hidden
                        className="absolute right-0.5 top-0.5 rounded-full px-1 text-[10px] text-white"
                        style={{ background: "rgb(0 0 0 / 0.5)" }}
                      >
                        ▶
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="px-1 pb-1 pt-2 text-[13px] text-encre-3">
                {combienMedias} {combienMedias > 1 ? "médias" : "média"} depuis le début.
              </p>
            </Carte>
          </Link>
        </section>
      )}

      <section className="mt-7">
        <Stats
          entrees={entrees}
          profils={contexte.profils}
          declencheurs={contexte.declencheurs}
          aujourdhui={aujourdhui}
        />
      </section>

      {lieux.filter((l) => l.latitude !== null).length >= 2 && (
        <section className="mt-7">
          <TitreSection>Vos lieux</TitreSection>
          <CarteDesLieux lieux={lieux} />
        </section>
      )}

      {/* Le mur des figures ne dessine rien tant qu'aucune journée n'a été
          posée, et un titre de section seul au-dessus du vide est un défaut
          que seule une capture d'écran vide fait voir. */}
      {entrees.length > 0 && (
        <section className="mt-7">
          <TitreSection>Les dernières formes</TitreSection>
          <MurDesFigures entrees={entrees} profils={contexte.profils} />
        </section>
      )}

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

      <Scelles capsules={capsules} aujourdhui={aujourdhui} moi={contexte.moi.id} />

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
      {/* En pied de page, et repliée : c'est une conclusion, pas un
          module qui prend l'écran. */}
      {choisi && (
        <Retrospective
          donnees={retrospective(entrees, choisi, contexte.profils.map((p) => p.id))}
          profils={contexte.profils}
          nomBande={contexte.groupe.nom}
          mois={mois}
          choisi={choisi}
        />
      )}

    </div>
  );
}
