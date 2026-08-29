/**
 * Constantes partagées entre le serveur et le navigateur : la liste des
 * personnes suivies, les deux déclencheurs, et les couleurs de tracé.
 */

export const PERSONNES = ["Momo", "Sam", "Samy"] as const;

export type Personne = (typeof PERSONNES)[number];

export function estPersonne(valeur: unknown): valeur is Personne {
  return typeof valeur === "string" && (PERSONNES as readonly string[]).includes(valeur);
}

/** Bornes de l'échelle de joie, utilisées par le curseur et la validation. */
export const JOIE_MIN = 1;
export const JOIE_MAX = 10;

export type CleDeclencheur = "biberon" | "planteVerte";

export type Declencheur = {
  cle: CleDeclencheur;
  libelle: string;
  /** Nom de colonne dans les exports CSV / JSON, conforme aux spécifications. */
  colonne: string;
  emoji: string;
};

export const DECLENCHEURS: readonly Declencheur[] = [
  { cle: "biberon", libelle: "Biberon", colonne: "biberon", emoji: "🍼" },
  { cle: "planteVerte", libelle: "Plante verte", colonne: "plante_verte", emoji: "🌿" },
] as const;

/**
 * Couleurs de tracé. Ce sont des variables CSS : elles suivent le thème
 * clair / sombre sans que les graphiques aient à se redessiner.
 */
export const COULEURS_PERSONNES: Record<Personne, string> = {
  Momo: "var(--momo)",
  Sam: "var(--sam)",
  Samy: "var(--samy)",
};

export const COULEURS_DECLENCHEURS: Record<CleDeclencheur, { avec: string; sans: string }> = {
  biberon: { avec: "var(--ardoise)", sans: "var(--faible)" },
  planteVerte: { avec: "var(--vert)", sans: "var(--faible)" },
};

/**
 * En dessous de ce nombre de mesures de chaque côté (avec / sans), un écart
 * n'est qu'un hasard d'échantillonnage : on l'affiche, mais signalé comme
 * fragile.
 */
export const ECHANTILLON_FIABLE = 3;
