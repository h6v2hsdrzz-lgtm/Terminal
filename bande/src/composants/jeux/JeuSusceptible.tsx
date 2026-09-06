"use client";

import { useCallback, useRef, useState } from "react";

import { Avatar } from "@/composants/Avatar";
import type { Moteur } from "./CoquilleJeu";
import { PasseLeTelephone } from "./PasseLeTelephone";
import { RevelationVotes } from "./RevelationVotes";
import { sanction } from "@/lib/jeux/cadre";
import { SUSCEPTIBLES } from "@/lib/jeux/contenu/dilemmes";
import { generateur, pioche } from "@/lib/jeux/tirage";

/**
 * « Qui est le plus susceptible de… ».
 *
 * Chacun désigne quelqu'un — soi compris, c'est souvent la meilleure réponse —
 * puis on révèle les trois votes ensemble. Le plus désigné prend une gorgée
 * par voix reçue, dans la limite du plafond du cadre.
 *
 * **Le score est le nombre de voix reçues.** Le podium de fin désigne donc le
 * plus suspect de la bande, pas le meilleur joueur : c'est le seul classement
 * qui a un sens ici, et il est drôle. Aucun rapport avec le bonheur de qui que
 * ce soit — la règle du plan tient.
 */
type Phase = "annonce" | "vote" | "resultat";

export function JeuSusceptible({ moteur }: { moteur: Moteur }) {
  const [phase, setPhase] = useState<Phase>("annonce");
  const [situation, setSituation] = useState(SUSCEPTIBLES[0]);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [graine] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const tas = useRef<ReturnType<typeof pioche<string>> | null>(null);

  const tirer = useCallback(() => {
    tas.current ??= pioche(SUSCEPTIBLES, generateur(graine));
    setSituation(tas.current.suivante());
    setVotes({});
    setPhase("annonce");
  }, [graine]);

  const pseudoDe = (id: string) =>
    moteur.joueurs.find((j) => j.membreId === id)?.pseudo ?? "quelqu'un";

  function depouiller(choix: Record<string, string>) {
    const voix = new Map<string, number>();
    for (const designe of Object.values(choix)) {
      voix.set(designe, (voix.get(designe) ?? 0) + 1);
    }
    const gains = [...voix.entries()].map(([membreId, combien]) => ({
      membreId,
      delta: combien,
    }));
    if (gains.length > 0) moteur.marquer(gains);
    moteur.manche({ jeu: "susceptible", situation, votes: choix });
    setVotes(choix);
    setPhase("resultat");
  }

  if (phase === "vote") {
    return (
      <PasseLeTelephone
        joueurs={moteur.joueurs}
        question={`Qui est le plus susceptible de ${situation} ?`}
        rendre={(_joueur, valider) => (
          <ul className="mt-2 space-y-2.5">
            {moteur.joueurs.map((cible) => (
              <li key={cible.membreId}>
                <button
                  type="button"
                  onClick={() => valider(cible.membreId)}
                  className="cible-tactile flex w-full items-center gap-3 rounded-[var(--radius-carte)] bg-surface-3 px-4 py-3.5 text-left"
                >
                  <Avatar
                    profil={{
                      id: cible.membreId,
                      pseudo: cible.pseudo,
                      teinte: cible.teinte,
                      initiales: cible.initiales,
                      avatar: cible.avatar,
                    }}
                    taille={32}
                  />
                  <span className="text-[17px] font-semibold">{cible.pseudo}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        surFin={depouiller}
      />
    );
  }

  if (phase === "resultat") {
    const voix = new Map<string, number>();
    for (const designe of Object.values(votes)) voix.set(designe, (voix.get(designe) ?? 0) + 1);
    const maximum = Math.max(0, ...voix.values());

    const sanctions: Record<string, string> = {};
    for (const joueur of moteur.joueurs) {
      const recues = voix.get(joueur.membreId) ?? 0;
      const doit = sanction({
        sobre: joueur.sobre,
        // Une gorgée par voix reçue, plafonnée par le cadre.
        nombre: recues,
        tirage: joueur.membreId.length + situation.length,
      });
      if (doit.genre !== "rien") sanctions[joueur.membreId] = doit.texte;
    }

    const designes = moteur.joueurs.filter((j) => (voix.get(j.membreId) ?? 0) === maximum && maximum > 0);

    return (
      <div className="px-4 py-7">
        <p className="text-[15px] leading-snug text-encre-2">
          Le plus susceptible de {situation}
        </p>
        {designes.length > 0 && (
          <p className="mt-2 text-[24px] font-semibold tracking-tight">
            {designes.map((d) => d.pseudo).join(" et ")}
          </p>
        )}

        <RevelationVotes
          joueurs={moteur.joueurs}
          votes={votes}
          libelle={(choix) => `a désigné ${pseudoDe(choix)}`}
          sanctions={sanctions}
        />

        <button
          type="button"
          onClick={tirer}
          className="cible-tactile mt-7 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
        >
          Situation suivante
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[62dvh] flex-col justify-center px-5">
      <p className="text-[15px] uppercase tracking-[0.1em] text-encre-3">
        Qui est le plus susceptible de
      </p>
      <p className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">{situation} ?</p>
      <button
        type="button"
        onClick={() => setPhase("vote")}
        className="cible-tactile mt-8 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
      >
        Chacun désigne en secret
      </button>
    </div>
  );
}
