/**
 * Les types et les constantes que **les deux côtés** partagent.
 *
 * Ils vivaient dans `depot-jeux.ts`, qui importe Prisma. Un composant client
 * qui y prenait une simple constante entraînait `pg` — donc `net`, `tls`, `fs`
 * et `dns` — dans le paquet du navigateur, et la page ne compilait plus. Le
 * `import "server-only"` du dépôt n'a rien arrêté : un import de valeur suffit
 * à faire suivre tout le module au bundler avant qu'il n'y arrive.
 *
 * D'où ce fichier, qui ne contient que des types et des nombres.
 */

export type Joueur = {
  membreId: string;
  pseudo: string;
  teinte: number;
  initiales: string;
  avatar: string | null;
  points: number;
  sobre: boolean;
  ordre: number;
};

export type Partie = {
  id: string;
  jeu: string;
  mode: string;
  commenceeLe: string;
  finie: boolean;
  joueurs: Joueur[];
};

export type FinDePartie = { membreId: string; place: number; points: number }[];

export type CarteMaison = { id: string; texte: string; parQui: string; creeeLe: string };

/** Une carte plus longue que ça ne tient pas sur un écran posé sur un front. */
export const LONGUEUR_CARTE = 46;
export const MAX_CARTES = 200;

// ── Le multi-téléphones (lot N) ─────────────────────────────────────────────

export type EtatSalon = "salon" | "encours" | "finie";

/** Ce qu'un joueur a répondu dans une phase. */
export type ActionDeJoueur = {
  membreId: string;
  manche: number;
  phase: string;
  donnees: Record<string, unknown>;
  /** Horodaté par le SERVEUR : c'est ce qui départage un duel de réflexe. */
  quand: string;
};

/**
 * L'état complet d'une partie multi, tel que le serveur le voit.
 *
 * C'est la seule vérité. Un téléphone ne fait que l'afficher et proposer des
 * actions ; il ne décide rien, sinon deux écrans finiraient par raconter deux
 * parties différentes.
 */
export type EtatPartie = {
  partie: Partie;
  etat: EtatSalon;
  hoteId: string | null;
  code: string | null;
  /** Le numéro de la manche en cours. Zéro tant que rien n'a commencé. */
  manche: number;
  phase: string | null;
  donneesPhase: Record<string, unknown>;
  /** Instant ISO au-delà duquel on avance sans attendre les retardataires. */
  echeance: string | null;
  version: number;
  /** Qui a donné signe de vie il y a moins de vingt secondes. */
  presents: string[];
  /** Les réponses de la manche en cours, toutes phases confondues. */
  actions: ActionDeJoueur[];
  /**
   * L'heure du serveur au moment de la lecture.
   *
   * Sert à caler les horloges : sans elle, un duel de réflexe récompenserait
   * le téléphone qui avance.
   */
  maintenant: string;
};
