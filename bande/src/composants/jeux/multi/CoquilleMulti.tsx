"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import {
  actionAgir,
  actionMarquer,
  actionPublierPhase,
  actionReprendreLaMain,
  actionTerminerPartie,
} from "@/lib/actions-jeux";
import { MAX_GORGEES, PALIER_EAU } from "@/lib/jeux/cadre";
import type { Jeu } from "@/lib/jeux/catalogue";
import { recetteDe, type ContexteTirage, type Recette } from "@/lib/jeux/recettes";
import { generateur } from "@/lib/jeux/tirage";
import type { EtatPartie, FinDePartie, Joueur } from "@/lib/jeux/types";
import { RESSORT } from "@/lib/mouvement";

import { BarreScore } from "../BarreScore";
import { Podium } from "../Podium";
import { useEcranEveille } from "../ecranEveille";
import { useFluxPartie } from "../fluxPartie";
import { EcranReflexe } from "./EcranReflexe";
import { EcranTour } from "./EcranTour";
import { EcranVote } from "./EcranVote";
import { PHASES, acteurDe, reponsesDe, toutLeMondeARepondu } from "./protocole";

/**
 * Ce que la coquille donne aux trois écrans d'archétype.
 *
 * Écrit à la main plutôt que déduit du composant : un type déduit change sans
 * prévenir quand on touche à l'implémentation, et c'est un contrat entre
 * quatre fichiers.
 */
export type MoteurMulti = {
  etat: EtatPartie;
  recette: Recette;
  joueurs: Joueur[];
  moi: string;
  jeSuisHote: boolean;
  /** Le joueur dont c'est le tour, pour les jeux qui en ont un. */
  acteur: string | null;
  /** Écart entre l'horloge du serveur et celle d'ici, en millisecondes. */
  decalage: number;
  repondre: (donnees: Record<string, unknown>) => void;
  suivante: () => void;
  terminer: () => void;
};

/**
 * Et surtout : **aucun écran ne publie de phase**. Un temps, celui du juge le
 * faisait — `publierPhase` est réservé à l'hôte, l'appel échouait en silence dès
 * que le juge n'était pas l'hôte, et la partie restait figée sur son choix. Un
 * écran envoie des actions (`repondre`) ; faire avancer la partie est le travail
 * de la coquille, et seulement chez l'hôte. `publier` ne sort donc pas d'ici.
 */

/**
 * La coquille du multi : elle synchronise, les jeux jouent.
 *
 * ## Qui décide quoi
 *
 * Le serveur garde l'état, l'**hôte** le fait avancer, et tout le monde envoie
 * des actions. Ce partage a une raison précise : mettre les règles des dix
 * jeux dans le serveur l'aurait transformé en moteur de jeu, alors qu'il n'a
 * qu'une garantie à donner — que les trois écrans lisent la même phase au même
 * moment. Les règles restent donc dans les recettes, côté client, et l'hôte
 * est simplement celui dont le navigateur les applique.
 *
 * Le risque évident — l'hôte ferme son téléphone — est traité par le transfert
 * d'hôte : `quitterSalon` passe la main, et l'échéance de phase permet à
 * n'importe qui de constater qu'on attend depuis trop longtemps.
 *
 * ## Ce que l'hôte fait, et quand
 *
 * Il publie la première question, puis il regarde : dès que tous les présents
 * ont répondu, il publie la révélation ; quand quelqu'un demande la suite, il
 * publie la manche suivante. Rien d'autre. Un `useEffect` qui surveille l'état
 * suffit, à condition de ne jamais publier deux fois la même chose — d'où la
 * référence qui retient ce qui a déjà été publié.
 */
