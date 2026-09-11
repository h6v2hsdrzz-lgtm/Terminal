"use client";

import { useRef, useState, useTransition } from "react";

import { Carte, TitreSection } from "./Carte";
import { MessageErreur } from "./Champ";
import { actionRestaurer } from "@/lib/actions";
import type { RapportRestauration } from "@/lib/depot";

/**
 * Remettre une sauvegarde dans la bande.
 *
 * ## Pourquoi ça ne fait peur à personne
 *
 * Parce que **rien n'est écrasé**, et que c'est écrit avant le bouton, pas
 * après. Une journée déjà là est laissée telle quelle. C'est le seul
 * comportement défendable : une sauvegarde a souvent des mois, et personne ne
 * s'attend à perdre ce qu'il a écrit depuis en la restaurant.
 *
 * ## Le rapport
 *
 * « 412 journées, 38 photos, 12 vocaux » plutôt qu'un « c'est fait ». Une
 * restauration silencieuse laisse dans le doute exactement au moment où on a
 * besoin d'être rassuré — et les pseudos qu'elle n'a pas su placer sont dits,
 * parce que deviner à qui appartient une journée serait pire que de le demander.
 */
export function BoiteRestauration() {
  const champ = useRef<HTMLInputElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rapport, setRapport] = useState<RapportRestauration | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <section className="mt-7">
      <TitreSection>Restaurer</TitreSection>
      <Carte className="p-4">
        <p className="text-[14px] leading-snug text-encre-2">
          Le fichier <b>.zip</b> d&apos;une sauvegarde, ou un vieux <b>.json</b>.
          <strong> Rien n&apos;est écrasé</strong> : une journée déjà là reste
          exactement comme elle est.
        </p>

        <input
          ref={champ}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          aria-label="Le fichier de sauvegarde"
          onChange={(evenement) => {
            const fichier = evenement.target.files?.[0];
            if (!fichier) return;
            setErreur(null);
            setRapport(null);
            const donnees = new FormData();
            donnees.set("sauvegarde", fichier);
            demarrer(async () => {
              const reponse = await actionRestaurer(donnees);
              setErreur(reponse.erreur);
              setRapport(reponse.valeur ?? null);
              // Sans ça, rechoisir le même fichier ne déclenche aucun
              // changement et le bouton a l'air cassé.
              if (champ.current) champ.current.value = "";
            });
          }}
          disabled={enCours}
          // 16 px sur le champ lui-même, pas seulement sur son bouton : sous
          // cette taille, Safari iOS zoome à la mise au point et ne dézoome
          // jamais seul. La règle vaut pour TOUS les champs, y compris ceux
          // qu'on croit inoffensifs — un test de la suite compte ceux qui la
          // violent, et il a attrapé celui-ci.
          className="champ-saisie mt-3 block w-full text-encre-3 file:mr-3 file:cible-tactile file:rounded-[var(--radius-pilule)] file:border file:border-trait-fort file:bg-surface file:px-4 file:py-2.5 file:text-[15px] file:font-medium file:text-encre"
        />

        {enCours && (
          <p role="status" className="mt-3 text-[13px] text-encre-3">
            On remet tout en place… Ça peut prendre une minute.
          </p>
        )}

        {erreur && (
          <div className="mt-3">
            <MessageErreur>{erreur}</MessageErreur>
          </div>
        )}

        {rapport && (
          <div role="status" className="mt-3 text-[14px] leading-snug">
            <p className="font-medium">
              {rapport.journees === 0 && rapport.ignorees > 0
                ? "Tout y était déjà."
                : `${rapport.journees} journée${rapport.journees > 1 ? "s" : ""} remise${
                    rapport.journees > 1 ? "s" : ""
                  } en place.`}
            </p>
            <ul className="mt-1 space-y-0.5 text-[13px] text-encre-3">
              {rapport.ignorees > 0 && (
                <li>{rapport.ignorees} déjà là, laissée{rapport.ignorees > 1 ? "s" : ""} intacte{rapport.ignorees > 1 ? "s" : ""}.</li>
              )}
              {rapport.medias > 0 && <li>{rapport.medias} photo{rapport.medias > 1 ? "s" : ""} et vidéo{rapport.medias > 1 ? "s" : ""}.</li>}
              {rapport.vocaux > 0 && <li>{rapport.vocaux} note{rapport.vocaux > 1 ? "s" : ""} vocale{rapport.vocaux > 1 ? "s" : ""}.</li>}
              {rapport.commentaires > 0 && <li>{rapport.commentaires} commentaire{rapport.commentaires > 1 ? "s" : ""}.</li>}
              {rapport.inconnus.length > 0 && (
                <li className="text-encre-2">
                  Personne ici ne s&apos;appelle {rapport.inconnus.join(", ")} : leurs journées
                  sont restées dans le fichier. Renomme quelqu&apos;un, ou refais la
                  restauration après.
                </li>
              )}
            </ul>
          </div>
        )}
      </Carte>
    </section>
  );
}
