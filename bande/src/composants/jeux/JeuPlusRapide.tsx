"use client";

import { useEffect, useRef, useState } from "react";

import type { Moteur } from "./CoquilleJeu";

/**
 * « Le plus rapide ».
 *
 * L'écran devient vert après un délai que personne ne connaît, et le premier à
 * toucher sa moitié gagne. Toucher avant le vert, c'est perdu — sinon la
 * stratégie gagnante est de marteler l'écran, et il n'y a plus de jeu.
 *
 * **Le délai est tiré entre 2 et 7 secondes**, jamais moins : en dessous de
 * deux secondes, le doigt est encore en train de se poser et c'est le hasard
 * qui tranche. Et la manche s'annule si personne ne touche en huit secondes,
 * parce qu'un écran vert qui attend indéfiniment finit par être touché en
 * rangeant le téléphone.
 *
 * À trois, chaque manche oppose deux joueurs, choisis à tour de rôle : trois
 * moitiés d'écran, ça n'existe pas.
 */
const MIN = 1000;
const ETENDUE = 4000;
const ABANDON = 8000;
/** Le décompte avant que l'attente commence. Trois chiffres, une seconde chacun. */
const COMPTE = 3;

type Phase = "consigne" | "compte" | "attente" | "vert" | "faute" | "resultat";

