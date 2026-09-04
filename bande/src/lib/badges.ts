/**
 * Les badges, calculés à partir des journées posées.
 *
 * Volontairement peu nombreux pour l'instant. Un badge qui se donne tout seul
 * ne vaut rien, et un badge affiché comme obtenu alors qu'il ne l'est pas vaut
 * moins que rien : chacun de ceux-ci se déduit des données, sans table de
 * suivi ni compteur à tenir à jour. Le reste de la collection viendra avec le
 * jalon qui la conçoit pour de bon.
 */
import { decaler } from "./dates";
import type { Badge, Entree } from "./types";

/** La plus longue série de jours consécutifs dans un ensemble de dates. */
export function plusLongueSerie(jours: Set<string>): number {
  let record = 0;
  for (const jour of jours) {
    // On ne compte une série que depuis son premier jour : sinon chaque jour
    // d'une série de trente relancerait le parcours complet.
    if (jours.has(decaler(jour, -1))) continue;
    let longueur = 0;
    let curseur = jour;
    while (jours.has(curseur)) {
      longueur += 1;
      curseur = decaler(curseur, 1);
    }
    record = Math.max(record, longueur);
  }
  return record;
}

/** La série en cours, en remontant depuis aujourd'hui (ou hier si rien ce soir). */
export function serieEnCours(jours: Set<string>, aujourdhui: string): number {
  let curseur = jours.has(aujourdhui) ? aujourdhui : decaler(aujourdhui, -1);
  let compte = 0;
  while (jours.has(curseur)) {
    compte += 1;
    curseur = decaler(curseur, -1);
  }
  return compte;
}

export function badgesDe(miennes: Entree[]): Badge[] {
  // Les entrées arrivent du plus récent au plus ancien ; pour dater un premier
  // fait, il faut l'ordre chronologique.
  const chronologie = [...miennes].sort((a, b) => a.jour.localeCompare(b.jour));
  const jours = new Set(chronologie.map((e) => e.jour));

  const premiere = chronologie[0] ?? null;
  const premierDix = chronologie.find((e) => e.joie === 10) ?? null;
  const premiereNote = chronologie.find((e) => e.note) ?? null;

  // Une remontée : +4 ou plus d'un jour posé au suivant.
  let remontada: Entree | null = null;
  for (let i = 1; i < chronologie.length; i += 1) {
    if (chronologie[i].joie - chronologie[i - 1].joie >= 4) {
      remontada = chronologie[i];
      break;
    }
  }

  const record = plusLongueSerie(jours);
  const jourDeLaSerie = (longueur: number) => {
    if (record < longueur) return null;
    // On date le badge du jour où la série a atteint la longueur voulue.
    for (const jour of [...jours].sort()) {
      if (jours.has(decaler(jour, -1))) continue;
      let curseur = jour;
      for (let n = 1; ; n += 1) {
        if (!jours.has(curseur)) break;
        if (n === longueur) return curseur;
        curseur = decaler(curseur, 1);
      }
    }
    return null;
  };

  return [
    { cle: "premiere", nom: "Première journée", description: "Le début de tout", emoji: "🌱", obtenuLe: premiere?.jour ?? null },
    { cle: "semaine", nom: "Sept d'affilée", description: "Une semaine sans en rater un", emoji: "📅", obtenuLe: jourDeLaSerie(7) },
    { cle: "mois", nom: "Trente jours", description: "Un mois complet", emoji: "🏔️", obtenuLe: jourDeLaSerie(30) },
    { cle: "plein-pot", nom: "Plein pot", description: "Une journée notée 10", emoji: "🌟", obtenuLe: premierDix?.jour ?? null },
    { cle: "remontada", nom: "Remontada", description: "+4 d'un jour posé au suivant", emoji: "📈", obtenuLe: remontada?.jour ?? null },
    { cle: "raconteur", nom: "Raconteur", description: "Une journée commentée", emoji: "✍️", obtenuLe: premiereNote?.jour ?? null },
  ];
}
