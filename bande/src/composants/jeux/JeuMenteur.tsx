"use client";

import { useState } from "react";

import { Avatar } from "@/composants/Avatar";
import type { Moteur } from "./CoquilleJeu";
import { PasseLeTelephone } from "./PasseLeTelephone";
import { RevelationVotes } from "./RevelationVotes";

/**
 * « Menteur » — deux vérités, un mensonge.
 *
 * Le joueur du tour écrit trois affirmations sur lui et désigne laquelle est
 * fausse ; les autres votent en secret. Un point par personne trompée pour le
 * menteur, un point à chacun de ceux qui trouvent.
 *
 * **Les trois affirmations sont mélangées avant d'être montrées**, et le
 * mélange est fait une fois, à la validation. Sans ça, le mensonge serait
 * toujours à la place où son auteur l'a tapé, et le jeu se gagnerait en
 * regardant l'ordre.
 */
type Phase = "saisie" | "vote" | "resultat";

export function JeuMenteur({ moteur }: { moteur: Moteur }) {
  const [tour, setTour] = useState(0);
  const [phase, setPhase] = useState<Phase>("saisie");
  const [textes, setTextes] = useState(["", "", ""]);
  const [mensonge, setMensonge] = useState(0);
  const [ordre, setOrdre] = useState([0, 1, 2]);
  const [votes, setVotes] = useState<Record<string, string>>({});

  const menteur = moteur.joueurs[tour % moteur.joueurs.length];
  const devineurs = moteur.joueurs.filter((j) => j.membreId !== menteur.membreId);
  const pret = textes.every((t) => t.trim().length >= 3);

  function valider() {
    // Un mélange, une fois : le mensonge ne doit pas rester à sa place de
    // saisie, sinon le jeu se gagne en regardant l'ordre.
    const melange = [0, 1, 2].sort(() => Math.random() - 0.5);
    setOrdre(melange);
    setPhase("vote");
  }

  function depouiller(choix: Record<string, string>) {
    const trouve = devineurs.filter((d) => Number(choix[d.membreId]) === mensonge);
    const trompes = devineurs.length - trouve.length;

    const gains = [
      ...trouve.map((d) => ({ membreId: d.membreId, delta: 1 })),
      ...(trompes > 0 ? [{ membreId: menteur.membreId, delta: trompes }] : []),
    ];
    if (gains.length > 0) moteur.marquer(gains);
    moteur.manche(
      { jeu: "menteur", textes, mensonge, votes: choix },
      menteur.membreId,
    );
    setVotes(choix);
    setPhase("resultat");
  }

  if (phase === "saisie") {
    return (
      <div className="px-4 py-6">
        <div className="flex items-center gap-3">
          <Avatar
            profil={{
              id: menteur.membreId,
              pseudo: menteur.pseudo,
              teinte: menteur.teinte,
              initiales: menteur.initiales,
              avatar: menteur.avatar,
            }}
            taille={40}
          />
          <div>
            <p className="text-[18px] font-semibold tracking-tight">À toi, {menteur.pseudo}</p>
            <p className="text-[13px] text-encre-3">Les autres ne regardent pas.</p>
          </div>
        </div>
        <p className="mt-4 text-[15px] leading-snug text-encre-2">
          Trois choses sur toi : deux vraies, une fausse. Touche celle qui est fausse.
        </p>

        <ul className="mt-4 space-y-2.5">
          {textes.map((texte, i) => (
            <li key={i} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => setMensonge(i)}
                aria-pressed={mensonge === i}
                aria-label={`Marquer l'affirmation ${i + 1} comme fausse`}
                className={`cible-tactile mt-1 h-9 w-9 shrink-0 rounded-full border text-[13px] font-semibold ${
                  mensonge === i ? "border-transparent bg-surface-3" : "border-trait text-encre-3"
                }`}
              >
                {mensonge === i ? "✗" : i + 1}
              </button>
              <textarea
                value={texte}
                onChange={(e) =>
                  setTextes(textes.map((t, j) => (j === i ? e.target.value : t)))
                }
                rows={2}
                maxLength={140}
                aria-label={`Affirmation ${i + 1}`}
                className="champ-saisie min-w-0 flex-1 rounded-[var(--radius-carte)] border border-trait bg-surface-2 px-3.5 py-2.5"
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={valider}
          disabled={!pret}
          className="cible-tactile mt-5 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface disabled:opacity-40"
        >
          C&apos;est écrit — passe aux autres
        </button>
        {tour > 0 && (
          <button
            type="button"
            onClick={moteur.terminer}
            className="cible-tactile mt-2 w-full text-[14px] text-encre-3"
          >
            Arrêter là et voir le classement
          </button>
        )}
      </div>
    );
  }

  if (phase === "vote") {
    return (
      <PasseLeTelephone
        joueurs={devineurs}
        question={`Laquelle des trois ${menteur.pseudo} a-t-il inventée ?`}
        rendre={(_joueur, valider2) => (
          <ul className="mt-2 space-y-2.5">
            {ordre.map((i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => valider2(String(i))}
                  className="cible-tactile w-full rounded-[var(--radius-carte)] bg-surface-3 px-4 py-4 text-left text-[16px] leading-snug"
                >
                  {textes[i]}
                </button>
              </li>
            ))}
          </ul>
        )}
        surFin={depouiller}
      />
    );
  }

  return (
    <div className="px-4 py-7">
      <p className="text-[15px] text-encre-3">Le mensonge de {menteur.pseudo}</p>
      <p className="mt-1.5 text-[20px] font-semibold leading-snug tracking-tight">
        {textes[mensonge]}
      </p>

      <RevelationVotes
        joueurs={devineurs}
        votes={votes}
        libelle={(choix) =>
          Number(choix) === mensonge ? "a trouvé" : `s'est fait avoir : « ${textes[Number(choix)]} »`
        }
      />

      <button
        type="button"
        onClick={() => {
          setTour(tour + 1);
          setTextes(["", "", ""]);
          setMensonge(0);
          setVotes({});
          setPhase("saisie");
        }}
        className="cible-tactile mt-7 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
      >
        Au suivant
      </button>
    </div>
  );
}
