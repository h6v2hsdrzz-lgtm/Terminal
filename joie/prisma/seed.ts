/**
 * Jeu de démonstration : six semaines de mesures pour les trois profils.
 *
 * Les données sont fabriquées avec un effet volontaire — le biberon pèse
 * nettement, la plante verte à peine — pour que le tableau de bord ait
 * quelque chose à montrer dès le premier lancement. Le générateur est
 * déterministe : deux exécutions donnent le même journal.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";

const racine = join(import.meta.dirname, "..");
if (existsSync(join(racine, ".env"))) process.loadEnvFile(join(racine, ".env"));

const PERSONNES = ["Momo", "Sam", "Samy"] as const;
const JOURS = 42;

/** Générateur pseudo-aléatoire à graine — reproductible d'une exécution à l'autre. */
function aleatoire(graine: number) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat * 1664525 + 1013904223) >>> 0;
    return etat / 0x100000000;
  };
}

const tirage = aleatoire(20260829);

/** Base de joie propre à chaque profil, et sensibilité à chaque déclencheur. */
const PROFILS = {
  Momo: { base: 5.6, biberon: 2.1, plante: 0.4, presence: 0.95 },
  Sam: { base: 6.9, biberon: 0.9, plante: 0.8, presence: 0.9 },
  Samy: { base: 6.2, biberon: 1.4, plante: 0.2, presence: 0.85 },
} as const;

const NOTES = [
  "Longue sieste, réveil de bonne humeur.",
  "Journée de pluie, sortie annulée.",
  "Visite des grands-parents.",
  "Nuit courte.",
  "Premier soleil de la semaine.",
  null,
  null,
  null,
];

function versIso(date: Date): string {
  const mois = `${date.getMonth() + 1}`.padStart(2, "0");
  const jour = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

function borner(valeur: number): number {
  return Math.max(1, Math.min(10, Math.round(valeur)));
}

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

  const donnees: {
    date: string;
    personne: string;
    joie: number;
    biberon: boolean;
    planteVerte: boolean;
    notes: string | null;
  }[] = [];

  for (let recul = JOURS - 1; recul >= 0; recul -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - recul);
    const iso = versIso(date);

    // Les déclencheurs sont partagés par la maisonnée : c'est la même journée
    // pour tout le monde.
    const biberon = tirage() < 0.45;
    const planteVerte = tirage() < 0.55;

    for (const personne of PERSONNES) {
      const profil = PROFILS[personne];
      if (tirage() > profil.presence) continue; // journée non renseignée

      const bruit = (tirage() - 0.5) * 2.4;
      const joie = borner(
        profil.base +
          (biberon ? profil.biberon : 0) +
          (planteVerte ? profil.plante : 0) +
          bruit,
      );

      donnees.push({
        date: iso,
        personne,
        joie,
        biberon,
        planteVerte,
        notes: NOTES[Math.floor(tirage() * NOTES.length)],
      });
    }
  }

  await prisma.entree.deleteMany();
  await prisma.entree.createMany({ data: donnees });

  console.log(`✔ ${donnees.length} entrées de démonstration sur ${JOURS} jours.`);
  await prisma.$disconnect();
}

main().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
