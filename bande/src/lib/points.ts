/**
 * Les points.
 *
 * Ils portent sur **la présence, l'attention aux autres et les jeux**, jamais
 * sur qui va le mieux. Une journée à 1 rapporte exactement autant qu'une
 * journée à 10 — c'est la règle qui tient tout le reste, et elle n'est pas
 * négociable : le jour où poster un 9 rapporte plus qu'un 3, personne n'écrit
 * plus un 3.
 *
 * ## Deux écarts assumés au barème d'origine
 *
 * **Pas de points pour la série.** Le plan en donnait deux par jour consécutif.
 * Mais on vient de retirer du profil les trois compteurs de série, parce qu'un
 * journal n'est pas un tableau de performance ; les remettre sous forme de
 * points serait se contredire d'un lot à l'autre, et rétablir exactement ce
 * qu'on venait d'enlever. Une série cassée doit dire « on repart », pas coûter
 * quelque chose.
 *
 * **Pas de classement hebdomadaire.** À trois, un classement de points est un
 * classement de présence, même déguisé. Les niveaux, eux, restent : ils
 * montent seuls et ne se comparent à personne.
 *
 * Ces deux écarts sont dans ETAT.md. Si la bande les veut quand même, tout est
 * ici, en un endroit.
 */
import { PLAFOND_JEUX } from "./jeux/recompense";
import type { Entree } from "./types";

/** Le barème, en un seul endroit. */
export const BAREME = {
  journee: 10,
  anecdote: 5,
  vocal: 8,
  media: 5,
  lieu: 2,
  reactionDonnee: 1,
  commentaire: 2,
  scelle: 5,
  partie: 10,
  podium: [30, 15, 5],
} as const;

/** Une anecdote plus courte que ça n'en est pas une. */
export const LONGUEUR_ANECDOTE = 20;
/** Au-delà, on n'illustre plus, on remplit. */
export const MEDIAS_COMPTES = 2;
/** Par jour, hors jeux. Empêche de gonfler son score en réagissant à tout. */
export const PLAFOND_QUOTIDIEN = 100;
export const REACTIONS_PAR_JOUR = 10;
export const COMMENTAIRES_PAR_JOUR = 10;

/** Ce qu'une journée rapporte à celui qui l'a posée. */
export function pointsJournee(entree: Entree): number {
  let points = BAREME.journee;
  if (entree.note && entree.note.trim().length >= LONGUEUR_ANECDOTE) points += BAREME.anecdote;
  if (entree.audio) points += BAREME.vocal;
  points += Math.min(entree.photos.length, MEDIAS_COMPTES) * BAREME.media;
  if (entree.etiquettes.length > 0) points += BAREME.lieu;
  return points;
}

export type Ardoise = {
  /** Le total après plafond. */
  total: number;
  /** Le détail, pour l'expliquer plutôt que d'annoncer un nombre. */
  detail: { quoi: string; points: number }[];
};

/**
 * L'ardoise d'une personne, sur tout son historique.
 *
 * Le plafond est **quotidien**, pas global : c'est ce qui empêche de gonfler
 * son score en une soirée sans punir quelqu'un qui tient depuis un an.
 */
