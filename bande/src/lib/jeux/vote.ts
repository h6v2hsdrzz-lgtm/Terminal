/**
 * Dépouiller un vote à deux camps.
 *
 * La règle a l'air évidente et ne l'est pas : « le camp le moins nombreux
 * prend ». La première version comparait simplement les deux comptes, ce qui
 * donnait un résultat absurde à l'unanimité — quatre voix contre zéro, et le
 * camp vide devenait « minoritaire », donc les quatre autres marquaient un
 * point pour avoir deviné une majorité que personne ne pouvait manquer. Une
 * capture l'a montré : tout le monde à +1 sur un vote unanime.
 *
 * Il n'y a donc de minorité que si **les deux camps ont au moins une voix** et
 * qu'ils sont **inégaux**. Sinon personne ne prend rien, personne ne marque.
 */
export type Depouillement = {
  comptes: Record<string, number>;
  /** L'option minoritaire, ou `null` s'il n'y en a pas. */
  minoritaire: string | null;
  /** Vrai quand tout le monde a répondu pareil. */
  unanime: boolean;
};

export function depouiller(votes: Record<string, string>, options: string[]): Depouillement {
  const comptes: Record<string, number> = {};
  for (const option of options) comptes[option] = 0;
  for (const choix of Object.values(votes)) {
    if (choix in comptes) comptes[choix] += 1;
  }

  const exprimes = options.filter((o) => comptes[o] > 0);
  const unanime = exprimes.length === 1;

  if (exprimes.length < 2) return { comptes, minoritaire: null, unanime };

  const tries = [...exprimes].sort((a, b) => comptes[a] - comptes[b]);
  // Égalité entre les deux camps les moins fournis : pas de minorité.
  if (comptes[tries[0]] === comptes[tries[1]]) return { comptes, minoritaire: null, unanime };
  return { comptes, minoritaire: tries[0], unanime };
}
