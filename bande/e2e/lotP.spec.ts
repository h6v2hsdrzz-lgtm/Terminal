import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { passerLesNouveautes } from "./aide-jeux";

/**
 * Le lot P : les deux graphiques du profil.
 *
 * Ce qu'un test peut vraiment vérifier sur un graphique : qu'il est là, qu'il
 * répond au doigt, que les périodes changent quelque chose, et surtout **qu'il
 * se tait quand il n'a rien à dire**. Le tracé lui-même se vérifie à l'œil, et
 * son calcul en Vitest (`src/lib/graphiques.test.ts`).
 */
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
  await passerLesNouveautes(page);
}

test("le profil montre l'évolution du classement, et plus l'assiduité", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/profil", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: /l'évolution du classement/i })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /évolution des points cumulés/i }),
  ).toBeVisible();

  // Le classement à côté de la courbe : une place, un nom, un total.
  const classement = page.getByRole("listitem").filter({ hasText: /pts$/ });
  await expect(classement.first()).toBeVisible();
  await expect(classement.first()).toContainText("1er");

  // Et l'ancien bloc a bien disparu.
  await expect(page.getByText("assiduité", { exact: true })).toHaveCount(0);
});

test("les trois périodes changent la fenêtre du graphique", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/profil", { waitUntil: "networkidle" });

  const courbe = page.getByRole("img", { name: /évolution des points cumulés/i });
  await expect(courbe).toBeVisible();

  // On lit tout le texte du tracé — les prénoms en bout de ligne et les deux
  // dates — plutôt que le premier `<text>` venu : l'ordre des éléments d'un SVG
  // suit le dessin, pas la lecture, et le premier est un prénom.
  //
  // `textContent` et pas `innerText` : un `<text>` SVG n'est pas un élément
  // HTML, et Playwright le dit sèchement.
  const lu = () => courbe.textContent();
  const sur30 = await lu();
  await page.getByRole("button", { name: "Tout", exact: true }).first().click();
  await expect.poll(lu).not.toBe(sur30);
});

test("la valeur s'affiche au TAP, parce qu'un téléphone n'a pas de survol", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/profil", { waitUntil: "networkidle" });

  const courbe = page.getByRole("img", { name: /évolution des points cumulés/i });
  await expect(courbe).toBeVisible();
  await courbe.click({ position: { x: 120, y: 60 } });
  // Une ligne de valeurs apparaît sous le tracé : la date, puis chacun.
  await expect(page.getByText(/·.*\d/).last()).toBeVisible();
});

test("les déclencheurs ont leur graphique, et se taisent sous cinq journées", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/profil", { waitUntil: "networkidle" });

  await expect(
    page.getByRole("heading", { name: /les déclencheurs dans le temps/i }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /occurrences de chaque déclencheur/i })).toBeVisible();

  // Les trois pastilles : chacune porte un déclencheur et, s'il y a de quoi,
  // une moyenne. Un tiret sinon — et jamais un chiffre inventé.
  const pastilles = page.getByRole("listitem").filter({ hasText: /Biberon|Marie Janne|Sport/ });
  await expect(pastilles).toHaveCount(3);
  for (const nom of ["Biberon", "Marie Janne", "Sport"]) {
    await expect(pastilles.filter({ hasText: nom })).toContainText(/—|\d,\d/);
  }
});

test("les deux graphiques tiennent dans la largeur d'un iPhone", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/profil", { waitUntil: "networkidle" });

  // La règle commune : deux cents pixels de haut au maximum, et rien qui
  // déborde. Un graphique qui pousse une barre de défilement horizontale rend
  // toute la page désagréable, pas seulement lui.
  for (const nom of [/évolution des points cumulés/i, /occurrences de chaque déclencheur/i]) {
    const cadre = await page.getByRole("img", { name: nom }).boundingBox();
    expect(cadre).not.toBeNull();
    expect(cadre!.height).toBeLessThanOrEqual(200);
    expect(cadre!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  const largeurDocument = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(largeurDocument).toBeLessThanOrEqual(page.viewportSize()!.width);
});
