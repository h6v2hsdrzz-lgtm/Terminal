/**
 * La normalisation des étiquettes, partagée par le navigateur et le serveur.
 *
 * Elle vit dans son propre module parce que les deux côtés en ont besoin : le
 * champ de saisie s'en sert pour ne pas proposer deux fois le même mot, le
 * dépôt pour ne pas créer deux lignes là où il en faut une. Deux copies de
 * cette règle finiraient par diverger, et la divergence se verrait sous la
 * forme de « Soirée » et « soiree » côte à côte dans les statistiques.
 */

/** Ce qui tient dans une pastille sans la faire déborder. */
export const LONGUEUR_ETIQUETTE = 20;
/** Cinq mots par journée. Au-delà, on ne trie plus, on catalogue. */
export const MAX_ETIQUETTES = 5;

/**
 * La clé d'une étiquette : sans accents, sans casse, sans espaces.
 *
 * « Soirée », « soiree » et « SOIRÉE » sont la même étiquette.
 */
export function cleEtiquette(nom: string): string {
  return nom
    .normalize("NFD")
    // Les diacritiques que la décomposition NFD vient de séparer.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Le nom tel qu'on le garde : rogné, mais avec ses accents et sa casse. */
export function nettoyerEtiquette(nom: string): string {
  return nom.trim().slice(0, LONGUEUR_ETIQUETTE);
}
