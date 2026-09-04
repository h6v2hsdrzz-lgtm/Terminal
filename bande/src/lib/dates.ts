/**
 * Dates.
 *
 * La journée de la bande ferme à 4 h du matin, pas à minuit. Un check-in à
 * 1 h appartient encore à la soirée qu'on vient de vivre — c'est ce que dit
 * l'intuition, et c'est ce que fait l'application.
 */

export const HEURE_BASCULE = 4;
export const FUSEAU = "Europe/Paris";

export function versIso(date: Date): string {
  const mois = `${date.getMonth() + 1}`.padStart(2, "0");
  const jour = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

/** Le jour « de la bande » pour un instant donné. */
export function jourDeLaBande(instant: Date = new Date()): string {
  const decale = new Date(instant);
  decale.setHours(decale.getHours() - HEURE_BASCULE);
  return versIso(decale);
}

export function decaler(iso: string, jours: number): string {
  const [a, m, j] = iso.split("-").map(Number);
  const date = new Date(a, m - 1, j);
  date.setDate(date.getDate() + jours);
  return versIso(date);
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function enDate(iso: string): Date {
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(a, m - 1, j);
}

export function jourSemaine(iso: string): number {
  return enDate(iso).getDay();
}

/** Le premier du mois se dit « 1er », les autres se disent simplement. */
function quantieme(jour: number): string {
  return jour === 1 ? "1er" : String(jour);
}

/** « mardi 4 septembre », « mardi 1er septembre » */
export function enTexteLong(iso: string): string {
  const d = enDate(iso);
  return `${JOURS[d.getDay()]} ${quantieme(d.getDate())} ${MOIS[d.getMonth()]}`;
}

/**
 * « mardi 4 septembre », avec l'année quand elle n'est pas celle en cours.
 *
 * Une capsule qui s'ouvre « le jeudi 1er juillet » sans année laisse croire à
 * dans quelques mois alors qu'il s'agit de l'an prochain.
 */
export function enTexteLongAvecAnnee(iso: string, reference: string): string {
  const meme = iso.slice(0, 4) === reference.slice(0, 4);
  return meme ? enTexteLong(iso) : `${enTexteLong(iso)} ${iso.slice(0, 4)}`;
}

/** « 4 sept. » */
export function enTexteCourt(iso: string): string {
  const d = enDate(iso);
  return `${quantieme(d.getDate())} ${MOIS[d.getMonth()].slice(0, 4)}${MOIS[d.getMonth()].length > 4 ? "." : ""}`;
}

/** « aujourd'hui », « hier », sinon la date. */
export function enTexteRelatif(iso: string, aujourdhui: string): string {
  if (iso === aujourdhui) return "aujourd'hui";
  if (iso === decaler(aujourdhui, -1)) return "hier";
  return enTexteLong(iso);
}

export const NOMS_JOURS_COURTS = ["L", "M", "M", "J", "V", "S", "D"];
