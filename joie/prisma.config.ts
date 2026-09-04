// Configuration Prisma 7 : le schéma ne porte plus l'URL de la base, elle
// vit ici. `.env` n'est plus chargé automatiquement par la CLI — on s'en
// occupe avec le chargeur natif de Node.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "prisma/config";

// La variable fournie par l'hébergeur prime sur le fichier local.
const fichierEnv = join(import.meta.dirname, ".env");
if (!process.env.DATABASE_URL && existsSync(fichierEnv)) process.loadEnvFile(fichierEnv);

/**
 * Les migrations n'empruntent pas le même chemin que l'application.
 *
 * Prisma pose un verrou consultatif PostgreSQL avant de migrer
 * (`pg_advisory_lock`). Ce verrou vit le temps d'une *session* — or un pool
 * de connexions en mode transaction, celui de Neon comme celui de Supabase,
 * ne garantit pas de rester sur la même session d'une requête à l'autre : le
 * verrou n'est jamais obtenu et la migration expire au bout de dix secondes.
 *
 * D'où deux adresses : l'application passe par le pool (beaucoup de requêtes
 * courtes, peu de connexions), les migrations par la connexion directe.
 * `MIGRATE_DATABASE_URL` est l'adresse directe — la même, sans `-pooler`.
 */
const urlMigrations = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!urlMigrations) throw new Error("DATABASE_URL manquante — voir joie/README.md.");

export default defineConfig({
  schema: join("prisma", "schema.prisma"),
  migrations: { path: join("prisma", "migrations") },
  datasource: { url: urlMigrations },
});
