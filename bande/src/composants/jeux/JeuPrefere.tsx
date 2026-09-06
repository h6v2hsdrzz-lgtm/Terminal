"use client";

import { useCallback, useRef, useState } from "react";

import type { Moteur } from "./CoquilleJeu";
import { PasseLeTelephone } from "./PasseLeTelephone";
import { RevelationVotes } from "./RevelationVotes";
import { sanction } from "@/lib/jeux/cadre";
import { DILEMMES } from "@/lib/jeux/contenu/dilemmes";
import { generateur, pioche } from "@/lib/jeux/tirage";
import { depouiller } from "@/lib/jeux/vote";

/**
 * « Tu préfères ».
 *
 * Deux options, vote secret, révélation simultanée, les minoritaires prennent
 * une gorgée. Ceux qui sont **en majorité** marquent un point : le jeu n'est
 * pas de choisir la bonne réponse — il n'y en a pas — mais de deviner ce que
 * les autres vont choisir. C'est ce qui en fait un jeu et pas un sondage.
 *
 * Une égalité parfaite ne fait boire personne : à trois, elle n'arrive pas ;
 * à quatre, deux contre deux n'a pas de minorité.
 */
type Phase = "annonce" | "vote" | "resultat";

export function JeuPrefere({ moteur }: { moteur: Moteur }) {
  const [phase, setPhase] = useState<Phase>("annonce");
  const [dilemme, setDilemme] = useState<[string, string]>(DILEMMES[0]);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [graine] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const tas = useRef<ReturnType<typeof pioche<[string, string]>> | null>(null);

  const tirer = useCallback(() => {
    tas.current ??= pioche(DILEMMES, generateur(graine));
    setDilemme(tas.current.suivante());
    setVotes({});
    setPhase("annonce");
  }, [graine]);

  function compter(choix: Record<string, string>) {
    const { minoritaire } = depouiller(choix, ["a", "b"]);

    // Personne ne marque quand il n'y a pas de minorité : deviner une majorité
    // unanime n'est pas un exploit, et une égalité n'a pas de perdant.
    const gains = moteur.joueurs
      .filter((j) => minoritaire !== null && choix[j.membreId] !== minoritaire)
      .map((j) => ({ membreId: j.membreId, delta: 1 }));
    if (gains.length > 0) moteur.marquer(gains);
    moteur.manche({ jeu: "prefere", dilemme, votes: choix });

    setVotes(choix);
    setPhase("resultat");
  }

  if (phase === "vote") {
    return (
      <PasseLeTelephone
        joueurs={moteur.joueurs}
        question="Tu préfères…"
        rendre={(_joueur, valider) => (
          <div className="mt-2 grid gap-2.5">
            <button
              type="button"
              onClick={() => valider("a")}
              className="cible-tactile rounded-[var(--radius-carte)] bg-surface-3 px-4 py-5 text-[17px] font-semibold leading-snug"
            >
              {dilemme[0]}
            </button>
            <p className="text-center text-[13px] text-encre-3">ou</p>
            <button
              type="button"
              onClick={() => valider("b")}
              className="cible-tactile rounded-[var(--radius-carte)] bg-surface-3 px-4 py-5 text-[17px] font-semibold leading-snug"
            >
              {dilemme[1]}
            </button>
          </div>
        )}
        surFin={compter}
      />
    );
  }

  if (phase === "resultat") {
    const { comptes, minoritaire, unanime } = depouiller(votes, ["a", "b"]);
    const [a, b] = [comptes.a, comptes.b];

    const sanctions: Record<string, string> = {};
    for (const joueur of moteur.joueurs) {
      const doit = sanction({
        sobre: joueur.sobre,
        nombre: minoritaire !== null && votes[joueur.membreId] === minoritaire ? 1 : 0,
        tirage: joueur.membreId.length + dilemme[0].length,
      });
      if (doit.genre !== "rien") sanctions[joueur.membreId] = doit.texte;
    }

    return (
      <div className="px-4 py-7">
        <p className="text-[15px] leading-snug text-encre-2">
          <strong className="font-semibold">{dilemme[0]}</strong> ({a}) ou{" "}
          <strong className="font-semibold">{dilemme[1]}</strong> ({b})
        </p>
        {minoritaire === null && (
          <p className="mt-2 text-[14px] text-encre-3">
            {unanime
              ? "Tout le monde pareil : personne n'est en minorité, personne ne prend rien."
              : "Égalité parfaite : personne n'est en minorité, personne ne prend rien."}
          </p>
        )}

        <RevelationVotes
          joueurs={moteur.joueurs}
          votes={votes}
          libelle={(choix) => (choix === "a" ? dilemme[0] : dilemme[1])}
          sanctions={sanctions}
        />

        <button
          type="button"
          onClick={tirer}
          className="cible-tactile mt-7 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
        >
          Dilemme suivant
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[62dvh] flex-col justify-center px-5">
      <p className="text-[15px] uppercase tracking-[0.1em] text-encre-3">Tu préfères</p>
      <p className="mt-3 text-[26px] font-semibold leading-tight tracking-tight">{dilemme[0]}</p>
      <p className="my-3 text-[15px] text-encre-3">ou</p>
      <p className="text-[26px] font-semibold leading-tight tracking-tight">{dilemme[1]}</p>
      <button
        type="button"
        onClick={() => setPhase("vote")}
        className="cible-tactile mt-8 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
      >
        Chacun vote en secret
      </button>
    </div>
  );
}
