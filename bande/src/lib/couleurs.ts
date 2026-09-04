/**
 * Couleurs de profil et rampe de joie.
 *
 * Rien ici ne renvoie un code hexadécimal : tout passe par les variables CSS
 * définies dans `globals.css`, pour que le thème sombre suive sans qu'aucun
 * composant n'ait à s'en soucier.
 */
import type { Profil } from "./types";

/**
 * Les emplacements de la palette de profils. Leur nombre plafonne la taille
 * d'une bande : sept personnes, sept couleurs qu'on distingue vraiment.
 * `scripts/valider-palette.mjs` le vérifie sur les jetons livrés.
 */
export const TEINTES = [1, 2, 3, 4, 5, 6, 7] as const;
export const TAILLE_MAX_BANDE = TEINTES.length;

export function couleurProfil(profil: Pick<Profil, "teinte">): string {
  return `var(--profil-${profil.teinte})`;
}

/**
 * La joie n'a pas de couleur d'alerte. Une journée à 2 n'est pas rouge : elle
 * est simplement plus discrète qu'une journée à 9. Une seule famille chaude,
 * du calme au rayonnant.
 */
export function couleurJoie(valeur: number): string {
  const palier = Math.max(1, Math.min(10, Math.round(valeur)));
  return `var(--joie-${palier})`;
}

/** Part de la rampe atteinte, pour les fonds et les opacités. */
export function partJoie(valeur: number): number {
  return Math.max(0, Math.min(1, (valeur - 1) / 9));
}

const HUMEURS = [
  "journée à oublier",
  "journée difficile",
  "journée en demi-teinte",
  "journée moyenne",
  "journée correcte",
  "bonne journée",
  "belle journée",
  "très belle journée",
  "journée mémorable",
  "journée parfaite",
];

/** Formulation neutre : on décrit la journée, on ne juge pas la personne. */
export function motJoie(valeur: number): string {
  return HUMEURS[Math.max(1, Math.min(10, Math.round(valeur))) - 1];
}
