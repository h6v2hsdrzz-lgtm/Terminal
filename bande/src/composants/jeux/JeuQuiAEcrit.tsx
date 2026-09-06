"use client";

import { useMemo, useState } from "react";

import type { Moteur } from "./CoquilleJeu";
import { PasseLeTelephone } from "./PasseLeTelephone";
import { RevelationVotes } from "./RevelationVotes";
import { generateur, melanger } from "@/lib/jeux/tirage";
import type { Entree } from "@/lib/types";

/**
 * « Devine qui a écrit ça ».
 *
 * Une vieille anecdote du journal s'affiche sans son auteur, et chacun devine.
 * **L'auteur ne vote pas** : il connaît la réponse, et le faire voter ne serait
 * pas un tour de jeu mais une formalité.
 *
 * Les anecdotes sont prises **des plus anciennes vers les plus récentes** :
 * celles d'hier se reconnaissent à ce qui s'est passé hier, celles d'il y a un
 * an ne se reconnaissent qu'à la façon d'écrire. Le jeu est plus dur et
 * beaucoup plus drôle dans ce sens-là.
 *
 * Et le texte n'est jamais coupé au milieu d'un mot ni raccourci : c'est le
 * journal, tel qu'il a été écrit.
 */
const LONGUEUR_MIN = 40;

export function JeuQuiAEcrit({ moteur, entrees }: { moteur: Moteur; entrees: Entree[] }) {
  const [graine] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"annonce" | "vote" | "resultat">("annonce");
  const [votes, setVotes] = useState<Record<string, string>>({});

  const joueursIds = useMemo(
    () => new Set(moteur.joueurs.map((j) => j.membreId)),
    [moteur.joueurs],
  );

  const candidates = useMemo(() => {
    // Seulement les anecdotes écrites par quelqu'un qui joue : faire deviner
    // l'auteur d'un texte écrit par un absent n'a pas de réponse jouable.
    const utiles = entrees.filter(
      (e) => (e.note ?? "").trim().length >= LONGUEUR_MIN && joueursIds.has(e.profil),
    );
    // Les plus anciennes d'abord, puis un mélange à l'intérieur de la moitié
    // ancienne pour ne pas rejouer deux fois la même partie.
    const anciennes = [...utiles].sort((a, b) => a.jour.localeCompare(b.jour));
    return melanger(anciennes.slice(0, Math.max(12, Math.floor(anciennes.length / 2))), generateur(graine));
  }, [entrees, joueursIds, graine]);

  const entree = candidates[index];

  if (!entree) {
    return (
      <div className="flex min-h-[62dvh] flex-col items-center justify-center px-6 text-center">
        <p aria-hidden className="text-[40px]">📭</p>
        <p className="mt-3 text-[20px] font-semibold tracking-tight">
          {candidates.length === 0 ? "Rien d'assez vieux à faire deviner" : "Vous avez tout deviné"}
        </p>
        <p className="mt-2 max-w-[30ch] text-[15px] leading-snug text-encre-2">
          {candidates.length === 0
            ? "Il faut des anecdotes écrites, et un peu de recul. Revenez dans quelques semaines."
            : "Le journal n'a plus rien de vieux à vous cacher ce soir."}
        </p>
        <button
          type="button"
          onClick={moteur.terminer}
          className="cible-tactile mt-7 w-full max-w-xs rounded-[var(--radius-pilule)] bg-encre px-4 py-3.5 text-[17px] font-semibold text-surface"
        >
          Voir le classement
        </button>
      </div>
    );
  }

  const auteur = moteur.joueurs.find((j) => j.membreId === entree.profil);
  const devineurs = moteur.joueurs.filter((j) => j.membreId !== entree.profil);
  const pseudoDe = (id: string) => moteur.joueurs.find((j) => j.membreId === id)?.pseudo ?? "?";

  if (phase === "vote") {
    return (
      <PasseLeTelephone
        joueurs={devineurs}
        question={`« ${entree.note} »`}
        rendre={(_joueur, valider) => (
          <ul className="mt-2 space-y-2.5">
            {moteur.joueurs.map((cible) => (
              <li key={cible.membreId}>
                <button
                  type="button"
                  onClick={() => valider(cible.membreId)}
                  className="cible-tactile w-full rounded-[var(--radius-carte)] bg-surface-3 px-4 py-4 text-left text-[17px] font-semibold"
                >
                  {cible.pseudo}
                </button>
              </li>
            ))}
          </ul>
        )}
        surFin={(choix) => {
          const gains = devineurs
            .filter((d) => choix[d.membreId] === entree.profil)
            .map((d) => ({ membreId: d.membreId, delta: 1 }));
          if (gains.length > 0) moteur.marquer(gains);
          moteur.manche(
            { jeu: "qui-a-ecrit", jour: entree.jour, auteur: entree.profil, votes: choix },
            entree.profil,
          );
          setVotes(choix);
          setPhase("resultat");
        }}
      />
    );
  }

  if (phase === "resultat") {
    return (
      <div className="px-4 py-7">
        <p className="text-[15px] leading-snug text-encre-2">« {entree.note} »</p>
        <p className="mt-3 text-[24px] font-semibold tracking-tight">
          {auteur?.pseudo ?? "Quelqu'un"}, le {entree.jour}
        </p>

        <RevelationVotes
          joueurs={devineurs}
          votes={votes}
          libelle={(choix) =>
            choix === entree.profil ? "a trouvé" : `a dit ${pseudoDe(choix)}`
          }
        />

        <button
          type="button"
          onClick={() => {
            setIndex(index + 1);
            setVotes({});
            setPhase("annonce");
          }}
          className="cible-tactile mt-7 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
        >
          Anecdote suivante
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[62dvh] flex-col justify-center px-5">
      <p className="text-[15px] uppercase tracking-[0.1em] text-encre-3">Qui a écrit ça ?</p>
      <p className="mt-3 text-[22px] font-semibold leading-snug tracking-tight">
        « {entree.note} »
      </p>
      <p className="mt-3 text-[13px] text-encre-3">
        {auteur ? `${auteur.pseudo} ne vote pas ce tour-ci.` : ""}
      </p>
      <button
        type="button"
        onClick={() => setPhase("vote")}
        className="cible-tactile mt-8 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
      >
        Les autres devinent
      </button>
    </div>
  );
}
