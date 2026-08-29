/**
 * Deux formats de date cohabitent, volontairement :
 *
 * - `AAAA-MM-JJ` (ISO) en base, dans l'API et dans les tris. C'est le seul
 *   format qui se trie lexicographiquement dans le bon ordre.
 * - `JJ/MM/AAAA` à l'écran et dans les exports, comme le demandent les
 *   spécifications.
 *
 * Tout passe par ce module pour qu'aucun composant n'ait à choisir.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const FR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Date du jour dans le fuseau local (et non en UTC : `toISOString` décale). */
export function aujourdhuiIso(): string {
  return versIso(new Date());
}

export function versIso(date: Date): string {
  const mois = `${date.getMonth() + 1}`.padStart(2, "0");
  const jour = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

export function estDateIso(valeur: unknown): valeur is string {
  if (typeof valeur !== "string" || !ISO.test(valeur)) return false;
  const [a, m, j] = valeur.split("-").map(Number);
  const date = new Date(a, m - 1, j);
  // Rejette les dates inexistantes (31/02) que `new Date` réécrit en silence.
  return date.getFullYear() === a && date.getMonth() === m - 1 && date.getDate() === j;
}

/** `2026-03-12` → `12/03/2026`. */
export function isoVersFr(iso: string): string {
  if (!ISO.test(iso)) return iso;
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

/** `12/03/2026` → `2026-03-12`, ou `null` si la chaîne n'est pas une date. */
export function frVersIso(fr: string): string | null {
  const trouve = FR.exec(fr.trim());
  if (!trouve) return null;
  const iso = `${trouve[3]}-${trouve[2]}-${trouve[1]}`;
  return estDateIso(iso) ? iso : null;
}

/** `12 mars 2026` — pour les infobulles, où la place ne manque pas. */
export function isoVersTexte(iso: string): string {
  if (!estDateIso(iso)) return iso;
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** `12/03` — axe des graphiques, où elle manque. */
export function isoVersJourMois(iso: string): string {
  if (!ISO.test(iso)) return iso;
  const [, m, j] = iso.split("-");
  return `${j}/${m}`;
}

/** Décale une date ISO de `jours` (négatif pour reculer). */
export function decalerIso(iso: string, jours: number): string {
  const [a, m, j] = iso.split("-").map(Number);
  const date = new Date(a, m - 1, j);
  date.setDate(date.getDate() + jours);
  return versIso(date);
}
