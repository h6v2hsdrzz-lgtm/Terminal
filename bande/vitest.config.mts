import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Les tests portent sur la logique pure : dates, analyses, badges, codes,
 * initiales. Rien qui touche la base, qui est éprouvée par les parcours au
 * navigateur — un test qui monte une base pour vérifier une moyenne coûte
 * mille fois son prix.
 *
 * L'exception est le client R2 : il ne touche pas la base, il parle HTTP, et
 * un faux S3 en mémoire l'éprouve très bien. Il porte `server-only`, dont le
 * seul rôle est de casser le build si un composant client l'importe ; hors de
 * Next il n'a rien à garder, d'où l'alias vers un module vide.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/lib/__tests__/vide.ts", import.meta.url)),
    },
  },
});
