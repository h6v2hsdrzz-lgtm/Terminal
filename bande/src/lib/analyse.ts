/**
 * Les calculs du tableau de bord — fonctions pures, testées au jalon 5.
 *
 * Une règle traverse tout ce fichier : quand l'échantillon est trop maigre,
 * on le dit au lieu de sortir un chiffre. Un « +1,7 » calculé sur deux jours
 * n'est pas une information, c'est une invention bien présentée.
 */
import { jourSemaine } from "./dates";
import type { Entree } from "./types";

export const SEUIL_CONCLUANT = 5;

export function moyenne(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  return valeurs.reduce((somme, v) => somme + v, 0) / valeurs.length;
}

export type EffetDeclencheur = {
  declencheur: string;
  avec: number | null;
  sans: number | null;
  joursAvec: number;
  joursSans: number;
  ecart: number | null;
  /** Faux tant qu'un des deux côtés n'a pas atteint le seuil. */
  concluant: boolean;
};

export function effetDeclencheur(entrees: Entree[], declencheur: string): EffetDeclencheur {
  const avec = entrees.filter((e) => e.declencheurs.includes(declencheur)).map((e) => e.joie);
  const sans = entrees.filter((e) => !e.declencheurs.includes(declencheur)).map((e) => e.joie);
  const ma = moyenne(avec);
  const ms = moyenne(sans);

  return {
    declencheur,
    avec: ma,
    sans: ms,
    joursAvec: avec.length,
    joursSans: sans.length,
    ecart: ma !== null && ms !== null ? ma - ms : null,
    concluant: avec.length >= SEUIL_CONCLUANT && sans.length >= SEUIL_CONCLUANT,
  };
}

export type EffetJour = { jour: number; moyenne: number | null; nombre: number };

export function effetJourSemaine(entrees: Entree[]): EffetJour[] {
  // L'index 0 est le lundi : une semaine française commence le lundi, et
  // `getDay()` renvoie 0 pour dimanche.
  return Array.from({ length: 7 }, (_, index) => {
    const cible = (index + 1) % 7;
    const scores = entrees.filter((e) => jourSemaine(e.jour) === cible).map((e) => e.joie);
    return { jour: index, moyenne: moyenne(scores), nombre: scores.length };
  });
}

export type Synchronicite = {
  a: string;
  b: string;
  coefficient: number | null;
  joursCommuns: number;
  concluant: boolean;
};

/**
 * Corrélation de Pearson entre deux personnes, sur les jours où toutes deux
 * ont posté.
 *
 * C'est la statistique la plus séduisante et la plus traître de
 * l'application : sur quinze jours, deux séries tirées au hasard sortent
 * régulièrement 50 %. Elle n'est donc annoncée qu'au-delà d'un mois de jours
 * communs, et le nombre est toujours affiché à côté.
 */
export const SEUIL_SYNCHRONICITE = 30;

export function synchronicite(entrees: Entree[], a: string, b: string): Synchronicite {
  const parJourA = new Map(entrees.filter((e) => e.profil === a).map((e) => [e.jour, e.joie]));
  const parJourB = new Map(entrees.filter((e) => e.profil === b).map((e) => [e.jour, e.joie]));

  const paires: [number, number][] = [];
  parJourA.forEach((valeur, jour) => {
    const autre = parJourB.get(jour);
    if (autre !== undefined) paires.push([valeur, autre]);
  });

  if (paires.length < 3) {
    return { a, b, coefficient: null, joursCommuns: paires.length, concluant: false };
  }

  const moyA = paires.reduce((s, [x]) => s + x, 0) / paires.length;
  const moyB = paires.reduce((s, [, y]) => s + y, 0) / paires.length;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (const [x, y] of paires) {
    covariance += (x - moyA) * (y - moyB);
    varianceA += (x - moyA) ** 2;
    varianceB += (y - moyB) ** 2;
  }

  const denominateur = Math.sqrt(varianceA * varianceB);
  return {
    a,
    b,
    coefficient: denominateur === 0 ? null : covariance / denominateur,
    joursCommuns: paires.length,
    concluant: paires.length >= SEUIL_SYNCHRONICITE,
  };
}
