import { defineConfig, devices } from "@playwright/test";

/**
 * Deux cibles, et l'ordre compte.
 *
 * La bande est sur iPhone : une capture Chromium ne prouve rien, parce que
 * Safari est le seul moteur autorisé sur iOS et qu'il se comporte
 * différemment — zoom automatique sur les champs sous 16 px, `100vh` qui ment,
 * formats audio distincts. Le projet `iphone` est donc le juge de paix ; le
 * projet `bureau` ne sert qu'à vérifier que rien ne casse sur grand écran.
 *
 * Les navigateurs vivent dans PLAYWRIGHT_BROWSERS_PATH ; WebKit demande une
 * trentaine de bibliothèques système (`npx playwright install-deps webkit`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.ADRESSE ?? "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "iphone",
      use: { ...devices["iPhone 15"] },
    },
    {
      name: "bureau",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  /**
   * En local, on vise le serveur de développement, pas la compilation de
   * production — et ce n'est pas un raccourci.
   *
   * Le cookie de session est marqué `Secure` en production. Chromium fait une
   * exception pour `localhost` et l'accepte quand même ; **WebKit ne la fait
   * pas**. Une suite lancée contre `npm run start` sur `http://localhost`
   * perdait donc silencieusement la session à chaque navigation, et les
   * captures photographiaient l'écran d'accueil en passant au vert.
   *
   * `ADRESSE=https://…` vise l'application déployée, où le cookie est servi en
   * HTTPS et où le problème ne se pose pas.
   */
  webServer: process.env.ADRESSE
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/bienvenue",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
