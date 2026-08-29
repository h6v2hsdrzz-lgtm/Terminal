/**
 * Toute l'analyse du tableau de bord — fonctions pures, aucune dépendance à
 * React ni à la base. Elles se testent et se relisent seules.
 *
 * Le calcul central est le *delta* d'un déclencheur : la moyenne de joie des
 * jours où il est présent, moins celle des jours où il est absent. C'est une
 * différence de moyennes observées, pas une preuve de causalité — d'où le
 * nombre de mesures affiché à côté de chaque écart.
 */
import {
  DECLENCHEURS,
  ECHANTILLON_FIABLE,
  PERSONNES,
  type CleDeclencheur,
  type Personne,
} from "./constantes";
import type { Entree } from "./types";

export function moyenne(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  return valeurs.reduce((somme, v) => somme + v, 0) / valeurs.length;
}

export function arrondir(valeur: number | null, decimales = 1): number | null {
  if (valeur === null || !Number.isFinite(valeur)) return null;
  const facteur = 10 ** decimales;
  return Math.round(valeur * facteur) / facteur;
}

export function moyenneGlobale(entrees: Entree[]): number | null {
  return moyenne(entrees.map((e) => e.joie));
}

export type StatPersonne = {
  personne: Personne;
  moyenne: number | null;
  nombre: number;
  /** Écart entre la moyenne des 7 derniers jours mesurés et celle d'avant. */
  tendance: number | null;
  derniere: Entree | null;
};

export function statistiquesParPersonne(entrees: Entree[]): StatPersonne[] {
  return PERSONNES.map((personne) => {
    const siennes = entrees
      .filter((e) => e.personne === personne)
      .sort((a, b) => a.date.localeCompare(b.date));

    const recentes = siennes.slice(-7);
    const precedentes = siennes.slice(-14, -7);
    const moyRecente = moyenne(recentes.map((e) => e.joie));
    const moyPrecedente = moyenne(precedentes.map((e) => e.joie));

    return {
      personne,
      moyenne: moyenne(siennes.map((e) => e.joie)),
      nombre: siennes.length,
      tendance:
        moyRecente !== null && moyPrecedente !== null ? moyRecente - moyPrecedente : null,
      derniere: siennes.at(-1) ?? null,
    };
  });
}

export type ImpactDeclencheur = {
  cle: CleDeclencheur;
  libelle: string;
  moyenneAvec: number | null;
  moyenneSans: number | null;
  nAvec: number;
  nSans: number;
  /** `moyenneAvec - moyenneSans`, ou `null` si un des deux côtés est vide. */
  delta: number | null;
  /** Vrai quand les deux côtés comptent assez de mesures pour être lus. */
  fiable: boolean;
};

export function impactDeclencheurs(entrees: Entree[]): ImpactDeclencheur[] {
  return DECLENCHEURS.map(({ cle, libelle }) => {
    const avec = entrees.filter((e) => e[cle]).map((e) => e.joie);
    const sans = entrees.filter((e) => !e[cle]).map((e) => e.joie);
    const moyenneAvec = moyenne(avec);
    const moyenneSans = moyenne(sans);

    return {
      cle,
      libelle,
      moyenneAvec,
      moyenneSans,
      nAvec: avec.length,
      nSans: sans.length,
      delta: moyenneAvec !== null && moyenneSans !== null ? moyenneAvec - moyenneSans : null,
      fiable: avec.length >= ECHANTILLON_FIABLE && sans.length >= ECHANTILLON_FIABLE,
    };
  });
}

/**
 * Le déclencheur au plus grand écart positif. `null` tant qu'aucun des deux
 * n'a de mesures des deux côtés, ou qu'aucun n'a d'effet positif.
 */
export function declencheurLePlusInfluent(entrees: Entree[]): ImpactDeclencheur | null {
  const candidats = impactDeclencheurs(entrees).filter(
    (impact): impact is ImpactDeclencheur & { delta: number } =>
      impact.delta !== null && impact.delta > 0,
  );
  if (candidats.length === 0) return null;
  return candidats.reduce((meilleur, courant) => (courant.delta > meilleur.delta ? courant : meilleur));
}

/** Impacts calculés pour une personne : la même lecture, à l'échelle d'un profil. */
export function impactParPersonne(
  entrees: Entree[],
): Record<Personne, ImpactDeclencheur[]> {
  return Object.fromEntries(
    PERSONNES.map((personne) => [
      personne,
      impactDeclencheurs(entrees.filter((e) => e.personne === personne)),
    ]),
  ) as Record<Personne, ImpactDeclencheur[]>;
}

/** Un point par jour mesuré, une colonne par personne — format du graphique linéaire. */
export type PointTemporel = {
  date: string;
  Momo: number | null;
  Sam: number | null;
  Samy: number | null;
  declencheurs: Partial<Record<Personne, { biberon: boolean; planteVerte: boolean }>>;
};

export function serieTemporelle(entrees: Entree[]): PointTemporel[] {
  const parDate = new Map<string, PointTemporel>();

  for (const entree of entrees) {
    let point = parDate.get(entree.date);
    if (!point) {
      point = { date: entree.date, Momo: null, Sam: null, Samy: null, declencheurs: {} };
      parDate.set(entree.date, point);
    }
    point[entree.personne] = entree.joie;
    point.declencheurs[entree.personne] = {
      biberon: entree.biberon,
      planteVerte: entree.planteVerte,
    };
  }

  return [...parDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Une barre « Avec » et une barre « Sans » par périmètre — graphique comparatif. */
export type BarreComparaison = {
  perimetre: string;
  avec: number | null;
  sans: number | null;
  nAvec: number;
  nSans: number;
};

export function comparaisonParPerimetre(
  entrees: Entree[],
  cle: CleDeclencheur,
): BarreComparaison[] {
  const construire = (perimetre: string, lot: Entree[]): BarreComparaison => {
    const avec = lot.filter((e) => e[cle]).map((e) => e.joie);
    const sans = lot.filter((e) => !e[cle]).map((e) => e.joie);
    return {
      perimetre,
      avec: arrondir(moyenne(avec), 2),
      sans: arrondir(moyenne(sans), 2),
      nAvec: avec.length,
      nSans: sans.length,
    };
  };

  return [
    construire("Collectif", entrees),
    ...PERSONNES.map((personne) =>
      construire(personne, entrees.filter((e) => e.personne === personne)),
    ),
  ];
}

/** Nombre de jours distincts couverts par le journal. */
export function joursCouverts(entrees: Entree[]): number {
  return new Set(entrees.map((e) => e.date)).size;
}
