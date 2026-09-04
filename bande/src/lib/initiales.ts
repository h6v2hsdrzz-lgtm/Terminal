/** Deux lettres tirées du pseudo. */
function deuxLettres(pseudo: string): string {
  const mots = pseudo.trim().split(/\s+/).filter(Boolean);
  if (mots.length >= 2) return (mots[0][0] + mots[1][0]).toUpperCase();
  return pseudo.trim().slice(0, 2).toUpperCase();
}

/**
 * Les initiales des avatars, calculées pour toute la bande d'un coup.
 *
 * Prises isolément, « Sam » et « Samy » donnent tous deux « SA » : deux
 * avatars identiques, que seule la couleur sépare. C'est exactement ce que
 * l'avatar est censé éviter — il est le second encodage, celui qui reste quand
 * la couleur ne suffit pas.
 *
 * On essaie donc les deux premières lettres, et pour ceux qui se marchent
 * dessus, la première et la dernière : « SM » et « SY ». Deux pseudos peuvent
 * encore se croiser (Lea, Lena) ; on ajoute alors un rang, parce qu'un chiffre
 * discret vaut mieux que deux jumeaux.
 */
export function initialesDeLaBande(pseudos: string[]): string[] {
  const premier = pseudos.map(deuxLettres);
  const compte = new Map<string, number>();
  for (const i of premier) compte.set(i, (compte.get(i) ?? 0) + 1);

  const second = pseudos.map((pseudo, index) => {
    if ((compte.get(premier[index]) ?? 0) < 2) return premier[index];
    const propre = pseudo.trim();
    return propre.length >= 2
      ? (propre[0] + propre[propre.length - 1]).toUpperCase()
      : premier[index];
  });

  const compte2 = new Map<string, number>();
  for (const i of second) compte2.set(i, (compte2.get(i) ?? 0) + 1);
  const rang = new Map<string, number>();
  return second.map((initiale) => {
    if ((compte2.get(initiale) ?? 0) < 2) return initiale;
    const n = (rang.get(initiale) ?? 0) + 1;
    rang.set(initiale, n);
    return initiale[0] + n;
  });
}
