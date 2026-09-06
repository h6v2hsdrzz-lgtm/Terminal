"use client";

import { useCallback, useRef, useState } from "react";

import { Avatar } from "@/composants/Avatar";
import type { Moteur } from "./CoquilleJeu";
import { sanction } from "@/lib/jeux/cadre";
import { JUGEMENTS } from "@/lib/jeux/contenu/dilemmes";
import { generateur, pioche } from "@/lib/jeux/tirage";

/**
 * « Le jugement ».
 *
 * Un juge est désigné à tour de rôle, une question s'affiche, les deux autres
 * répondent **à voix haute** — rien à taper, rien à lire : c'est le seul jeu de
 * la série où le téléphone se contente de poser la question et d'enregistrer le
 * verdict. Le juge désigne la pire réponse ; l'autre marque un point.
 *
 * Le juge tourne à chaque manche, dans l'ordre tiré au lancement : sans ça,
 * celui qui tient le téléphone jugerait toute la soirée.
 */
export function JeuJugement({ moteur }: { moteur: Moteur }) {
  const [tour, setTour] = useState(0);
  const [question, setQuestion] = useState(JUGEMENTS[0]);
  const [lance, setLance] = useState(false);
  const [graine] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const tas = useRef<ReturnType<typeof pioche<string>> | null>(null);

  const juge = moteur.joueurs[tour % moteur.joueurs.length];
  const accuses = moteur.joueurs.filter((j) => j.membreId !== juge.membreId);

  const tirer = useCallback(() => {
    tas.current ??= pioche(JUGEMENTS, generateur(graine));
    setQuestion(tas.current.suivante());
    setLance(true);
  }, [graine]);

  function juger(perdantId: string) {
    const gagnant = accuses.find((a) => a.membreId !== perdantId);
    if (gagnant) moteur.marquer([{ membreId: gagnant.membreId, delta: 1 }]);
    moteur.manche({ jeu: "jugement", question, perdant: perdantId }, juge.membreId);
    setTour(tour + 1);
    setLance(false);
  }

  if (!lance) {
    return (
      <div className="flex min-h-[62dvh] flex-col items-center justify-center px-6 text-center">
        <Avatar
          profil={{
            id: juge.membreId,
            pseudo: juge.pseudo,
            teinte: juge.teinte,
            initiales: juge.initiales,
            avatar: juge.avatar,
          }}
          taille={72}
        />
        <p className="mt-4 text-[24px] font-semibold tracking-tight">{juge.pseudo} juge</p>
        <p className="mt-2 max-w-[30ch] text-[15px] leading-snug text-encre-2">
          Les deux autres répondent à voix haute, comme ils veulent. Le juge tranche,
          sans avoir à se justifier.
        </p>
        <button
          type="button"
          onClick={tirer}
          className="cible-tactile mt-7 w-full max-w-xs rounded-[var(--radius-pilule)] bg-encre px-4 py-3.5 text-[17px] font-semibold text-surface"
        >
          Tirer la question
        </button>
        {tour > 0 && (
          <button
            type="button"
            onClick={moteur.terminer}
            className="cible-tactile mt-2 text-[14px] text-encre-3"
          >
            Arrêter là et voir le classement
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-[62dvh] flex-col justify-center px-5">
      <p className="text-[15px] uppercase tracking-[0.1em] text-encre-3">
        {juge.pseudo} demande
      </p>
      <p className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">{question}</p>

      <p className="mt-8 text-[14px] text-encre-3">La pire réponse est celle de…</p>
      <ul className="mt-2 space-y-2.5">
        {accuses.map((accuse) => {
          const doit = sanction({
            sobre: accuse.sobre,
            nombre: 1,
            tirage: accuse.membreId.length + question.length,
          });
          return (
            <li key={accuse.membreId}>
              <button
                type="button"
                onClick={() => juger(accuse.membreId)}
                className="cible-tactile flex w-full items-center gap-3 rounded-[var(--radius-carte)] bg-surface-3 px-4 py-3.5 text-left"
              >
                <Avatar
                  profil={{
                    id: accuse.membreId,
                    pseudo: accuse.pseudo,
                    teinte: accuse.teinte,
                    initiales: accuse.initiales,
                    avatar: accuse.avatar,
                  }}
                  taille={32}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold">{accuse.pseudo}</span>
                  <span className="block text-[13px] text-encre-3">
                    {doit.genre === "rien" ? "" : doit.texte}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