export function JeuPlusRapide({ moteur }: { moteur: Moteur }) {
  const [tour, setTour] = useState(0);
  const [phase, setPhase] = useState<Phase>("consigne");
  const [compte, setCompte] = useState(COMPTE);
  const [gagnant, setGagnant] = useState<string | null>(null);
  const [fautif, setFautif] = useState<string | null>(null);
  const vert = useRef(0);
  const [temps, setTemps] = useState<number | null>(null);

  // À trois, deux s'affrontent par manche et le troisième arbitre. La paire
  // tourne, pour que chacun joue autant.
  const total = moteur.joueurs.length;
  const gauche = moteur.joueurs[tour % total];
  const droite = moteur.joueurs[(tour + 1) % total];

  /**
   * Le décompte 3-2-1, puis l'attente.
   *
   * Sans décompte, l'écran passe de « Prêts » à un gris qui pourrait devenir
   * vert n'importe quand : les doigts se posent en retard et la première manche
   * ne mesure rien. Avec, tout le monde est en position sur le « 1 » — et
   * l'attente qui suit, tirée entre une et cinq secondes, reste imprévisible.
   */
  useEffect(() => {
    if (phase !== "compte") return;
    // Tout se décide DANS le minuteur, jamais dans le corps de l'effet : poser
    // un état en synchrone ici relance un rendu qui relance l'effet, et la règle
    // `react-hooks/set-state-in-effect` le refuse — à raison, on l'a déjà payé
    // ailleurs.
    const battement = setTimeout(() => {
      if (compte <= 1) setPhase("attente");
      else setCompte((n) => n - 1);
    }, 1000);
    return () => clearTimeout(battement);
  }, [compte, phase]);

  useEffect(() => {
    if (phase !== "attente") return;
    const delai = MIN + Math.random() * ETENDUE;
    const passageAuVert = setTimeout(() => {
      vert.current = Date.now();
      setPhase("vert");
    }, delai);
    return () => clearTimeout(passageAuVert);
  }, [phase]);

  useEffect(() => {
    if (phase !== "vert") return;
    const trop = setTimeout(() => setPhase("consigne"), ABANDON);
    return () => clearTimeout(trop);
  }, [phase]);

  function toucher(joueurId: string) {
    // Une vibration courte confirme l'appui : sur un écran qui change de couleur
    // au même moment, le doigt doute de ce qu'il a fait.
    if (navigator.vibrate) navigator.vibrate(phase === "vert" ? 12 : [6, 40, 6]);
    if (phase === "attente" || phase === "compte") {
      setFautif(joueurId);
      const autre = joueurId === gauche.membreId ? droite : gauche;
      moteur.marquer([{ membreId: autre.membreId, delta: 1 }]);
      moteur.manche({ jeu: "plus-rapide", faute: joueurId, gagnant: autre.membreId });
      setPhase("faute");
      return;
    }
    if (phase !== "vert") return;
    setTemps(Date.now() - vert.current);
    setGagnant(joueurId);
    moteur.marquer([{ membreId: joueurId, delta: 1 }]);
    moteur.manche({ jeu: "plus-rapide", gagnant: joueurId, ms: Date.now() - vert.current });
    setPhase("resultat");
  }

  function suivante() {
    setTour(tour + 1);
    setGagnant(null);
    setFautif(null);
    setTemps(null);
    setCompte(COMPTE);
    setPhase("consigne");
  }

  if (phase === "consigne") {
    return (
      <div className="flex min-h-[62dvh] flex-col items-center justify-center px-6 text-center">
        <p className="text-[15px] uppercase tracking-[0.1em] text-encre-3">Duel</p>
        <p className="mt-3 text-[26px] font-semibold tracking-tight">
          {gauche.pseudo} <span className="text-encre-3">contre</span> {droite.pseudo}
        </p>
        <p className="mt-3 max-w-[30ch] text-[15px] leading-snug text-encre-2">
          Un doigt chacun sur sa moitié d&apos;écran. L&apos;écran devient vert quand il
          veut. Toucher avant, c&apos;est perdu.
        </p>
        <button
          type="button"
          onClick={() => {
            setCompte(COMPTE);
            setPhase("compte");
          }}
          className="cible-tactile mt-7 w-full max-w-xs rounded-[var(--radius-pilule)] bg-encre px-4 py-3.5 text-[17px] font-semibold text-surface"
        >
          Prêts
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

  if (phase === "faute" || phase === "resultat") {
    const nom = phase === "faute"
      ? moteur.joueurs.find((j) => j.membreId === fautif)?.pseudo
      : moteur.joueurs.find((j) => j.membreId === gagnant)?.pseudo;
    return (
      <div className="flex min-h-[62dvh] flex-col items-center justify-center px-6 text-center">
        <p className="text-[26px] font-semibold tracking-tight">
          {phase === "faute" ? `${nom} a touché trop tôt` : `${nom} !`}
        </p>
        {temps !== null && (
          // Le temps est le résultat du jeu, pas une note de bas de page : il se
          // lit de l'autre bout du canapé, comme le nom du vainqueur.
          <p className="chiffres mt-3 text-[64px] font-semibold tabular-nums leading-none tracking-tight">
            {temps}
            <span className="ml-2 text-[20px] font-normal text-encre-3">ms</span>
          </p>
        )}
        <button
          type="button"
          onClick={suivante}
          className="cible-tactile mt-7 w-full max-w-xs rounded-[var(--radius-pilule)] bg-encre px-4 py-3.5 text-[17px] font-semibold text-surface"
        >
          Manche suivante
        </button>
      </div>
    );
  }

  return (
    <div
      className={`relative flex min-h-[78dvh] select-none items-center justify-center transition-colors duration-75 ${
        phase === "vert" ? "bg-[var(--joie-haut)]" : "bg-surface-2"
      }`}
      style={{ touchAction: "none" }}
    >
      <button
        type="button"
        aria-label={`${gauche.pseudo} touche`}
        onClick={() => toucher(gauche.membreId)}
        className="absolute inset-y-0 left-0 w-1/2"
      />
      <button
        type="button"
        aria-label={`${droite.pseudo} touche`}
        onClick={() => toucher(droite.membreId)}
        className="absolute inset-y-0 right-0 w-1/2"
      />
      <p
        className={`pointer-events-none font-semibold tracking-tight ${
          phase === "compte" ? "chiffres text-[120px] tabular-nums leading-none" : "text-[30px]"
        }`}
      >
        {phase === "compte" ? compte : phase === "vert" ? "MAINTENANT" : "attends…"}
      </p>
    </div>
  );
}
