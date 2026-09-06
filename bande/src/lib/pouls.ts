/**
 * Le pouls, et ce que le graphique en fait.
 *
 * Un pouls est un relevé express — rire et énergie, deux taps. Le check-in
 * complet reste une fois par jour ; le pouls, autant de fois qu'on veut.
 *
 * Tout ce fichier est du calcul pur : il ne connaît ni React ni Prisma, et
 * c'est ce qui permet de le tester.
 */
import { FUSEAU } from "./dates";

/** Les bornes, les mêmes que les curseurs du check-in. */
export const MIN = 1;
export const MAX = 10;

/** Deux pouls de la même personne à moins de ça, c'est un doublon. */
export const REPOS = 5 * 60 * 1000;

export type Pouls = {
  membreId: string;
  jour: string;
  rire: number;
  energie: number;
  /** ISO complet : c'est l'heure qui fait l'abscisse. */
  poseA: string;
};

export type Axe = "rire" | "energie";

export type Point = { x: number; y: number; quand: string };
export type Ligne = { membreId: string; points: Point[] };

/** Ce que le graphique montre : la journée en cours, ou les sept derniers jours. */
export type Cadre = "journee" | "semaine";

export function borner(valeur: number): number {
  if (!Number.isFinite(valeur)) return Math.round((MIN + MAX) / 2);
  return Math.min(MAX, Math.max(MIN, Math.round(valeur)));
}

/**
 * Le cadre à montrer.
 *
 * **Jamais d'écran vide** : sans aucun pouls aujourd'hui, on bascule tout seul
 * sur les sept derniers jours plutôt que d'afficher deux axes et rien entre
 * eux. C'est le cas normal des premières semaines, pas un cas limite.
 */
export function cadreAutomatique(pouls: Pouls[], aujourdhui: string): Cadre {
  return pouls.some((p) => p.jour === aujourdhui) ? "journee" : "semaine";
}

/**
 * L'heure d'un horodatage, **dans le fuseau de la bande**.
 *
 * Surtout pas `getHours()`, qui rend l'heure de la machine qui exécute : le
 * serveur est en UTC, le téléphone à Paris, et le graphique rendu sur le
 * serveur ne tombait donc pas au même endroit que celui rendu par le
 * navigateur. React signale ça comme un défaut d'hydratation, ce qu'il est.
 *
 * Le fuseau de référence est déjà celui de `dates.ts` : la journée de la bande
 * ferme à 4 h de Paris, les pouls se lisent dans le même fuseau.
 */
const HORLOGE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function heureEtMinute(iso: string): [number, number] {
  const parties = HORLOGE.formatToParts(new Date(iso));
  const lire = (type: string) => Number(parties.find((p) => p.type === type)?.value ?? 0);
  return [lire("hour"), lire("minute")];
}

function heureDe(iso: string): number {
  const [h, m] = heureEtMinute(iso);
  return h + m / 60;
}

/**
 * Les lignes du graphique.
 *
 * En cadre « journée », l'abscisse est l'heure ; en cadre « semaine », c'est
 * le rang du jour, et les pouls d'un même jour sont **moyennés** — sinon une
 * journée où quelqu'un a posé six pouls pèserait six fois plus qu'une journée
 * où il en a posé un, et la courbe raconterait l'assiduité au lieu de l'humeur.
 *
 * Les journées complètes ne sont pas mêlées aux pouls : ce sont deux gestes
 * différents, et le graphique dit « le pouls de la bande », pas « la moyenne
 * de tout ce qui a été saisi ».
 */
export function lignes(
  pouls: Pouls[],
  axe: Axe,
  cadre: Cadre,
  aujourdhui: string,
  jours: string[],
): Ligne[] {
  const retenus =
    cadre === "journee" ? pouls.filter((p) => p.jour === aujourdhui) : pouls;

  const parMembre = new Map<string, Pouls[]>();
  for (const p of retenus) {
    const liste = parMembre.get(p.membreId);
    if (liste) liste.push(p);
    else parMembre.set(p.membreId, [p]);
  }

  const resultat: Ligne[] = [];
  for (const [membreId, siens] of parMembre) {
    if (cadre === "journee") {
      const points = siens
        .map((p) => ({ x: heureDe(p.poseA), y: p[axe], quand: p.poseA }))
        .sort((a, b) => a.x - b.x);
      resultat.push({ membreId, points });
      continue;
    }

    // Une moyenne par jour, et seulement pour les jours qui existent.
    const parJour = new Map<string, number[]>();
    for (const p of siens) {
      const valeurs = parJour.get(p.jour);
      if (valeurs) valeurs.push(p[axe]);
      else parJour.set(p.jour, [p[axe]]);
    }
    const points = jours.flatMap((jour, index) => {
      const valeurs = parJour.get(jour);
      if (!valeurs || valeurs.length === 0) return [];
      const moyenne = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
      return [{ x: index, y: moyenne, quand: jour }];
    });
    resultat.push({ membreId, points });
  }

  return resultat.filter((l) => l.points.length > 0);
}

/**
 * Un tracé lissé, en courbes de Bézier cubiques.
 *
 * Le lissage est **borné à la moitié de l'écart horizontal** : sans ça, deux
 * points proches en x et éloignés en y font une boucle qui sort de la courbe,
 * et on lit une valeur qui n'a jamais existé.
 */
export function trace(points: { x: number; y: number }[], tension = 0.35): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = (b.x - a.x) * tension;
    d += ` C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}

/** Placer une valeur de 1 à 10 dans une hauteur en pixels, axe inversé. */
export function enY(valeur: number, hauteur: number, marge: number): number {
  const utile = hauteur - 2 * marge;
  return marge + (1 - (valeur - MIN) / (MAX - MIN)) * utile;
}

/** L'heure d'un pouls, telle qu'on l'écrit au tap. */
export function enHeure(iso: string): string {
  const [h, m] = heureEtMinute(iso);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
