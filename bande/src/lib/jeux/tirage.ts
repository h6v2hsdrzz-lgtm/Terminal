/**
 * Tirer sans repasser deux fois par la même carte.
 *
 * Un `Math.random()` par carte redonne la même affirmation trois fois dans une
 * partie de vingt manches — c'est le genre de détail qui fait dire « il n'y en
 * a pas beaucoup » d'un paquet qui en compte trois cents. On mélange donc le
 * paquet une fois, et on le déroule.
 *
 * Le générateur est passé en paramètre : sans ça, rien n'est testable, et une
 * partie ne peut pas être rejouée à l'identique.
 */

/** Fisher-Yates. Ne modifie pas l'entrée. */
export function melanger<T>(elements: readonly T[], hasard: () => number): T[] {
  const copie = [...elements];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(hasard() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/**
 * Un générateur reproductible à partir d'une graine (mulberry32).
 *
 * `Math.random()` ne se rejoue pas : impossible de reconstituer une manche pour
 * la relire, impossible d'écrire un test qui ne soit pas un tirage au sort.
 * Avec une graine rangée dans la partie, la suite est la même partout.
 */
export function generateur(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La pioche : le paquet mélangé, puis relancé quand il est vide.
 *
 * Le remélange à la fin garantit qu'on voit TOUT le paquet avant d'en revoir
 * une seule carte, ce qu'un tirage aléatoire ne fait jamais.
 */
export function pioche<T>(paquet: readonly T[], hasard: () => number) {
  if (paquet.length === 0) throw new Error("Un paquet vide ne se pioche pas.");
  let restant = melanger(paquet, hasard);
  return {
    suivante(): T {
      if (restant.length === 0) restant = melanger(paquet, hasard);
      return restant.pop() as T;
    },
    get reste() {
      return restant.length;
    },
  };
}
