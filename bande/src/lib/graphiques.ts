import { pointsParJour } from "./points";
import type { Entree, Profil } from "./types";

/**
 * Ce que les deux graphiques du profil ont besoin de savoir.
 *
 * Tout se calcule ici, hors de tout composant : un graphique qui fait ses
 * moyennes en même temps qu'il dessine ses courbes ne se teste pas, et c'est
 * exactement le genre d'endroit où une erreur passe inaperçue — personne ne
 * vérifie une ligne à l'œil.
 */

/**
 * Les trois fenêtres proposées. Zéro veut dire « tout », depuis le premier jour.
 *
 * Le type reste ouvert aux autres nombres : les tests ont besoin de fenêtres
 * courtes pour dire quelque chose sans écrire trente journées, et interdire
 * quatorze jours n'aurait protégé personne.
 */
export const PERIODES = [30, 90, 0] as const;
export type Periode = number;

/** Les jours d'une période, du plus ancien au plus récent. */
export function joursDe(jusquA: string, periode: Periode, depuis: string): string[] {
  const fin = new Date(`${jusquA}T12:00:00Z`);
  const debut =
    periode === 0
      ? new Date(`${depuis}T12:00:00Z`)
      : new Date(fin.getTime() - (periode - 1) * 86_400_000);

  const jours: string[] = [];
  for (let t = debut.getTime(); t <= fin.getTime(); t += 86_400_000) {
    jours.push(new Date(t).toISOString().slice(0, 10));
  }
  return jours;
}

export type Ligne = {
  membreId: string;
  /** Le total cumulé à chaque jour de la fenêtre, dans le même ordre. */
  valeurs: number[];
  /** Le total à la fin, et la place qu'il donne. */
  total: number;
  place: number;
};

/**
 * L'évolution du classement général, en points CUMULÉS.
 *
 * Deux choix qui se discutent, et qui sont faits :
 *
 * · **on montre les points, pas le rang.** Un rang saute d'un cran pour un
 *   point d'écart et donne à un coude à coude l'allure d'un renversement ;
 * · **le cumul part du début des temps, pas du début de la fenêtre.** Regarder
 *   les trente derniers jours ne remet personne à zéro : les lignes disent où
 *   en est la bande, et leur pente dit ce qui s'est passé ce mois-ci. Repartir
 *   de zéro à chaque fenêtre aurait montré un classement qui n'existe pas.
 */
export function evolutionDesPoints(
  entrees: Entree[],
  profils: Profil[],
  jours: string[],
  scelles: { auteurId: string; creeLe: string }[] = [],
  parties: { membreId: string; jour: string; points: number }[] = [],
): Ligne[] {
  if (jours.length === 0) return [];
  const premier = jours[0];

  const lignes = profils.map((profil) => {
    const quotidien = pointsParJour(entrees, profil.id, scelles, parties);

    // Ce qui a été gagné AVANT la fenêtre : le point de départ de la ligne.
    let cumul = quotidien
      .filter((j) => j.jour < premier)
      .reduce((somme, j) => somme + j.points, 0);

    const parJour = new Map(quotidien.map((j) => [j.jour, j.points]));
    const valeurs = jours.map((jour) => {
      cumul += parJour.get(jour) ?? 0;
      return cumul;
    });

    return { membreId: profil.id, valeurs, total: cumul, place: 0 };
  });

  // Les places se posent après coup, sur le total : une ligne ne connaît pas
  // les autres pendant qu'on la calcule.
  const ordre = [...lignes].sort((a, b) => b.total - a.total);
  for (const ligne of ordre) {
    // Deux totaux égaux partagent la place — annoncer un deuxième et un
    // troisième là où il y a deux deuxièmes serait faux, et vexant pour rien.
    ligne.place = ordre.findIndex((l) => l.total === ligne.total) + 1;
  }

  return lignes;
}

