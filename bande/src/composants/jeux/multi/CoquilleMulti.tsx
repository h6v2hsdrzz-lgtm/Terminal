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
import { EcranFond } from "./EcranFond";
import { EcranParole } from "./EcranParole";
import { EcranReflexe } from "./EcranReflexe";
import { EcranTour } from "./EcranTour";
import { EcranVote } from "./EcranVote";
import { COMPTE_MS, PHASES, acteurDe, reponsesDe, toutLeMondeARepondu } from "./protocole";
import { sansSilence } from "@/lib/reseau";

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
  /** Retourner les cartes maintenant. Réservé à l'hôte, et aux jeux sans fin. */
  revelerMaintenant: () => void;
  /**
   * Les réglages de la partie — le mode duel de « Le plus rapide », par
   * exemple. Seul l'hôte peut les changer, et le changement prend effet **à la
   * manche suivante** : on ne change pas la règle au milieu d'un tour.
   */
  options: Record<string, unknown>;
  reglerOption: (nom: string, valeur: unknown) => void;
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
  contexte: Omit<ContexteTirage, "manche" | "hasard" | "joueurs" | "options">;
}) {
  const { etat, relie, decalage } = useFluxPartie(initial.partie.id, initial);
  const [fin, setFin] = useState<FinDePartie | null>(null);
  const [eau, setEau] = useState(false);
  /**
   * Les réglages, chez l'hôte, recopiés dans CHAQUE phase publiée.
   *
   * Les garder seulement ici les perdrait au premier rechargement, et les
   * autres téléphones ne les connaîtraient jamais. En les versant dans les
   * données de la phase, ils voyagent avec elle : celui qui rejoint en cours de
   * partie joue avec les mêmes règles, sans rien demander.
   */
  const [options, setOptions] = useState<Record<string, unknown>>(
    () => (initial.donneesPhase.options as Record<string, unknown> | undefined) ?? {},
  );
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
      options,
      hasard: generateur(manche * 7919 + partieId.length),
    }),
    [contexte, joueurs, options, partieId],
  );

  /**
   * Publier, et le dire si ça ne part pas.
   *
   * Une phase qui n'arrive pas au serveur, c'est trois écrans figés sur la
   * précédente, sans rien pour l'expliquer. Le bouton « Réessayer » du bandeau
   * renvoie exactement la même phase — et il disparaît dès qu'une autre action
   * passe, ce qui évite de rejouer une phase périmée dix minutes plus tard.
   */
  const publier = useCallback(
    (nom: string, donnees: Record<string, unknown>, manche?: number, delai?: number | null) => {
      void sansSilence(
        () => actionPublierPhase(partieId, { nom, donnees, manche, delai }),
        "La manche",
      );
    },
    [partieId],
  );

  /**
   * Répondre, et le dire si ça ne part pas.
   *
   * C'est l'appel le plus coûteux à perdre de toute l'application : la manche
   * attend une réponse qui n'arrivera jamais, et personne ne sait pourquoi.
   * `agir` fait un `upsert` sur (partie, manche, phase, joueur) : renvoyer deux
   * fois la même réponse ne crée pas deux votes.
   */
  const repondre = useCallback(
    (donnees: Record<string, unknown>) => {
      if (!etat?.phase) return;
      const manche = etat.manche;
      const phase = etat.phase;
      void sansSilence(() => actionAgir(partieId, manche, phase, donnees), "Ta réponse");
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
      // Les réglages voyagent avec la phase : ils survivent au rechargement, et
      // celui qui rejoint en cours de partie joue avec les mêmes règles.
      const donnees = { ...recette.tirer(contexteManche), acteur: acteurDeLaManche, options };

      // « Menteur » commence par une préparation : l'acteur écrit ses trois
      // affirmations avant que quiconque puisse voter.
      const premiere =
        jeu.cle === "menteur" ? PHASES.preparation
        : recette.archetype === "reflexe" ? PHASES.depart
        : PHASES.question;

      if (recette.archetype === "reflexe") {
        // Deux instants ABSOLUS, annoncés à l'avance : celui où le décompte
        // 3-2-1 commence, et celui du vert. Entre les deux, une attente tirée au
        // sort entre une et cinq secondes — sans elle on part sur le « 1 », et
        // le jeu ne mesure plus rien. Chaque téléphone compte chez lui : le
        // réseau n'entre pas dans le geste.
        //
        // Une seconde de battement avant le décompte laisse à l'écran le temps
        // d'arriver chez les trois.
        const compte = Date.now() + 1_000;
        const attente = 1_000 + Math.floor(contexteManche.hasard() * 4_000);
        publier(
          premiere,
          {
            ...donnees,
            compteA: new Date(compte).toISOString(),
            departA: new Date(compte + COMPTE_MS + attente).toISOString(),
          },
          manche,
          20_000,
        );
      } else {
        publier(premiere, donnees, manche, echeanceDe(jeu.cle, recette.archetype, donnees));
      }
    },
    [jeu.cle, options, publier, recette, tirage],
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

      // Un jeu de FOND ne se révèle pas tout seul : il dure toute la soirée, et
      // personne n'accuse forcément. C'est l'hôte qui décide de retourner les
      // cartes, avec son bouton.
      if (recette.archetype === "fond") return;

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
    // Un jeu au meilleur de cinq s'arrête tout seul : « on remet ça » une
    // sixième fois transformerait un tournoi en boucle sans fin, et personne
    // n'irait chercher le bouton « Terminer » en bas de l'écran.
    if (recette?.manches && etat.manche >= recette.manches) {
      void actionTerminerPartie(partieId).then((r) => {
        if (r.valeur) setFin(r.valeur);
      });
      return;
    }
    lancerManche(etat.manche + 1);
  }, [etat, lancerManche, partieId, recette]);

  /**
   * Retourner les cartes maintenant, parce que l'hôte l'a décidé.
   *
   * « Le mot de passe » n'a pas de fin mécanique — il n'y a pas de moment où
   * « tout le monde a répondu », puisque personne n'est obligé d'accuser. Ce
   * bouton est donc le seul chemin vers la révélation, et il refait exactement
   * ce que fait l'animateur quand une manche se termine toute seule.
   */
  const revelerMaintenant = useCallback(() => {
    if (!etat || !recette || !etat.phase) return;
    // Pas de garde contre le double appui, et c'est voulu : republier la même
    // révélation la réécrit à l'identique. La garde qui existe ailleurs sert à
    // empêcher l'ANIMATEUR de republier à chaque battement du flux, pas à
    // protéger un bouton — et consulter une référence ici rendrait tout le
    // moteur « dérivé d'une référence » aux yeux de `react-hooks/refs`, qui
    // refuserait alors qu'on le lise pendant le rendu.
    const bilan = recette.depouiller(etat.donneesPhase, reponsesDe(etat, etat.phase), joueurs);
    if (bilan.gains.length > 0) void actionMarquer(partieId, bilan.gains);
    publier(
      PHASES.revelation,
      {
        ...etat.donneesPhase,
        verdict: bilan.verdict,
        gorgees: bilan.gorgees.map((g) => ({ ...g, nombre: Math.min(MAX_GORGEES, g.nombre) })),
        gains: bilan.gains,
      },
      etat.manche,
      null,
    );
  }, [etat, joueurs, partieId, publier, recette]);

  const reglerOption = useCallback((nom: string, valeur: unknown) => {
    setOptions((avant) => ({ ...avant, [nom]: valeur }));
  }, []);

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
            revelerMaintenant,
            options,
            reglerOption,
          }
        : null,
    [
      acteur,
      decalage,
      etat,
      jeSuisHote,
      joueurs,
      moi,
      options,
      recette,
      reglerOption,
      repondre,
      revelerMaintenant,
      suivante,
      terminer,
    ],
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
        ) : recette.archetype === "parole" ? (
          <EcranParole moteur={moteur} jeu={jeu} />
        ) : recette.archetype === "fond" ? (
          <EcranFond moteur={moteur} />
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

/**
 * Combien de temps avant qu'on avance sans les retardataires.
 *
 * Une échéance trop courte coupe la parole ; une échéance absente laisse la
 * partie figée sur un téléphone éteint. Chaque forme a la sienne :
 *
 * · **parole** — la durée de l'enregistrement, plus deux minutes pour écouter
 *   et noter. Soixante secondes y auraient coupé le micro en plein plaidoyer ;
 * · **fond** — aucune. « Le mot de passe » dure la soirée, et c'est l'hôte qui
 *   retourne les cartes ;
 * · **menteur** — quatre-vingt-dix secondes : on y écrit trois phrases ;
 * · le reste — une minute, le temps d'un vote.
 */
function echeanceDe(
  cle: string,
  archetype: string,
  donnees: Record<string, unknown>,
): number | null {
  if (archetype === "fond") return null;
  if (archetype === "parole") {
    const secondes = typeof donnees.secondes === "number" ? donnees.secondes : 60;
    return secondes * 1000 + 120_000;
  }
  return cle === "menteur" ? 90_000 : 60_000;
}
