import { BAREME } from "../points";

/**
 * Ce qu'une partie finie rapporte en points d'application.
 *
 * Le barème vient du plan : dix points pour avoir joué, puis 30 / 15 / 5 selon
 * la place. Le plan invitait à l'ajuster « si tu vois mieux, mais dis-le ».
 * Deux ajustements, donc, et les voici :
 *
 * **Un plafond de jeu par jour.** Le plan plafonne tout le reste à cent points
 * quotidiens « hors jeux » — mais il ne plafonne pas les jeux, et à trois
 * joueurs tout le monde monte sur le podium : une partie donne 40 points au
 * premier, 15 au dernier. Cinq parties dans la soirée, et le vainqueur ramasse
 * deux cents points, soit sept journées parfaites. Les points deviendraient un
 * score de jeux déguisé en score de présence. Le plafond est fixé à 120, soit
 * environ trois parties gagnées : une soirée de jeux compte, une nuit blanche
 * ne compte pas double.
 *
 * **Les ex æquo partagent la place.** Deux premiers touchent 30 chacun, et le
 * troisième reste troisième. Départager au hasard vaut mieux que départager
 * sur l'ordre d'insertion en base, mais ne rien départager du tout vaut mieux
 * que les deux.
 *
 * **Personne ne monte sur le podium quand personne n'a gagné.** Si tous les
 * scores sont égaux — le cas normal de « Je n'ai jamais », qui ne compte
 * rien — il n'y a pas de premier : chacun touche la participation, et rien de
 * plus. La première version donnait quarante points à toute la bande pour une
 * partie où aucun point n'avait été marqué, et affichait trois marches de même
 * hauteur. Un podium où tout le monde est premier n'est pas un podium.
 *
 * Une partie **abandonnée** ne rapporte rien, pas même les dix points de
 * participation : sinon lancer et quitter dix parties d'affilée devient la
 * façon la plus rapide de monter de niveau.
 */
export const PLAFOND_JEUX = 120;

export type ScoreJoueur = { membreId: string; points: number };
export type Recompense = { membreId: string; place: number; points: number };

/**
 * Le classement d'une partie, avec places partagées.
 *
 * La place est celle du plan (1, 2, 3) : à égalité, la même place pour tous, et
 * la suivante saute d'autant — deux premiers, puis un troisième.
 */
export function classement(scores: ScoreJoueur[]): Recompense[] {
  const tries = [...scores].sort((a, b) => b.points - a.points);
  const resultat: Recompense[] = [];

  // Aucun écart : la partie n'a désigné personne, et le barème ne doit pas
  // inventer un vainqueur là où le jeu n'en a pas prévu.
  const egalite = tries.every((s) => s.points === tries[0]?.points);
  if (egalite) {
    return tries.map((s) => ({ membreId: s.membreId, place: 1, points: BAREME.partie }));
  }

  let place = 0;
  let precedent: number | null = null;

  tries.forEach((score, index) => {
    if (precedent === null || score.points !== precedent) place = index + 1;
    precedent = score.points;
    const bonus = BAREME.podium[place - 1] ?? 0;
    resultat.push({ membreId: score.membreId, place, points: BAREME.partie + bonus });
  });

  return resultat;
}

/**
 * Ce qui est réellement crédité, une fois le plafond du jour appliqué.
 *
 * `dejaGagne` est ce que la personne a déjà pris en jeux le même jour. On
 * rogne, on n'annule pas : une quatrième partie rapporte peu, elle ne rapporte
 * pas zéro tant que le plafond n'est pas atteint.
 */
export function crediter(
  recompenses: Recompense[],
  dejaGagne: Record<string, number>,
): Recompense[] {
  return recompenses.map((r) => {
    const deja = dejaGagne[r.membreId] ?? 0;
    const reste = Math.max(0, PLAFOND_JEUX - deja);
    return { ...r, points: Math.min(r.points, reste) };
  });
}
