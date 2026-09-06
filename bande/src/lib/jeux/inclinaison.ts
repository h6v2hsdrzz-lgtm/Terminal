/**
 * Lire une inclinaison, téléphone posé sur le front.
 *
 * ## Pourquoi on ne regarde ni `beta` seul, ni l'orientation de l'écran
 *
 * La solution qu'on écrit d'instinct est « en portrait je regarde `beta`, en
 * paysage je regarde `gamma` », avec un `switch` sur `screen.orientation.angle`.
 * Elle a deux défauts, et le second est rédhibitoire : `gamma` est borné à
 * ±90°, donc il sature exactement là où le geste se produit ; et iOS
 * n'autorise pas à verrouiller l'orientation, si bien qu'un téléphone posé sur
 * un front bascule entre portrait et paysage tout seul, au milieu d'une manche.
 *
 * On calcule donc **la direction de la pesanteur par rapport à l'écran** :
 *
 *     g = cos(beta) · cos(gamma)
 *
 * C'est la composante de la gravité le long de la normale à l'écran. Elle vaut
 * +1 écran à plat vers le ciel, −1 écran à plat vers le sol, et 0 quand le
 * téléphone est vertical — c'est-à-dire posé sur un front. Elle ne dépend pas
 * du tout de l'orientation de l'interface : la même formule marche en portrait,
 * en paysage, et pendant que le téléphone hésite entre les deux.
 *
 * Le front regarde devant, l'écran regarde devant lui : pencher la tête vers le
 * BAS fait tourner l'écran vers le sol, donc **g devient négatif = trouvé** ;
 * pencher vers le HAUT le tourne vers le ciel, **g positif = passer**.
 */

/** La pesanteur le long de la normale à l'écran, dans [−1, 1]. */
export function gravitéÉcran(beta: number | null, gamma: number | null): number {
  if (beta === null || gamma === null) return 0;
  const rad = Math.PI / 180;
  return Math.cos(beta * rad) * Math.cos(gamma * rad);
}

/**
 * Il faut franchir ce seuil pour déclencher, et **repasser sous celui du
 * repos** pour pouvoir déclencher à nouveau.
 *
 * Sans le second, une carte trouvée en enchaînerait trois : tant que le
 * téléphone reste penché, l'événement continue d'arriver soixante fois par
 * seconde. C'est le défaut classique de ce jeu, et il se paie en manche
 * perdue.
 */
export const SEUIL_ACTION = 0.55;
export const SEUIL_REPOS = 0.3;

export type Action = "trouve" | "passe" | null;

export function prochaineAction(
  gravite: number,
  arme: boolean,
): { action: Action; arme: boolean } {
  if (!arme) {
    // On ne réarme qu'une fois revenu près de la verticale.
    return { action: null, arme: Math.abs(gravite) < SEUIL_REPOS };
  }
  if (gravite <= -SEUIL_ACTION) return { action: "trouve", arme: false };
  if (gravite >= SEUIL_ACTION) return { action: "passe", arme: false };
  return { action: null, arme: true };
}
