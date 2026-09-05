/**
 * La figure du jour : la géométrie, séparée du dessin.
 *
 * À trois, une journée forme un triangle — un sommet par personne, tiré vers
 * l'extérieur par sa note. Ce n'est pas un classement : c'est une forme. On y
 * lit d'un coup d'œil ce qu'aucun chiffre ne montre aussi vite — si la bande
 * est d'accord (figure régulière), si quelqu'un décroche (figure penchée), s'il
 * manque quelqu'un (sommet effondré).
 *
 * Le calcul vit ici, à part du composant, pour être testable : une figure
 * fausse ne se voit pas à l'œil nu.
 */

/** Rayon du sommet d'une personne absente, en part du rayon maximal. */
export const CREUX_ABSENT = 0.16;
/** Rayon d'une note de 1. Une mauvaise journée reste une présence, pas un point. */
export const CREUX_MINIMAL = 0.34;
/**
 * Rayon d'un sommet posé mais caché, sous le voile.
 *
 * C'est une constante, et c'est tout l'intérêt : elle ne vient pas de la note,
 * donc la note ne descend pas dans la page. Elle dit « cette personne est
 * passée », rien de plus — et il fallait bien qu'elle le dise, sinon celui qui
 * a posé et celui qui n'a rien posé donnent le même dessin, et la figure ne
 * sert à rien tant que le voile est là.
 */
export const PART_CACHEE = 0.62;

export type Sommet = {
  profil: string;
  /** null quand la personne n'a pas posé sa journée — ou quand elle est cachée. */
  joie: number | null;
  /** Vrai quand la personne a posé mais que le voile empêche de le montrer. */
  cachee: boolean;
  x: number;
  y: number;
  /** Part du rayon maximal atteinte, de 0 à 1. */
  part: number;
};

/**
 * Place les sommets sur un cercle, dans l'ordre donné.
 *
 * Le premier sommet est en haut : à trois, ça donne un triangle posé sur sa
 * base, qui est la façon dont on dessine un triangle depuis l'enfance.
 */
export function figure(
  personnes: { profil: string; joie: number | null; cachee?: boolean }[],
  rayon: number,
): Sommet[] {
  const n = personnes.length;
  if (n === 0) return [];

  return personnes.map((personne, index) => {
    const angle = (index / n) * Math.PI * 2 - Math.PI / 2;
    const cachee = personne.cachee === true;
    const part = cachee
      ? PART_CACHEE
      : personne.joie === null
        ? CREUX_ABSENT
        : CREUX_MINIMAL + ((personne.joie - 1) / 9) * (1 - CREUX_MINIMAL);
    return {
      profil: personne.profil,
      // Une personne cachée n'a pas de note ici, et c'est volontaire : elle
      // n'est jamais passée par cette fonction.
      joie: cachee ? null : personne.joie,
      cachee,
      part,
      x: Math.cos(angle) * rayon * part,
      y: Math.sin(angle) * rayon * part,
    };
  });
}

/** Le contour, en coordonnées SVG relatives au centre. */
export function contour(sommets: Sommet[]): string {
  if (sommets.length === 0) return "";
  if (sommets.length === 1) {
    // Une seule personne : un cercle vaut mieux qu'un point isolé.
    const r = Math.max(2, Math.abs(sommets[0].y));
    return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  }
  const points = sommets.map((s) => `${s.x.toFixed(2)} ${s.y.toFixed(2)}`);
  return `M ${points[0]} L ${points.slice(1).join(" L ")} Z`;
}

/**
 * À quel point la figure est régulière, de 0 à 1.
 *
 * 1 quand tout le monde est au même niveau — la bande est d'accord, quel que
 * soit ce niveau. C'est bien une mesure d'accord et non de bonheur : trois
 * journées à 2 donnent une figure aussi régulière que trois journées à 9.
 */
export function regularite(sommets: Sommet[]): number | null {
  // Un sommet caché est à un rayon constant : le compter donnerait une mesure
  // d'accord fabriquée de toutes pièces.
  const presents = sommets.filter((s) => s.joie !== null && !s.cachee);
  if (presents.length < 2) return null;

  const parts = presents.map((s) => s.part);
  const ecart = Math.max(...parts) - Math.min(...parts);
  return Math.max(0, 1 - ecart / (1 - CREUX_MINIMAL));
}

/**
 * Ce que la figure raconte, en une phrase — ou rien.
 *
 * Deux règles tiennent cette fonction :
 *
 * · **elle ne nomme personne.** Dire « Sam décroche » serait un classement
 *   déguisé, et le classement du bonheur est ce que cette application refuse
 *   depuis le premier jour. Le sommet court est déjà visible, dans la couleur
 *   de la personne : qui c'est se lit sur le dessin, pas dans une phrase qui
 *   met quelqu'un en cause ;
 * · **elle se tait plus souvent qu'elle ne parle.** Une phrase sur chaque
 *   journée deviendrait du remplissage, et on cesserait de la lire. Elle ne
 *   sort que sur les deux formes qui se remarquent vraiment.
 */
export function lireFigure(sommets: Sommet[]): string | null {
  const presents = sommets.filter((s) => s.joie !== null && !s.cachee);
  // Une figure incomplète ne se commente pas : il manque une journée, pas un
  // accord. L'écran le dit déjà ailleurs, avec des prénoms.
  if (presents.length < sommets.length || presents.length < 2) return null;

  const accord = regularite(sommets);
  if (accord === null) return null;
  if (accord >= 0.86) return "Vous êtes au même endroit aujourd'hui.";
  if (accord <= 0.45) return "La figure penche : la journée n'a pas été la même pour tout le monde.";
  return null;
}