export function ardoise(
  entrees: Entree[],
  membreId: string,
  scelles: { auteurId: string; creeLe: string }[] = [],
  parties: { membreId: string; jour: string; points: number }[] = [],
): Ardoise {
  const parJour = new Map<string, number>();
  const detail = new Map<string, number>();

  const ajouter = (jour: string, quoi: string, points: number) => {
    if (points <= 0) return;
    parJour.set(jour, (parJour.get(jour) ?? 0) + points);
    detail.set(quoi, (detail.get(quoi) ?? 0) + points);
  };

  /**
   * Les gestes se comptent PAR JOUR, pas par journée lue.
   *
   * La première version plafonnait à dix réactions sur chaque entrée prise
   * séparément : réagir à vingt-cinq journées le même soir rapportait
   * vingt-cinq points, alors que c'est exactement le geste que le plafond
   * doit décourager. On additionne d'abord, on plafonne ensuite.
   */
  const reactions = new Map<string, number>();
  const commentaires = new Map<string, number>();

  for (const entree of entrees) {
    if (entree.profil === membreId) {
      ajouter(entree.jour, "journées posées", pointsJournee(entree));
      // Réagir ou commenter chez soi ne rapporte rien : le barème récompense
      // l'attention aux autres.
      continue;
    }

    const donnees = entree.reactions.filter((r) => r.parQui.includes(membreId)).length;
    if (donnees > 0) reactions.set(entree.jour, (reactions.get(entree.jour) ?? 0) + donnees);

    const miens = entree.commentaires.filter((c) => c.auteurId === membreId).length;
    if (miens > 0) commentaires.set(entree.jour, (commentaires.get(entree.jour) ?? 0) + miens);
  }

  for (const [jour, combien] of reactions) {
    ajouter(jour, "réactions données", Math.min(combien, REACTIONS_PAR_JOUR) * BAREME.reactionDonnee);
  }
  for (const [jour, combien] of commentaires) {
    ajouter(jour, "commentaires", Math.min(combien, COMMENTAIRES_PAR_JOUR) * BAREME.commentaire);
  }

  for (const scelle of scelles) {
    if (scelle.auteurId === membreId) ajouter(scelle.creeLe, "scellés", BAREME.scelle);
  }

  let total = [...parJour.values()].reduce((s, v) => s + Math.min(v, PLAFOND_QUOTIDIEN), 0);

  /**
   * Les jeux passent à côté du plafond de cent — le plan dit « hors jeux » —
   * mais pas à côté de tout plafond. Ils ont le leur, et pour la même raison :
   * une soirée de jeux doit compter, une nuit blanche ne doit pas compter
   * double. Voir `jeux/recompense.ts`, où le choix est argumenté.
   */
  const jeuxParJour = new Map<string, number>();
  for (const partie of parties) {
    if (partie.membreId !== membreId) continue;
    jeuxParJour.set(partie.jour, (jeuxParJour.get(partie.jour) ?? 0) + partie.points);
  }
  let gagnesEnJouant = 0;
  for (const points of jeuxParJour.values()) gagnesEnJouant += Math.min(points, PLAFOND_JEUX);
  if (gagnesEnJouant > 0) {
    detail.set("parties jouées", gagnesEnJouant);
    total += gagnesEnJouant;
  }

  return {
    total,
    detail: [...detail.entries()]
      .map(([quoi, points]) => ({ quoi, points }))
      .sort((a, b) => b.points - a.points),
  };
}

/**
 * Les cinq paliers.
 *
 * Les noms sont là pour faire sourire, pas pour hiérarchiser : personne n'est
 * « meilleur » qu'un autre parce qu'il a posté plus longtemps.
 */
export const NIVEAUX = [
  { seuil: 0, nom: "Nouvelle recrue" },
  { seuil: 250, nom: "Habitué du soir" },
  { seuil: 900, nom: "Pilier du groupe" },
  { seuil: 2500, nom: "Mémoire de la bande" },
  { seuil: 6000, nom: "Légende vivante" },
] as const;

export type Niveau = {
  nom: string;
  rang: number;
  /** Ce qu'il reste avant le palier suivant, ou null au dernier. */
  restant: number | null;
  /** L'avancement dans le palier courant, de 0 à 1. */
  part: number;
};

export function niveau(points: number): Niveau {
  let rang = 0;
  for (let i = 0; i < NIVEAUX.length; i += 1) if (points >= NIVEAUX[i].seuil) rang = i;

  const bas = NIVEAUX[rang].seuil;
  const haut = NIVEAUX[rang + 1]?.seuil ?? null;
  return {
    nom: NIVEAUX[rang].nom,
    rang: rang + 1,
    restant: haut === null ? null : haut - points,
    // Au dernier palier, la barre est pleine : elle ne peut plus rien annoncer.
    part: haut === null ? 1 : Math.max(0, Math.min(1, (points - bas) / (haut - bas))),
  };
}
