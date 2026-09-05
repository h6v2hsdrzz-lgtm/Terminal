"use client";

import { useState, useTransition } from "react";

import { EnregistreurVocal, type SonEnregistre } from "./EnregistreurVocal";
import { LecteurVocal } from "./LecteurVocal";
import { actionEnvoyerAudio, actionRetirerAudio } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import type { Audio } from "@/lib/types";

/**
 * La note vocale de sa propre journée : l'enregistrer, la réécouter, la retirer.
 *
 * Une journée n'en porte qu'une. Réenregistrer remplace, ce qui est le geste
 * qu'on attend quand on s'est raté au premier essai — plutôt que d'accumuler
 * cinq prises et d'obliger à choisir.
 */
export function BoiteVocale({ audio, couleur }: { audio: Audio | null; couleur: string }) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();

  function envoyer(son: SonEnregistre) {
    demarrer(async () => {
      const donnees = new FormData();
      // L'extension n'a pas d'importance — le serveur lit le type MIME — mais
      // un nom de fichier est obligatoire pour qu'un `Blob` devienne un `File`.
      donnees.set("audio", new File([son.blob], "note.audio", { type: son.mime }));
      donnees.set("duree", String(son.duree));
      donnees.set("niveaux", son.niveaux.join(","));
      setEtat(await actionEnvoyerAudio(ETAT_INITIAL, donnees));
    });
  }

  return (
    <div className="mt-3">
      {audio ? (
        <div className="overflow-hidden rounded-2xl border border-trait">
          <LecteurVocal audio={audio} couleur={couleur} nom="toi" />
        </div>
      ) : (
        <EnregistreurVocal onFini={envoyer} desactive={enCours} />
      )}

      {audio && !enCours && (
        <button
          type="button"
          onClick={() => demarrer(async () => setEtat(await actionRetirerAudio()))}
          className="mt-1.5 text-[13px] text-encre-3 underline underline-offset-2 hover:text-encre-2"
        >
          retirer la note vocale
        </button>
      )}

      {enCours && <p className="mt-1.5 text-[13px] text-encre-3">Envoi…</p>}

      {etat.erreur && (
        <p role="alert" className="mt-1.5 text-[13px] text-encre-2">
          {etat.erreur}
        </p>
      )}
    </div>
  );
}
