"use client";

import { useMemo, useState } from "react";

import type { Moteur } from "./CoquilleJeu";
import { PasseLeTelephone } from "./PasseLeTelephone";
import { RevelationVotes } from "./RevelationVotes";
import { questionsDuQuiz, type Question } from "@/lib/jeux/quiz";
import { generateur } from "@/lib/jeux/tirage";
import type { Entree, Profil } from "@/lib/types";

/**
 * « Le quiz de la bande ».
 *
 * Les questions sortent du journal, pas d'une base à nous — voir
 * `lib/jeux/quiz.ts`, qui explique ce qu'on s'interdit de demander. Chacun
 * répond en secret, on révèle ensemble, un point par bonne réponse.
 *
 * Si la bande est trop jeune pour qu'on puisse fabriquer une seule vraie
 * question, on le dit au lieu d'en inventer.
 */
export function JeuQuiz({
  moteur,
  entrees,
  profils,
}: {
  moteur: Moteur;
  entrees: Entree[];
  profils: Profil[];
}) {
  const [graine] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const questions = useMemo(
    () => questionsDuQuiz(entrees, profils, generateur(graine), 12),
    [entrees, profils, graine],
  );
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"annonce" | "vote" | "resultat">("annonce");
  const [reponses, setReponses] = useState<Record<string, string>>({});

  const question: Question | undefined = questions[index];

  if (!question) {
    return (
      <div className="flex min-h-[62dvh] flex-col items-center justify-center px-6 text-center">
        <p aria-hidden className="text-[40px]">🌱</p>
        <p className="mt-3 text-[20px] font-semibold tracking-tight">
          {questions.length === 0 ? "Pas encore assez d'histoire" : "Plus de questions"}
        </p>
        <p className="mt-2 max-w-[30ch] text-[15px] leading-snug text-encre-2">
          {questions.length === 0
            ? "Ce jeu se nourrit de votre journal. Quelques semaines de plus, et il aura de quoi vous piéger."
            : "Vous avez fait le tour de ce que le journal savait ce soir."}
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

  if (phase === "vote") {
    return (
      <PasseLeTelephone
        joueurs={moteur.joueurs}
        question={question.intitule}
        rendre={(_joueur, valider) => (
          <ul className="mt-2 space-y-2.5">
            {question.options.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  onClick={() => valider(option)}
                  className="cible-tactile w-full rounded-[var(--radius-carte)] bg-surface-3 px-4 py-4 text-left text-[16px] leading-snug"
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        )}
        surFin={(choix) => {
          const gains = moteur.joueurs
            .filter((j) => choix[j.membreId] === question.bonne)
            .map((j) => ({ membreId: j.membreId, delta: 1 }));
          if (gains.length > 0) moteur.marquer(gains);
          moteur.manche({ jeu: "quiz-bande", question: question.intitule, bonne: question.bonne, reponses: choix });
          setReponses(choix);
          setPhase("resultat");
        }}
      />
    );
  }

  if (phase === "resultat") {
    return (
      <div className="px-4 py-7">
        <p className="text-[15px] leading-snug text-encre-2">{question.intitule}</p>
        <p className="mt-2 text-[24px] font-semibold tracking-tight">{question.bonne}</p>
        <p className="mt-1 text-[13px] text-encre-3">D&apos;après {question.source}.</p>

        <RevelationVotes
          joueurs={moteur.joueurs}
          votes={reponses}
          libelle={(choix) => (choix === question.bonne ? `a dit ${choix} — juste` : `a dit ${choix}`)}
        />

        <button
          type="button"
          onClick={() => {
            setIndex(index + 1);
            setReponses({});
            setPhase("annonce");
          }}
          className="cible-tactile mt-7 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
        >
          Question suivante
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[62dvh] flex-col justify-center px-5">
      <p className="text-[15px] uppercase tracking-[0.1em] text-encre-3">
        Question {index + 1} sur {questions.length}
      </p>
      <p className="mt-3 text-[26px] font-semibold leading-tight tracking-tight">
        {question.intitule}
      </p>
      <button
        type="button"
        onClick={() => setPhase("vote")}
        className="cible-tactile mt-8 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
      >
        Chacun répond en secret
      </button>
    </div>
  );
}
