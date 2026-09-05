/**
 * La forme d'onde d'une note vocale, mise à l'échelle pour être lisible.
 *
 * Les niveaux enregistrés sont des moyennes quadratiques brutes : ils dépendent
 * d'abord de la distance entre la bouche et le téléphone. Les dessiner tels
 * quels donne deux images très différentes pour la même phrase dite deux fois,
 * et, la plupart du temps, une rangée de barres basses toutes pareilles.
 *
 * On les rapporte donc au plus fort de l'enregistrement, comme le fait
 * n'importe quel éditeur audio. Ce qu'on lit alors est le rythme de la parole —
 * les mots, les silences — et c'est la seule chose qu'une forme d'onde de
 * quarante pixels de haut peut vraiment montrer.
 */

/** Une barre à zéro reste visible : un silence fait partie du message. */
export const PLANCHER = 8;

export function ondeNormalisee(niveaux: number[]): number[] {
  if (niveaux.length === 0) return [];

  const sommet = Math.max(...niveaux);
  // Un enregistrement entièrement silencieux — micro coupé, poche — n'a pas de
  // sommet à qui se rapporter. On rend une ligne plate plutôt qu'une division
  // par zéro, et le fait qu'elle soit plate est en soi l'information.
  if (sommet <= 0) return niveaux.map(() => PLANCHER);

  return niveaux.map((niveau) => {
    const part = Math.max(0, Math.min(1, niveau / sommet));
    return Math.round(PLANCHER + part * (100 - PLANCHER));
  });
}
