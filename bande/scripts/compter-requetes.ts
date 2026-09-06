/**
 * Combien de requêtes SQL derrière chaque écran ?
 *
 * L'audit technique du plan demande de chercher les requêtes N+1. Elles ne se
 * voient pas en lisant le code — un `include` bien placé les cache — mais elles
 * se comptent. Un écran qui fait trois cents requêtes en fait une par ligne.
 *
 *   npx tsx scripts/compter-requetes.ts
 */
import { readFileSync, statSync } from "node:fs";

import { prisma } from "../src/lib/db";

/**
 * On compte **côté PostgreSQL**, pas côté Prisma.
 *
 * Brancher un écouteur `$on("query")` demande de construire son propre client,
 * et le dépôt utilise le sien : on compterait les requêtes d'un client que
 * personne n'appelle. Le journal du serveur, lui, voit tout — à condition
 * d'avoir posé `log_statement = 'all'` :
 *
 *   ALTER SYSTEM SET log_statement='all'; SELECT pg_reload_conf();
 */
const JOURNAL = process.env.JOURNAL_PG ?? "/tmp/pg.log";

function lignes(): number {
  try {
    return readFileSync(JOURNAL, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

function requetes(depuis: number): number {
  try {
    const texte = readFileSync(JOURNAL, "utf8").split("\n").slice(depuis);
    return texte.filter((l) => /statement:|execute /.test(l)).length;
  } catch {
    return 0;
  }
}

async function mesurer(nom: string, travail: () => Promise<unknown>) {
  const avant = lignes();
  const debut = Date.now();
  await travail();
  await new Promise((r) => setTimeout(r, 200));
  const combien = requetes(avant - 1);
  console.log(
    `${String(combien).padStart(4)} requêtes · ${String(Date.now() - debut).padStart(5)} ms · ${nom}`,
  );
}

async function principal() {
  if (statSync(JOURNAL, { throwIfNoEntry: false }) === undefined) {
    throw new Error(`Journal PostgreSQL introuvable : ${JOURNAL}`);
  }
  const groupe = await prisma.groupe.findFirst({ orderBy: { creeLe: "asc" } });
  if (!groupe) throw new Error("Aucune bande — lance « npm run db:seed ».");
  const membre = await prisma.membre.findFirst({ where: { groupeId: groupe.id } });
  if (!membre) throw new Error("Aucun membre.");

  const { chargerContexte, listerEntrees, mediasDeLaBande, etiquettesDeLaBande, versionBande, listerCapsules, espaceOccupe } =
    await import("../src/lib/depot");
  const { gainsDeLaBande, historiqueParties, partieEnCours } = await import("../src/lib/depot-jeux");

  await mesurer("chargerContexte (toutes les pages)", () => chargerContexte(membre.id));
  await mesurer("listerEntrees (le fil, le profil, les jeux de données)", () =>
    listerEntrees(groupe.id),
  );
  await mesurer("mediasDeLaBande 120 (la galerie)", () => mediasDeLaBande(groupe.id, 120));
  await mesurer("etiquettesDeLaBande (les souvenirs)", () => etiquettesDeLaBande(groupe.id));
  await mesurer("versionBande (sondage toutes les 8 s)", () => versionBande(groupe.id));
  await mesurer("listerCapsules (les souvenirs)", () =>
    listerCapsules(groupe.id, membre.id, "2026-09-06"),
  );
  await mesurer("espaceOccupe (les réglages)", () => espaceOccupe(groupe.id));
  await mesurer("gainsDeLaBande (le profil)", () => gainsDeLaBande(groupe.id));
  await mesurer("historiqueParties (les jeux)", () => historiqueParties(membre.id));
  await mesurer("partieEnCours (les jeux)", () => partieEnCours(membre.id));

  await prisma.$disconnect();
}

principal().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
