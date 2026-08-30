// Configuration Prisma 7 : le schéma ne porte plus l'URL de la base, elle
// vit ici. `.env` n'est plus chargé automatiquement par la CLI — on s'en
// occupe avec le chargeur natif de Node.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, env } from "prisma/config";

// La variable fournie par l'hébergeur prime sur le fichier local.
const fichierEnv = join(import.meta.dirname, ".env");
if (!process.env.DATABASE_URL && existsSync(fichierEnv)) process.loadEnvFile(fichierEnv);

export default defineConfig({
  schema: join("prisma", "schema.prisma"),
  migrations: { path: join("prisma", "migrations") },
  datasource: { url: env("DATABASE_URL") },
});
