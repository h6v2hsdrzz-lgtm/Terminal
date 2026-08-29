// Crée un .env à partir de .env.example au premier lancement.
// Sans DATABASE_URL, la CLI Prisma s'arrête avec une erreur peu parlante ;
// autant éviter ce faux départ.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = join(racine, ".env");
const exemple = join(racine, ".env.example");

if (!existsSync(env) && existsSync(exemple)) {
  copyFileSync(exemple, env);
  console.log("→ .env créé à partir de .env.example");
}
