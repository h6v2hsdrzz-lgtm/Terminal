import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Les tests portent sur la logique pure : dates, analyses, badges, codes,
 * initiales. Rien qui touche la base, qui est éprouvée par les parcours au
 * navigateur — un test qui monte une base pour vérifier une moyenne coûte
 * mille fois son prix.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
