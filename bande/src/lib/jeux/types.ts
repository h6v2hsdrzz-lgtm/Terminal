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
