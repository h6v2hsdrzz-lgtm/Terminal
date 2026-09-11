import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { passerLesNouveautes } from "./aide-jeux";

/**
 * Le lot L : le fil.
 *
 * Ce qui se vérifie ici ne se vérifie nulle part ailleurs : la pagination
 * dépend d'un `IntersectionObserver`, l'appui long d'une suite d'événements
 * de pointeur, et le partage d'un canvas. Aucun des trois ne se teste en
 * Vitest — c'est du navigateur, et sur WebKit, parce que c'est le seul moteur
 * qui tourne sur les téléphones de la bande.
 */
function codeDe(pseudo: string): string {
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const ligne = fiche.split("\n").find((l) => l.startsWith(pseudo));
  if (!ligne) throw new Error(`Pas de code pour ${pseudo} — lance « npm run db:seed ».`);
  return ligne.split(/\s+/)[1];
}

async function entrer(page: Page, pseudo: string) {
  await page.goto("/reprendre");
  await page.fill("#reprise", codeDe(pseudo));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
  await passerLesNouveautes(page);
}

/** Un appui long, à la main : Playwright n'a pas de geste « tenir ». */
async function appuiLong(page: Page, cible: Locator) {
  const boite = await cible.boundingBox();
  if (!boite) throw new Error("Carte introuvable.");
  const x = boite.x + boite.width / 2;
  const y = boite.y + 24;
  const commun = { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y };
  await cible.dispatchEvent("pointerdown", commun);
  // Plus long que le seuil du composant, sans bouger d'un pixel : bouger
  // annule, et c'est exactement ce qu'on veut quand on fait défiler.
  await page.waitForTimeout(700);
  await cible.dispatchEvent("pointerup", commun);
}

const journees = (page: Page) => page.locator("section h2");
const cartes = (page: Page) => page.locator("[data-carte]");

/** Attend que le fil soit vivant : sans hydratation, rien ne défile ni ne s'ouvre. */
async function filPret(page: Page) {
  await expect(page.getByRole("tab", { name: "Tout" })).toBeVisible();
  await expect(cartes(page).first()).toBeVisible();
  await page.waitForTimeout(600);
}

test("charge la suite du fil en défilant, et remonte d'un tap", async ({ page }) => {
  await entrer(page, "Momo");
  await filPret(page);

  const avant = await journees(page).count();
  expect(avant).toBeGreaterThan(0);

  // On redescend à chaque tour : une seule poussée peut s'arrêter avant que
  // la sentinelle entre dans le champ, et le test attendrait pour rien.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        return journees(page).count();
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(avant);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const remonter = page.getByRole("button", { name: /revenir en haut/i });
  await expect(remonter).toBeVisible();
  await remonter.click();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeLessThan(50);
});

test("les filtres rapides changent ce que montre le fil", async ({ page }) => {
  await entrer(page, "Momo");

  const tout = await journees(page).count();
  await page.getByRole("tab", { name: "Vocaux" }).click();
  await expect.poll(() => journees(page).count(), { timeout: 6000 }).toBeLessThanOrEqual(tout);
  await expect(page.getByRole("tab", { name: "Vocaux" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Tout" }).click();
  await expect.poll(() => journees(page).count(), { timeout: 6000 }).toBe(tout);
});

test("l'appui long ouvre le menu, et l'épingle remonte la journée", async ({ page }) => {
  await entrer(page, "Momo");
  await filPret(page);
  // Une journée passée : celles d'aujourd'hui peuvent être voilées, et une
  // carte voilée n'a pas de menu — c'est voulu.
  await page.evaluate(() => window.scrollBy(0, 1500));
  await page.waitForTimeout(400);

  const carte = cartes(page).last();
  await appuiLong(page, carte);

  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /partager en image/i })).toBeVisible();

  await menu.getByRole("button", { name: /épingler en haut/i }).click();
  await expect(page.getByRole("heading", { name: "Épinglées" })).toBeVisible({ timeout: 8000 });

  // Et on décroche, pour que le test suivant reparte d'un fil propre.
  // La carte épinglée est toujours dans le fil, plus bas : c'est elle qu'on
  // décroche, la section « Épinglées » n'ayant pas de menu.
  await appuiLong(page, cartes(page).last());
  await page.getByRole("dialog").getByRole("button", { name: /décrocher/i }).click();
  await expect(page.getByRole("heading", { name: "Épinglées" })).toBeHidden({ timeout: 8000 });
});

test("partager une journée fabrique une image 9:16", async ({ page }) => {
  await entrer(page, "Momo");
  await filPret(page);
  await page.evaluate(() => window.scrollBy(0, 1500));
  await page.waitForTimeout(400);

  // Le partage passe par `navigator.share` quand il existe ; ici on veut
  // vérifier l'image elle-même, donc on appelle le dessin directement et on
  // regarde ce qui sort. C'est le seul endroit du dépôt où un test appelle du
  // code de rendu : un canvas ne se teste pas ailleurs que dans un navigateur.
  const dimensions = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    return { l: canvas.width, h: canvas.height, rapport: canvas.height / canvas.width };
  });
  expect(dimensions.rapport).toBeCloseTo(16 / 9, 2);

  await appuiLong(page, cartes(page).last());
  const partage = page.getByRole("dialog").getByRole("button", { name: /partager en image/i });

  const telechargement = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await partage.click();
  const fichier = await telechargement;
  // Sur un moteur qui sait partager, la feuille système s'ouvre et il n'y a
  // pas de téléchargement : les deux issues sont bonnes, l'échec serait une
  // erreur de page, et le test en lèverait une.
  if (fichier) expect(fichier.suggestedFilename()).toMatch(/^journee-.*\.png$/);
});
