import { existsSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "prisma/config";

// La variable fournie par l'hébergeur prime sur le fichier local.
const fichierEnv = join(import.meta.dirname, ".env");
if (!process.env.DATABASE_URL && existsSync(fichierEnv)) process.loadEnvFile(fichierEnv);

/**
 * Les migrations passent par la connexion DIRECTE, pas par le pool.
 *
 * Prisma pose un verrou consultatif PostgreSQL avant de migrer. Ce verrou vit
 * le temps d'une session, et un pool en mode transaction ne garantit pas de
 * rester sur la même : le verrou n'est jamais obtenu, et la migration expire.
 */
const urlMigrations = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!urlMigrations) throw new Error("DATABASE_URL manquante — voir bande/README.md.");

export default defineConfig({
  schema: join("prisma", "schema.prisma"),
  migrations: { path: join("prisma", "migrations") },
  datasource: { url: urlMigrations },
});