export function CoquilleMulti({
  initial,
  jeu,
  moi,
  contexte,
}: {
  initial: EtatPartie;
  jeu: Jeu;
  moi: string;
  contexte: Omit<ContexteTirage, "manche" | "hasard" | "joueurs">;
}) {
  const { etat, relie, decalage } = useFluxPartie(initial.partie.id, initial);
  const [fin, setFin] = useState<FinDePartie | null>(null);
  const [eau, setEau] = useState(false);
  const router = useRouter();
  const recette = recetteDe(jeu.cle);

  useEcranEveille(fin === null);

  const partieId = initial.partie.id;
  const joueurs = etat?.partie.joueurs ?? initial.partie.joueurs;
  const jeSuisHote = etat?.hoteId === moi;
  const phase = etat?.phase ?? null;
  const acteur = etat ? acteurDe(etat) : null;

  /** Le tirage est semé par le numéro de manche : reproductible, et varié. */
  const tirage = useCallback(
    (manche: number): ContexteTirage => ({
      ...contexte,
      manche,
      joueurs,
      hasard: generateur(manche * 7919 + partieId.length),
    }),
    [contexte, joueurs, partieId],
  );

  const publier = useCallback(
    (nom: string, donnees: Record<string, unknown>, manche?: number, delai?: number | null) => {
      void actionPublierPhase(partieId, { nom, donnees, manche, delai });
    },
    [partieId],
  );

  const repondre = useCallback(
    (donnees: Record<string, unknown>) => {
      if (!etat?.phase) return;
      void actionAgir(partieId, etat.manche, etat.phase, donnees);
    },
    [etat, partieId],
  );

  // Ce qui a déjà été publié, pour ne pas le republier à chaque battement du
  // flux. La clé est « manche:phase » — deux manches peuvent avoir la même
  // phase, et c'est justement le cas normal.
  const publie = useRef<Set<string>>(new Set());

  const lancerManche = useCallback(
    (manche: number) => {
      if (!recette) return;
      const contexteManche = tirage(manche);
      const acteurDeLaManche = recette.acteur?.(contexteManche) ?? null;
      const donnees = { ...recette.tirer(contexteManche), acteur: acteurDeLaManche };

      // « Menteur » commence par une préparation : l'acteur écrit ses trois
      // affirmations avant que quiconque puisse voter.
      const premiere =
        jeu.cle === "menteur" ? PHASES.preparation
        : recette.archetype === "reflexe" ? PHASES.depart
        : PHASES.question;

      if (recette.archetype === "reflexe") {
        // Entre deux et cinq secondes, tirées côté hôte et annoncées à tous en
        // instant ABSOLU : chaque téléphone compte à rebours chez lui, et le
        // réseau n'entre pas dans le geste.
        const attente = 2000 + Math.floor(contexteManche.hasard() * 3000);
        publier(premiere, { ...donnees, departA: new Date(Date.now() + attente).toISOString() }, manche, 15_000);
      } else {
        publier(premiere, donnees, manche, jeu.cle === "menteur" ? 90_000 : 60_000);
      }
    },
    [jeu.cle, publier, recette, tirage],
  );

  /**
   * L'animateur : ce que fait le navigateur de l'hôte, et lui seul.
   *
   * Il ne fait avancer que ce qui est mécanique — « tout le monde a répondu,
   * donc on révèle ». Le passage à la manche suivante, lui, reste un geste
   * humain : enchaîner tout seul ne laisserait pas le temps de lire le
   * résultat, et c'est là que se passe la moitié de la soirée.
   */
  useEffect(() => {
    if (!etat || !jeSuisHote || !recette || fin !== null) return;
    if (etat.etat !== "encours") return;

    // Rien n'a encore été publié : on ouvre la première manche.
    if (!etat.phase) {
      const cle = "1:depart";
      if (!publie.current.has(cle)) {
        publie.current.add(cle);
        lancerManche(1);
      }
      return;
    }

    const cle = `${etat.manche}:${etat.phase}:suite`;
    if (publie.current.has(cle)) return;

    const acteurCourant = acteurDe(etat);
    const reponses = reponsesDe(etat, etat.phase);

    // L'acteur a fini de préparer : on ouvre le vote avec ce qu'il a écrit.
    if (etat.phase === PHASES.preparation) {
      const sienne = reponses.find((r) => r.membreId === acteurCourant);
      if (sienne) {
        publie.current.add(cle);
        publier(PHASES.question, { ...etat.donneesPhase, ...sienne.donnees }, etat.manche, 60_000);
      }
      return;
    }

    if (etat.phase === PHASES.question || etat.phase === PHASES.depart) {
      // Deux jeux « tour » ne se terminent pas sur un vote mais sur le geste de
      // L'ACTEUR : « Devine qui je suis » (il dit « trouvé » ou « passer ») et
      // « Le jugement » (il désigne la réponse qui gagne). On révèle donc dès
      // que SA réponse est là, en la versant dans les données de la phase —
      // sans ça, `depouiller` ne verrait ni `trouve` ni `gagnant`, et la manche
      // resterait ouverte jusqu'à l'échéance.
      if (jeu.cle === "devine-qui" || jeu.cle === "jugement") {
        const sienne = reponses.find((r) => r.membreId === acteurCourant);
        if (sienne) {
          publie.current.add(cle);
          reveler({ ...etat.donneesPhase, ...sienne.donnees });
        }
        return;
      }

      if (toutLeMondeARepondu(etat, joueurs, etat.phase, acteurCourant)) {
        publie.current.add(cle);
        reveler(etat.donneesPhase);
      }
    }

    function reveler(donnees: Record<string, unknown>) {
      if (!etat || !recette) return;
      const bilan = recette.depouiller(donnees, reponsesDe(etat, etat.phase ?? ""), joueurs);
      if (bilan.gains.length > 0) void actionMarquer(partieId, bilan.gains);
      publier(
        PHASES.revelation,
        {
          ...donnees,
          verdict: bilan.verdict,
          // Le cadre plafonne ici, une fois pour toutes : un jeu ne doit pas
          // pouvoir demander huit gorgées parce qu'on a mal compté.
          gorgees: bilan.gorgees.map((g) => ({
            ...g,
            nombre: Math.min(MAX_GORGEES, g.nombre),
          })),
          gains: bilan.gains,
        },
        etat.manche,
        null,
      );
    }
  }, [etat, fin, jeSuisHote, jeu.cle, joueurs, lancerManche, partieId, publier, recette]);

  /**
   * L'échéance d'une phase : au-delà, on avance sans les retardataires.
   *
   * C'est ce qui empêche une partie de rester bloquée sur quelqu'un dont le
   * téléphone s'est éteint. La surveillance est locale et non pilotée par le
   * flux : aucune version ne change quand une échéance passe — il ne se passe
   * précisément RIEN, et c'est justement le problème à traiter.
   */
  useEffect(() => {
    if (!etat || !jeSuisHote || !recette || fin !== null) return;
    if (!etat.echeance || etat.phase === PHASES.revelation) return;

    const reste = new Date(etat.echeance).getTime() - Date.now() + decalage;
    const minuteur = setTimeout(
      () => {
        const cle = `${etat.manche}:${etat.phase}:echeance`;
        if (publie.current.has(cle)) return;
        publie.current.add(cle);
        const bilan = recette.depouiller(
          etat.donneesPhase,
          reponsesDe(etat, etat.phase ?? ""),
          joueurs,
        );
        if (bilan.gains.length > 0) void actionMarquer(partieId, bilan.gains);
        publier(
          PHASES.revelation,
          {
            ...etat.donneesPhase,
            verdict: bilan.verdict || "Temps écoulé.",
            gorgees: bilan.gorgees.map((g) => ({ ...g, nombre: Math.min(MAX_GORGEES, g.nombre) })),
            gains: bilan.gains,
          },
          etat.manche,
          null,
        );
      },
      Math.max(0, reste),
    );
    return () => clearTimeout(minuteur);
  }, [decalage, etat, fin, jeSuisHote, joueurs, partieId, publier, recette]);

  /**
   * Reprendre la main quand l'hôte a disparu.
   *
   * Le dépôt refuse si l'hôte donne encore signe de vie : on peut donc essayer
   * sans risque, et sans avoir à trancher ici. Une seule tentative toutes les
   * dix secondes suffit — trois téléphones qui essaient en même temps, c'est
   * très bien, le premier gagne et les autres se voient refuser.
   */
  useEffect(() => {
    if (!etat || jeSuisHote || etat.etat !== "encours" || fin !== null) return;
    const hoteAbsent = etat.hoteId !== null && !etat.presents.includes(etat.hoteId);
    if (!hoteAbsent) return;
    const minuteur = setTimeout(() => void actionReprendreLaMain(partieId), 10_000);
    return () => clearTimeout(minuteur);
  }, [etat, fin, jeSuisHote, partieId]);

  /**
   * Quelqu'un d'autre a terminé la partie.
   *
   * Celui qui touche « Terminer » reçoit le podium dans la réponse de l'action ;
   * les autres l'apprennent par le flux, et il faut recharger — les récompenses
   * se lisent sur le serveur. Dans un EFFET, et **une seule fois** : appelé
   * pendant le rendu, `router.refresh()` reprogramme un rendu, qui le rappelle,
   * et ainsi de suite. Et comme un rafraîchissement recharge TOUTES les routes
   * en cache, deux téléphones suffisaient à noyer le serveur sous les requêtes
   * de quatre parties à la fois. La ligne était là depuis le début ; elle
   * n'avait jamais brûlé, parce que `etat` ne passait jamais à « finie ».
   */
  const finVue = useRef(false);
  useEffect(() => {
    if (!etat || etat.etat !== "finie" || finVue.current) return;
    finVue.current = true;
    router.refresh();
  }, [etat, router]);

  /** Le rappel d'eau, compté depuis le début de la PARTIE. */
  useEffect(() => {
    if (fin !== null) return;
    const debut = new Date(initial.partie.commenceeLe).getTime();
    const prochain = PALIER_EAU - ((Date.now() - debut) % PALIER_EAU);
    const minuteur = setTimeout(() => setEau(true), prochain);
    return () => clearTimeout(minuteur);
  }, [initial.partie.commenceeLe, fin, eau]);

  const suivante = useCallback(() => {
    if (!etat) return;
    lancerManche(etat.manche + 1);
  }, [etat, lancerManche]);

  const terminer = useCallback(() => {
    void actionTerminerPartie(partieId).then((r) => {
      if (r.valeur) setFin(r.valeur);
    });
  }, [partieId]);

  const moteur = useMemo<MoteurMulti | null>(
    () =>
      etat && recette
        ? {
            etat,
            recette,
            joueurs,
            moi,
            jeSuisHote,
            acteur,
            decalage,
            repondre,
            suivante,
            terminer,
          }
        : null,
    [acteur, decalage, etat, jeSuisHote, joueurs, moi, recette, repondre, suivante, terminer],
  );

  if (fin) {
    return <Podium joueurs={joueurs} recompenses={fin} />;
  }

  if (!etat || !moteur || !recette) {
    return (
      <p className="px-4 py-16 text-center text-[15px] text-encre-2">
        {recette ? "Un instant…" : "Ce jeu ne se joue pas encore à plusieurs téléphones."}
      </p>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* L'anneau sur l'avatar de celui dont c'est le tour : dans un jeu « tour »,
          savoir qui agit sans lire une phrase fait gagner une seconde à chaque
          manche, et c'est la seule information que la barre ajoute au score. */}
      <BarreScore joueurs={joueurs} tourDe={acteur} />

      {!relie && (
        <p role="status" className="bg-surface-2 px-4 py-1.5 text-center text-[12px] text-encre-3">
          Reconnexion…
        </p>
      )}

      <div className="flex-1">
        {/* Aucune phase publiée : la partie vient de se lancer, et l'hôte n'a pas
            encore distribué. Laisser l'écran d'archétype s'afficher donnerait
            des boutons qui ne font RIEN — la réponse part dans la phase en
            cours, et il n'y en a pas. C'est arrivé pour de vrai : un hôte qui
            ferme l'application dans la seconde qui suit le lancement, et deux
            écrans pleins de boutons morts jusqu'à la reprise de main. */}
        {etat.phase === null ? (
          <p
            role="status"
            className="flex min-h-[70dvh] items-center justify-center px-4 text-center text-[15px] text-encre-2"
          >
            L&apos;hôte distribue…
          </p>
        ) : recette.archetype === "reflexe" ? (
          <EcranReflexe moteur={moteur} />
        ) : recette.archetype === "tour" ? (
          <EcranTour moteur={moteur} jeu={jeu} />
        ) : (
          <EcranVote moteur={moteur} />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
        <span className="text-[12px] text-encre-3">
          Manche {etat.manche} · {phase === PHASES.revelation ? "résultat" : "en cours"}
        </span>
        <button
          type="button"
          onClick={terminer}
          className="cible-tactile px-2 py-1.5 text-[13px] text-encre-3 underline underline-offset-2"
        >
          Terminer
        </button>
      </div>

      <AnimatePresence>
        {eau && (
          <motion.button
            type="button"
            onClick={() => setEau(false)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={RESSORT.moyen}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-50 rounded-[var(--radius-pilule)] px-4 py-3 text-[14px] font-medium shadow-[var(--ombre-2)]"
          >
            Un verre d&apos;eau, pour tout le monde. Touche pour continuer.
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

