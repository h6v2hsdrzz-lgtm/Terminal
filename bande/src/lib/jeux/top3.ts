/**
 * Le score de « Top 3 ».
 *
 * Deux points par réponse à la bonne place, un point si la réponse est dans le
 * top mais ailleurs. C'est le barème annoncé dans les règles du jeu, et il est
 * ici parce que c'est un calcul : le reste du jeu est de l'affichage.
 *
 * La comparaison est **insensible à la casse et aux espaces**, mais pas
 * approximative : « Le Parrain » et « le parrain » sont la même réponse, « Le
 * Parrain 2 » n'en est pas une. Deviner un top 3, c'est retrouver des mots
 * exacts, pas s'en approcher.
 */
export function normaliser(reponse: string): string {
  return reponse
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

export const POINTS_PLACE = 2;
export const POINTS_PRESENT = 1;

/**
 * Deux passes, comme au Mastermind, et l'ordre des passes n'est pas un détail.
 *
 * En une seule passe, « Matrix » proposé trois fois contre un top qui le
 * contient une fois rapporte un point de présence *puis* deux points de place :
 * trois points pour une réponse. C'est le défaut qu'un test a attrapé. En
 * comptant d'abord toutes les places exactes, chaque réponse du vrai top n'est
 * créditée qu'une fois, et la place l'emporte toujours sur la présence.
 */
export function scoreTop3(vrai: string[], propose: string[]): number {
  const attendu = vrai.map(normaliser);
  const donne = propose.map(normaliser);
  const prises = new Set<number>();
  const utilisees = new Set<number>();
  let points = 0;

  donne.forEach((cle, index) => {
    if (!cle || attendu[index] !== cle) return;
    points += POINTS_PLACE;
    prises.add(index);
    utilisees.add(index);
  });

  donne.forEach((cle, index) => {
    if (!cle || utilisees.has(index)) return;
    const ailleurs = attendu.findIndex((a, i) => a === cle && !prises.has(i));
    if (ailleurs !== -1) {
      points += POINTS_PRESENT;
      prises.add(ailleurs);
      utilisees.add(index);
    }
  });

  return points;
}
