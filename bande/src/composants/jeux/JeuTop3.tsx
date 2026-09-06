"use client";

import { useCallback, useRef, useState } from "react";

import { Avatar } from "@/composants/Avatar";
import type { Moteur } from "./CoquilleJeu";
import { PasseLeTelephone } from "./PasseLeTelephone";
import { THEMES_TOP3 } from "@/lib/jeux/contenu/dilemmes";
import { generateur, pioche } from "@/lib/jeux/tirage";
import { scoreTop3 } from "@/lib/jeux/top3";

/**
 * « Top 3 ».
 *
 * Le joueur du tour écrit son top 3 sur un thème tiré au sort ; les deux autres
 * essaient de le reconstituer dans l'ordre. Deux points par place exacte, un
 * point si la réponse y est mais ailleurs — le calcul est dans `lib/jeux/top3`,
 * avec ses tests.
 *
 * Le thème est tiré **avant** que le joueur écrive, et affiché aux trois : il
 * ne s'agit pas de deviner le sujet, il s'agit de deviner la personne.
 */
type Phase = "saisie" | "devine" | "resultat";

export function JeuTop3({ moteur }: { moteur: Moteur }) {
  const [tour, setTour] = useState(0);
  const [phase, setPhase] = useState<Phase>("saisie");
  const [theme, setTheme] = useState(THEMES_TOP3[0]);
  const [vrai, setVrai] = useState(["", "", ""]);
  const [propositions, setPropositions] = useState<Record<string, string[]>>({});
  const [graine] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const tas = useRef<ReturnType<typeof pioche<string>> | null>(null);
  const [themeTire, setThemeTire] = useState(false);

  const auteur = moteur.joueurs[tour % moteur.joueurs.length];
  const devineurs = moteur.joueurs.filter((j) => j.membreId !== auteur.membreId);
  const pret = vrai.every((t) => t.trim().length >= 2);

  const tirerTheme = useCallback(() => {
    tas.current ??= pioche(THEMES_TOP3, generateur(graine));
    setTheme(tas.current.suivante());
    setThemeTire(true);
  }, [graine]);

  function depouiller(reponses: Record<string, string>) {
    const parJoueur: Record<string, string[]> = {};
    const gains: { membreId: string; delta: number }[] = [];
    for (const devineur of devineurs) {
      const trois = (reponses[devineur.membreId] ?? "").split("|");
      parJoueur[devineur.membreId] = trois;
      const points = scoreTop3(vrai, trois);
      if (points > 0) gains.push({ membreId: devineur.membreId, delta: points });
    }
    if (gains.length > 0) moteur.marquer(gains);
    moteur.manche({ jeu: "top3", theme, vrai, propositions: parJoueur }, auteur.membreId);
    setPropositions(parJoueur);
    setPhase("resultat");
  }

  if (phase === "saisie") {
    if (!themeTire) {
      return (
        <div className="flex min-h-[62dvh] flex-col items-center justify-center px-6 text-center">
          <Avatar
            profil={{
              id: auteur.membreId,
              pseudo: auteur.pseudo,
              teinte: auteur.teinte,
              initiales: auteur.initiales,
              avatar: auteur.avatar,
            }}
            taille={72}
          />
          <p className="mt-4 text-[24px] font-semibold tracking-tight">À toi, {auteur.pseudo}</p>
          <p className="mt-2 max-w-[30ch] text-[15px] leading-snug text-encre-2">
            Un thème va être tiré. Tu écris ton top 3, les deux autres essaient de le
            remettre dans l&apos;ordre.
          </p>
          <button
            type="button"
            onClick={tirerTheme}
            className="cible-tactile mt-7 w-full max-w-xs rounded-[var(--radius-pilule)] bg-encre px-4 py-3.5 text-[17px] font-semibold text-surface"
          >
            Tirer le thème
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
      <div className="px-4 py-6">
        <p className="text-[15px] uppercase tracking-[0.1em] text-encre-3">{auteur.pseudo}</p>
        <p className="mt-2 text-[24px] font-semibold leading-tight tracking-tight">{theme}</p>
        <p className="mt-2 text-[13px] text-encre-3">
          Dans l&apos;ordre, et sans montrer l&apos;écran.
        </p>

        <ol className="mt-4 space-y-2.5">
          {vrai.map((valeur, i) => (
            <li key={i} className="flex items-center gap-2.5">
              <span aria-hidden className="w-4 text-[15px] font-semibold text-encre-3">
                {i + 1}
              </span>
              <input
                type="text"
                value={valeur}
                onChange={(e) => setVrai(vrai.map((v, j) => (j === i ? e.target.value : v)))}
                maxLength={60}
                aria-label={`Numéro ${i + 1} de ton top 3`}
                className="champ-saisie min-w-0 flex-1 rounded-[var(--radius-pilule)] border border-trait bg-surface-2 px-3.5 py-2.5"
              />
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={() => setPhase("devine")}
          disabled={!pret}
          className="cible-tactile mt-5 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface disabled:opacity-40"
        >
          C&apos;est écrit — passe aux autres
        </button>
      </div>
    );
  }

  if (phase === "devine") {
    return (
      <PasseLeTelephone
        joueurs={devineurs}
        question={`${theme}, selon ${auteur.pseudo}. Dans l'ordre.`}
        rendre={(_joueur, valider) => <TroisCases surValider={valider} />}
        surFin={depouiller}
      />
    );
  }

  return (
    <div className="px-4 py-7">
      <p className="text-[15px] text-encre-3">{theme}</p>
      <ol className="mt-2 space-y-1">
        {vrai.map((v, i) => (
          <li key={i} className="text-[17px] font-semibold">
            {i + 1}. {v}
          </li>
        ))}
      </ol>

      <ul className="mt-6 space-y-4">
        {devineurs.map((devineur) => {
          const trois = propositions[devineur.membreId] ?? [];
          return (
            <li key={devineur.membreId}>
              <p className="text-[15px] font-semibold">
                {devineur.pseudo} — {scoreTop3(vrai, trois)} point
                {scoreTop3(vrai, trois) > 1 ? "s" : ""}
              </p>
              <ol className="mt-1 space-y-0.5">
                {trois.map((t, i) => (
                  <li key={i} className="text-[14px] text-encre-2">
                    {i + 1}. {t || "—"}
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => {
          setTour(tour + 1);
          setVrai(["", "", ""]);
          setPropositions({});
          setThemeTire(false);
          setPhase("saisie");
        }}
        className="cible-tactile mt-7 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
      >
        Au suivant
      </button>
    </div>
  );
}

/**
 * Trois cases, rendues en une seule chaîne séparée par des barres.
 *
 * `PasseLeTelephone` transmet un choix par joueur ; plutôt que de lui apprendre
 * les tableaux pour un seul jeu, on encode les trois réponses. La barre
 * verticale ne se tape pas au clavier d'un iPhone, ce qui en fait un séparateur
 * sûr.
 */
function TroisCases({ surValider }: { surValider: (choix: string) => void }) {
  const [trois, setTrois] = useState(["", "", ""]);
  return (
    <div className="mt-2">
      <ol className="space-y-2.5">
        {trois.map((valeur, i) => (
          <li key={i} className="flex items-center gap-2.5">
            <span aria-hidden className="w-4 text-[15px] font-semibold text-encre-3">
              {i + 1}
            </span>
            <input
              type="text"
              value={valeur}
              onChange={(e) => setTrois(trois.map((v, j) => (j === i ? e.target.value : v)))}
              maxLength={60}
              aria-label={`Ta proposition numéro ${i + 1}`}
              className="champ-saisie min-w-0 flex-1 rounded-[var(--radius-pilule)] border border-trait bg-surface-2 px-3.5 py-2.5"
            />
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => surValider(trois.map((t) => t.replace(/\|/g, " ")).join("|"))}
        className="cible-tactile mt-4 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
      >
        Valider
      </button>
    </div>
  );
}
