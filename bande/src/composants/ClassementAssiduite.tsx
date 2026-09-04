import { Fragment } from "react";

import { Avatar } from "./Avatar";
import { Carte, TitreSection } from "./Carte";
import { NOMS_JOURS_COURTS, decaler } from "@/lib/dates";
import { lundiDeLaSemaine } from "@/lib/badges";
import type { RangAssiduite } from "@/lib/badges";
import type { Entree, Profil } from "@/lib/types";

/**
 * Le classement de la semaine.
 *
 * Il porte sur l'assiduité, et sur rien d'autre. Classer sur la joie
 * reviendrait à faire perdre toutes les semaines à quelqu'un qui traverse un
 * mauvais mois — et à récompenser de dire qu'on va bien. On compte les
 * journées posées : la seule chose que chacun contrôle vraiment.
 *
 * Aucun chiffre de joie n'apparaît ici, volontairement.
 */
export function ClassementAssiduite({
  classement,
  profils,
  entrees,
  aujourdhui,
  moi,
}: {
  classement: RangAssiduite[];
  profils: Profil[];
  entrees: Entree[];
  aujourdhui: string;
  moi: string;
}) {
  const lundi = lundiDeLaSemaine(aujourdhui);
  const semaine = Array.from({ length: 7 }, (_, i) => decaler(lundi, i));
  const postes = new Set(entrees.map((e) => `${e.profil}|${e.jour}`));

  return (
    <section className="mt-7">
      <TitreSection action={<span className="text-[13px] text-encre-3">assiduité</span>}>
        La semaine
      </TitreSection>
      <Carte className="p-4">
        {/* Une grille partagée par l'en-tête et les lignes : c'est ce qui
            garantit que les initiales des jours tombent sous leurs pastilles.
            Deux structures séparées finissent toujours par se décaler. */}
        <div className="grid grid-cols-[1rem_2rem_1fr_auto_1.75rem] items-center gap-x-3 gap-y-3">
          {classement.map((ligne) => {
            const profil = profils.find((p) => p.id === ligne.profil);
            if (!profil) return null;
            return (
              <Fragment key={ligne.profil}>
                <span className="chiffres text-[13px] text-encre-3">{ligne.rang}</span>
                <Avatar profil={profil} taille={32} />
                <span className="min-w-0 truncate text-[15px]">
                  {ligne.profil === moi ? "toi" : profil.pseudo}
                </span>

                {/* Sept pastilles : pleines les jours posés, creuses les autres.
                    Le jour à venir reste discret — on ne rate pas un jour qui
                    n'est pas encore arrivé. */}
                <span className="flex gap-1.5" aria-hidden>
                  {semaine.map((jour) => {
                    const pose = postes.has(`${ligne.profil}|${jour}`);
                    const futur = jour > aujourdhui;
                    return (
                      <span
                        key={jour}
                        className="h-[9px] w-[9px] rounded-full"
                        style={{
                          background: pose ? "var(--joie-encre)" : "var(--surface-3)",
                          opacity: futur ? 0.35 : 1,
                        }}
                      />
                    );
                  })}
                </span>

                <span className="chiffres text-right text-[15px]">{ligne.joursPostes}</span>
              </Fragment>
            );
          })}

          <span className="col-span-3" />
          <span className="flex gap-1.5" aria-hidden>
            {semaine.map((jour, index) => (
              <span key={jour} className="w-[9px] text-center text-[9px] text-encre-3">
                {NOMS_JOURS_COURTS[index]}
              </span>
            ))}
          </span>
          <span />
        </div>

        <p className="mt-3 border-t border-trait pt-2.5 text-[13px] leading-snug text-encre-3">
          On compte les journées posées, jamais les notes. Une mauvaise semaine
          reste une semaine où l&apos;on était là.
        </p>
      </Carte>
    </section>
  );
}