export type SerieDeclencheur = {
  /**
   * L'IDENTIFIANT du déclencheur, pas son nom.
   *
   * Une entrée ne porte que des identifiants — c'est ce qui permet de renommer
   * « Plante verte » en « Marie Janne » sans réécrire cinq cents journées.
   * Comparer sur le nom rendait toutes les séries à zéro, et l'écran affichait
   * poliment « aucun déclencheur coché » devant quatre cents journées qui en
   * portaient.
   */
  declencheur: string;
  /** Une valeur par période (semaine ou mois), du plus ancien au plus récent. */
  parSemaine: number[];
  /** La note moyenne des journées où il était là, ou `null`. */
  moyenne: number | null;
  /** Sur combien de journées cette moyenne est calculée. */
  joursComptes: number;
};

/** Sous ce nombre de journées, on n'annonce pas de moyenne. */
export const SEUIL_MOYENNE = 5;

/**
 * Le lundi de la semaine d'une date ISO.
 *
 * Une semaine française commence le lundi, et `getUTCDay()` rend 0 pour
 * dimanche : sans le décalage, chaque dimanche est rangé avec la semaine
 * suivante et les courbes se décalent d'un cran une fois sur sept.
 */
export function lundiDe(jour: string): string {
  const date = new Date(`${jour}T12:00:00Z`);
  const decalage = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - decalage * 86_400_000).toISOString().slice(0, 10);
}

/** Les lundis d'une période, du plus ancien au plus récent. */
export function semainesDe(jours: string[]): string[] {
  const vus = new Set(jours.map(lundiDe));
  return [...vus].sort();
}

/** Au-delà, une barre par semaine ne fait plus qu'un pixel : on passe au mois. */
export const SEMAINES_MAX = 26;

/**
 * Les déclencheurs dans le temps, et ce qu'ils valent.
 *
 * ## Le pas
 *
 * Par SEMAINE, et non par jour : trois déclencheurs tracés au jour le jour
 * donnent trois séries qui touchent le zéro tous les deux centimètres, et
 * personne n'y lit rien. Mais sur « tout », une bande d'un an fait cinquante-
 * deux semaines, soit des barres d'un pixel et demi qui se chevauchent — au-delà
 * de six mois, on compte donc par mois. Le pas est rendu avec les données :
 * l'écran doit pouvoir le DIRE, pas le laisser deviner.
 *
 * ## La moyenne
 *
 * Annoncée seulement à partir de cinq journées. En dessous, un tiret : « 8,4 sur
 * deux journées » a l'air d'un résultat et n'en est pas un.
 */
export function declencheursDansLeTemps(
  entrees: Entree[],
  declencheurs: string[],
  jours: string[],
): { periodes: string[]; pas: "semaine" | "mois"; series: SerieDeclencheur[] } {
  const semaines = semainesDe(jours);
  const pas: "semaine" | "mois" = semaines.length > SEMAINES_MAX ? "mois" : "semaine";
  const ranger = (jour: string) => (pas === "mois" ? jour.slice(0, 7) : lundiDe(jour));

  const periodes = pas === "mois" ? [...new Set(jours.map((j) => j.slice(0, 7)))].sort() : semaines;
  const dansLaFenetre = new Set(jours);
  const retenues = entrees.filter((e) => dansLaFenetre.has(e.jour));

  const series = declencheurs.map((declencheur) => {
    const avec = retenues.filter((e) => e.declencheurs.includes(declencheur));
    const compte = new Map<string, number>();
    for (const entree of avec) {
      const cle = ranger(entree.jour);
      compte.set(cle, (compte.get(cle) ?? 0) + 1);
    }

    const notes = avec.map((e) => e.joie);
    return {
      declencheur,
      parSemaine: periodes.map((cle) => compte.get(cle) ?? 0),
      moyenne:
        notes.length >= SEUIL_MOYENNE
          ? notes.reduce((s, n) => s + n, 0) / notes.length
          : null,
      joursComptes: notes.length,
    };
  });

  return { periodes, pas, series };
}
