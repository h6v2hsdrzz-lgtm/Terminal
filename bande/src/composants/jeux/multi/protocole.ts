import type { ActionDeJoueur, EtatPartie, Joueur } from "@/lib/jeux/types";
import type { Reponse } from "@/lib/jeux/recettes";

/**
 * Le vocabulaire commun des dix jeux à plusieurs téléphones.
 *
 * Les noms de phase sont des chaînes parce qu'ils voyagent en JSON, mais ils
 * sont énumérés ici : une faute de frappe dans un nom de phase donnerait un
 * écran vide chez une personne sur trois, et c'est le genre de bogue qu'on ne
 * reproduit jamais au bon moment.
 *
 * Il n'y a **pas** de phase d'arbitrage. Quand l'acteur tranche — le juge
 * désigne la réponse qui gagne, celui qui devine dit « trouvé » — il envoie une
 * ACTION comme tout le monde, et c'est l'hôte qui en tire la révélation. Une
 * phase publiée par l'acteur ne partait pas : seul l'hôte a le droit de publier,
 * et l'appel échouait en silence dès que le juge n'était pas l'hôte.
 */
export const PHASES = {
  /** On attend les réponses de tout le monde. */
  question: "question",
  /** L'acteur prépare quelque chose (écrire trois mensonges, par exemple). */
  preparation: "preparation",
  /** Le signal du jeu de réflexe est armé, le compte à rebours tourne. */
  depart: "depart",
  /** On montre le résultat. */
  revelation: "revelation",
} as const;

export type NomPhase = (typeof PHASES)[keyof typeof PHASES];

/**
 * La durée du décompte 3-2-1 des jeux de réflexe.
 *
 * Elle est ici plutôt que dans l'écran : l'hôte la compte pour poser l'instant
 * du vert, l'écran la compte pour savoir quel chiffre afficher, et deux valeurs
 * qui devraient être égales finissent toujours par ne plus l'être.
 */
export const COMPTE_MS = 3_000;

/** Les réponses de la phase en cours, dans la forme qu'attendent les recettes. */
export function reponsesDe(etat: EtatPartie, phase: string): Reponse[] {
  return etat.actions
    .filter((a: ActionDeJoueur) => a.phase === phase && a.manche === etat.manche)
    .map((a) => ({ membreId: a.membreId, donnees: a.donnees, quand: a.quand }));
}

/**
 * Qui doit répondre à cette phase.
 *
 * Trois exclusions, et chacune a coûté une partie bloquée dans un cas de
 * figure réel : l'acteur ne vote pas pour lui-même dans les jeux « tour »,
 * un absent n'est jamais attendu, et quelqu'un qui a quitté le salon non plus.
 */
export function attendus(
  etat: EtatPartie,
  joueurs: Joueur[],
  acteur: string | null,
): string[] {
  return joueurs
    .map((j) => j.membreId)
    .filter((id) => id !== acteur && etat.presents.includes(id));
}

export function toutLeMondeARepondu(
  etat: EtatPartie,
  joueurs: Joueur[],
  phase: string,
  acteur: string | null,
): boolean {
  const liste = attendus(etat, joueurs, acteur);
  if (liste.length === 0) return false;
  const repondu = new Set(reponsesDe(etat, phase).map((r) => r.membreId));
  return liste.every((id) => repondu.has(id));
}

/** L'acteur de la manche, tel que la phase l'a figé. */
export function acteurDe(etat: EtatPartie): string | null {
  const valeur = etat.donneesPhase.acteur;
  return typeof valeur === "string" ? valeur : null;
}

/**
 * Le classement d'une manche de réflexe.
 *
 * Un départ brûlé ne prend pas de rang : il ne court pas. Laisser l'indice du
 * tri faire office de rang donnait « 2. Momo » alors que Momo était le seul à
 * avoir appuyé à l'heure — faux, et vexant pour rien.
 */
export function classementDeVitesse(reponses: Reponse[]): { reponse: Reponse; rang: number }[] {
  let rang = 0;
  return [...reponses]
    .sort((a, b) => a.quand.localeCompare(b.quand))
    .map((reponse) => {
      if (reponse.donnees.faux !== true) rang += 1;
      return { reponse, rang };
    });
}
