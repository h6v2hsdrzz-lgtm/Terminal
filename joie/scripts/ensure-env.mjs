// Crée un .env à partir de .env.example au premier lancement local.
//
// Sur un hébergeur, la configuration vient de la plateforme : écrire un .env
// avec l'URL d'exemple risquerait de masquer la vraie base. Le garde-fou
// ci-dessous laisse donc la main dès que DATABASE_URL existe déjà.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.DATABASE_URL) {
  console.log("→ DATABASE_URL fournie par l'environnement, .env laissé tel quel");
} else {
  const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
  const env = join(racine, ".env");
  const exemple = join(racine, ".env.example");

  if (!existsSync(env) && existsSync(exemple)) {
    copyFileSync(exemple, env);
    console.log("→ .env créé à partir de .env.example");
  }
}
