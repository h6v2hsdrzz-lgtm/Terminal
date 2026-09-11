/**
 * Le salon, et ce qui se décide sans la base.
 *
 * Tout ce fichier est pur : un code se tire, une absence se constate, un hôte
 * se remplace, un vote se dépouille. Ce sont les règles qui décident si une
 * partie avance ou reste coincée — exactement le genre de choses qu'on veut
 * pouvoir éprouver sans monter trois téléphones.
 */

/**
 * Quatre chiffres, et pas de zéro en tête.
 *
 * On le dicte à voix haute dans une cuisine : « zéro sept quatre deux » se
 * transcrit mal, et un code qui commence par zéro se fait avaler par un champ
 * numérique. Mille à neuf mille neuf cent quatre-vingt-dix-neuf, c'est neuf
 * mille possibilités pour au plus une poignée de parties simultanées — le
 * risque de collision est théorique, et on le traite quand même en réessayant.
 */
export function tirerCode(hasard: () => number = Math.random): string {
  return String(1000 + Math.floor(hasard() * 9000));
}

export function codeValide(brut: string): boolean {
  return /^[1-9]\d{3}$/.test(brut.trim());
}

/**
 * Au bout de combien de temps sans nouvelles considère-t-on quelqu'un parti.
 *
 * Le battement est envoyé toutes les cinq secondes. Vingt secondes laissent
 * passer trois battements manqués : un tunnel de métro, un écran verrouillé une
 * poignée de secondes, une reconnexion. En dessous, l'écran clignoterait entre
 * « ici » et « parti » à chaque feu rouge.
 */
export const BATTEMENT_MS = 5_000;
export const ABSENCE_MS = 20_000;

export function estPresent(vuLe: Date | string, maintenant: Date = new Date()): boolean {
  const instant = typeof vuLe === "string" ? new Date(vuLe) : vuLe;
  return maintenant.getTime() - instant.getTime() < ABSENCE_MS;
}

/**
 * Qui reprend le salon quand l'hôte s'en va.
 *
 * Le plus ancien présent, par ordre de passage — un ordre déjà tiré, déjà connu
 * de tous, et stable. Prendre « le premier de la liste » donnerait un résultat
 * différent selon l'écran qui pose la question.
 *
 * Rend `null` s'il ne reste personne : la partie est alors finie, pas orpheline.
 */
export function prochainHote(
  joueurs: { membreId: string; ordre: number; present: boolean }[],
  hoteActuel: string | null,
): string | null {
  const presents = joueurs
    .filter((j) => j.present && j.membreId !== hoteActuel)
    .sort((a, b) => a.ordre - b.ordre);
  return presents[0]?.membreId ?? null;
}

/**
 * Tout le monde a-t-il répondu ?
 *
 * Les absents ne comptent pas, et c'est la règle qui empêche une partie de
 * rester bloquée : attendre le vote de quelqu'un dont le téléphone est éteint,
 * c'est attendre pour toujours. Il faut au moins une voix, sinon une manche où
 * tout le monde vient de se déconnecter s'auto-validerait dans le vide.
 */
export function tousOntRepondu(
  presents: string[],
  repondants: string[],
): boolean {
  if (presents.length === 0) return false;
  const repondu = new Set(repondants);
  return presents.every((membreId) => repondu.has(membreId));
}

/**
 * Le décalage entre l'horloge du téléphone et celle du serveur.
 *
 * Sans ça, « appuie quand ça passe au vert » récompense celui dont le téléphone
 * avance. Le serveur annonce un instant absolu, chaque téléphone le ramène à sa
 * propre horloge, et le compte à rebours est local — donc sans latence réseau
 * dans le geste lui-même.
 */
export function decalageHorloge(instantServeur: string, instantLocal = Date.now()): number {
  return new Date(instantServeur).getTime() - instantLocal;
}

export function versLocal(instantServeur: string, decalage: number): number {
  return new Date(instantServeur).getTime() - decalage;
}
