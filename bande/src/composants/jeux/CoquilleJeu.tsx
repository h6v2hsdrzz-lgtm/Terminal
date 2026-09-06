"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import {
  actionAbandonnerPartie,
  actionEnregistrerManche,
  actionMarquer,
  actionTerminerPartie,
} from "@/lib/actions-jeux";
import type { Joueur, Partie } from "@/lib/jeux/types";
import type { Jeu } from "@/lib/jeux/catalogue";
import { PALIER_EAU } from "@/lib/jeux/cadre";
import { RESSORT } from "@/lib/mouvement";

import { BarreScore } from "./BarreScore";
import { Podium } from "./Podium";
import { useEcranEveille } from "./ecranEveille";

/**
 * La coquille : tout ce qui est vrai pour les dix jeux.
 *
 * Barre de score, écran éveillé, rappel d'eau, abandon, podium de fin. Un jeu
 * qui vit ici n'a plus qu'à s'occuper de ce qui le distingue.
 *
 * **Le score est tenu en local et poussé au serveur, pas relu après chaque
 * point.** Un aller-retour entre chaque manche ferait clignoter la barre, et
 * un téléphone qu'on se passe n'attend pas le réseau. Le serveur reste
 * l'autorité — il incrémente, il ne se fait pas dicter un total — mais
 * l'affichage n'attend pas sa réponse.
 */
export type Moteur = {
  joueurs: Joueur[];
  /** Ajouter (ou retirer) des points. L'écran bouge tout de suite. */
  marquer: (points: { membreId: string; delta: number }[]) => void;
  /** Ranger une manche pour pouvoir la relire. Sans attendre non plus. */
  manche: (donnees: Record<string, unknown>, membreId?: string | null) => void;
  /** Finir la partie et montrer le podium. */
  terminer: () => void;
  /**
   * Passer en plein écran, sans barre ni pied de page.
   *
   * Une manche de « Devine qui je suis » se joue téléphone sur le front,
   * pendant que deux personnes tapent l'écran : « Terminer » et « Abandonner »
   * à quelques millimètres du pouce, c'est une partie qui s'arrête au milieu
   * d'une manche sans que personne ne l'ait voulu.
   */
  pleinEcran: (actif: boolean) => void;
};

export function CoquilleJeu({
  partie,
  jeu,
  tourDe,
  children,
}: {
  partie: Partie;
  jeu: Jeu;
  tourDe?: string | null;
  children: (moteur: Moteur) => ReactNode;
}) {
  const [joueurs, setJoueurs] = useState<Joueur[]>(partie.joueurs);
  const [fin, setFin] = useState<{ membreId: string; place: number; points: number }[] | null>(null);
  const [confirmeAbandon, setConfirmeAbandon] = useState(false);
  const [plein, setPlein] = useState(false);
  const [eau, setEau] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const router = useRouter();

  useEcranEveille(fin === null);

  /**
   * Le rappel d'eau, toutes les trente minutes.
   *
   * Il compte à partir du début de la PARTIE, pas de l'ouverture de la page :
   * un rafraîchissement ne doit pas remettre le compteur à zéro.
   */
  useEffect(() => {
    if (fin !== null) return;
    const debut = new Date(partie.commenceeLe).getTime();
    const prochain = PALIER_EAU - ((Date.now() - debut) % PALIER_EAU);
    const minuteur = setTimeout(() => setEau(true), prochain);
    return () => clearTimeout(minuteur);
  }, [partie.commenceeLe, fin, eau]);

  const marquer = useCallback(
    (points: { membreId: string; delta: number }[]) => {
      setJoueurs((avant) =>
        avant.map((j) => {
          const gain = points.find((p) => p.membreId === j.membreId);
          return gain ? { ...j, points: j.points + gain.delta } : j;
        }),
      );
      void actionMarquer(partie.id, points).then((r) => {
        if (r.erreur) setErreur(r.erreur);
      });
    },
    [partie.id],
  );

  const manche = useCallback(
    (donnees: Record<string, unknown>, membreId?: string | null) => {
      // Le numéro est attribué par le serveur : deux manches envoyées coup sur
      // coup depuis l'écran porteraient sinon le même.
      void actionEnregistrerManche(partie.id, { membreId: membreId ?? null, donnees });
    },
    [partie.id],
  );

  const terminer = useCallback(() => {
    void actionTerminerPartie(partie.id).then((r) => {
      if (r.erreur || !r.valeur) {
        setErreur(r.erreur ?? "La partie n'a pas pu être close.");
        return;
      }
      setFin(r.valeur);
    });
  }, [partie.id]);

  const pleinEcran = useCallback((actif: boolean) => setPlein(actif), []);

  /**
   * Le moteur est mémorisé.
   *
   * Sans ça, il change d'identité à chaque rendu, et tout effet d'un jeu qui en
   * dépend se rejoue à chaque rendu — y compris celui qui demande le plein
   * écran, qui se remettrait à courir après lui-même.
   */
  const moteur = useMemo<Moteur>(
    () => ({ joueurs, marquer, manche, terminer, pleinEcran }),
    [joueurs, marquer, manche, terminer, pleinEcran],
  );

  function abandonner() {
    void actionAbandonnerPartie(partie.id).then(() => router.push("/jeux"));
  }

  if (fin) return <Podium joueurs={joueurs} recompenses={fin} />;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {!plein && (
        <div className="sticky top-0 z-30 zone-sure-haute">
          <BarreScore joueurs={joueurs} tourDe={tourDe} />
        </div>
      )}

      <AnimatePresence>
        {eau && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={RESSORT.moyen}
            className="border-b border-trait bg-surface-2 px-4 py-2.5"
          >
            <p className="text-[14px] text-encre-2">
              Un verre d&apos;eau, quelque part par là.{" "}
              <button
                type="button"
                onClick={() => setEau(false)}
                className="underline underline-offset-2"
              >
                D&apos;accord
              </button>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1">{children(moteur)}</main>

      {erreur && (
        <p role="alert" className="px-4 py-2 text-[14px] text-[var(--alerte)]">
          {erreur}
        </p>
      )}

      {!plein && (
      <footer className="border-t border-trait px-4 py-3 zone-sure-basse">
        {confirmeAbandon ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14px] text-encre-2">
              La partie s&apos;efface et ne rapporte rien. Sûr ?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmeAbandon(false)}
                className="cible-tactile rounded-[var(--radius-pilule)] px-3 py-2 text-[14px] text-encre-2"
              >
                Non
              </button>
              <button
                type="button"
                onClick={abandonner}
                className="cible-tactile rounded-[var(--radius-pilule)] bg-surface-3 px-3 py-2 text-[14px] font-semibold"
              >
                Abandonner
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-encre-3">{jeu.nom}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmeAbandon(true)}
                className="cible-tactile rounded-[var(--radius-pilule)] px-3 py-2 text-[14px] text-encre-3"
              >
                Abandonner
              </button>
              <button
                type="button"
                onClick={terminer}
                className="cible-tactile rounded-[var(--radius-pilule)] bg-surface-3 px-3 py-2 text-[14px] font-semibold"
              >
                Terminer
              </button>
            </div>
          </div>
        )}
      </footer>
      )}
    </div>
  );
}
