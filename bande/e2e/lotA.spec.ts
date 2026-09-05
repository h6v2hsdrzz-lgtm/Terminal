import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Le lot A : renommages, profil. */
function codeDe(pseudo: string): string {
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const ligne = fiche.split("\n").find((l) => l.startsWith(pseudo));
  if (!ligne) throw new Error(`Pas de code pour ${pseudo} — lance « npm run db:seed ».`);
  return ligne.split(/\s+/)[1];
}

async function entrer(page: import("@playwright/test").Page, pseudo: string) {
  await page.goto("/reprendre");
  await page.fill("#reprise", codeDe(pseudo));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("link", { name: "Souvenirs" }).first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("les renommages sont partout, et la donnée a suivi", async ({ page }) => {
  await entrer(page, "Momo");

  // Le déclencheur a été renommé EN BASE, pas seulement dans le code : sans la
  // migration, une bande déjà créée aurait gardé « Plante verte ».
  await expect(page.getByText("Marie Jane").first()).toBeVisible();
  await expect(page.getByText("Plante verte")).toHaveCount(0);

  await expect(page.getByPlaceholder(/anecdote/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Où \?/)).toBeVisible();

  // Et le lien avec les journées a survécu au renommage : le déclencheur a un
  // effet mesuré, donc il porte bien son historique.
  await page.goto("/stats", { waitUntil: "networkidle" });
  await expect(page.getByText("Marie Jane").first()).toBeVisible();
});

test("le profil n'affiche plus de compteurs", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/profil", { waitUntil: "networkidle" });
  // Les libellés EXACTS des trois tuiles. « journées posées » reparaît dans une
  // phrase du classement d'assiduité — c'est une explication, pas un compteur,
  // et la chercher au milieu d'un texte ferait échouer le test sans raison.
  for (const parti of [/^jours? d'affilée$/, /^ton record$/, /^journées posées$/]) {
    await expect(page.getByText(parti)).toHaveCount(0);
  }
});

test("on change son nom, et le passé change avec", async ({ page }) => {
  await entrer(page, "Lou");
  await page.goto("/profil", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /changer de nom/i }).click();
  await page.locator("#pseudo").fill("Loulou");
  await page.getByRole("button", { name: "Garder" }).click();

  await expect(page.getByRole("heading", { name: "Loulou" })).toBeVisible();

  // Le pseudo n'est recopié nulle part : les journées d'il y a des mois
  // s'affichent sous le nouveau nom, sans rien avoir réécrit.
  await page.goto("/fil", { waitUntil: "networkidle" });
  await expect(page.getByText("Loulou").first()).toBeVisible();
  await expect(page.getByText("Lou", { exact: true })).toHaveCount(0);

  // On repose le décor pour la prochaine exécution.
  await page.goto("/profil", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /changer de nom/i }).click();
  await page.locator("#pseudo").fill("Lou");
  await page.getByRole("button", { name: "Garder" }).click();
  await expect(page.getByRole("heading", { name: "Lou" })).toBeVisible();
});

test("un nom déjà pris est refusé, à la casse près", async ({ page }) => {
  await entrer(page, "Lou");
  await page.goto("/profil", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /changer de nom/i }).click();
  await page.locator("#pseudo").fill("sAm");
  await page.getByRole("button", { name: "Garder" }).click();

  // `.first()` : Next pose son propre `role="alert"` pour annoncer les
  // changements de route, et il est vide.
  await expect(page.getByRole("alert").first()).toContainText(/déjà pris/i);
  // Le champ reste ouvert et rempli : on corrige, on ne recommence pas.
  await expect(page.locator("#pseudo")).toHaveValue("sAm");
});

test("reprendre son propre nom en changeant la casse passe", async ({ page }) => {
  await entrer(page, "Lou");
  await page.goto("/profil", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /changer de nom/i }).click();
  await page.locator("#pseudo").fill("LOU");
  await page.getByRole("button", { name: "Garder" }).click();
  await expect(page.getByRole("heading", { name: "LOU" })).toBeVisible();

  await page.getByRole("button", { name: /changer de nom/i }).click();
  await page.locator("#pseudo").fill("Lou");
  await page.getByRole("button", { name: "Garder" }).click();
  await expect(page.getByRole("heading", { name: "Lou" })).toBeVisible();
});
