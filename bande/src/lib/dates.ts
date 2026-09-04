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

/** « mardi 4 septembre » */
export function enTexteLong(iso: string): string {
  const d = enDate(iso);
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/** « 4 sept. » */
export function enTexteCourt(iso: string): string {
  const d = enDate(iso);
  return `${d.getDate()} ${MOIS[d.getMonth()].slice(0, 4)}${MOIS[d.getMonth()].length > 4 ? "." : ""}`;
}

/** « aujourd'hui », « hier », sinon la date. */
export function enTexteRelatif(iso: string, aujourdhui: string): string {
  if (iso === aujourdhui) return "aujourd'hui";
  if (iso === decaler(aujourdhui, -1)) return "hier";
  return enTexteLong(iso);
}

export const NOMS_JOURS_COURTS = ["L", "M", "M", "J", "V", "S", "D"];
