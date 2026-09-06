import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Le lot B : la visionneuse, et prendre une photo depuis l'app. */
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
}

test("le plein écran s'ouvre, se parcourt et se ferme", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/galerie", { waitUntil: "networkidle" });

  await page.locator('img[src^="/api/vignette/"]').first().click();
  const plein = page.getByRole("dialog", { name: /galerie de la bande/i });
  await expect(plein).toBeVisible();

  // La position est annoncée, et la flèche fait avancer.
  await expect(plein.getByText(/^1 \/ \d+/)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(plein.getByText(/^2 \/ \d+/)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(plein.getByText(/^1 \/ \d+/)).toBeVisible();

  // Enregistrer ou partager : le bouton existe et porte un nom lisible.
  await expect(plein.getByRole("button", { name: /enregistrer ou partager/i })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(plein).toBeHidden();
});

test("un glissement vers le bas ferme le plein écran", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/galerie", { waitUntil: "networkidle" });
  await page.locator('img[src^="/api/vignette/"]').first().click();

  const plein = page.getByRole("dialog", { name: /galerie de la bande/i });
  await expect(plein).toBeVisible();

  // Le geste qu'on fait sans y penser dans n'importe quelle application photo.
  const boite = (await plein.boundingBox())!;
  const x = boite.x + boite.width / 2;
  const y = boite.y + boite.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const pas of [40, 90, 150, 210]) await page.mouse.move(x, y + pas);
  await page.mouse.up();

  await expect(plein).toBeHidden();
});

test("un glissement horizontal change d'image", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/galerie", { waitUntil: "networkidle" });
  await page.locator('img[src^="/api/vignette/"]').first().click();

  const plein = page.getByRole("dialog", { name: /galerie de la bande/i });
  const boite = (await plein.boundingBox())!;
  const x = boite.x + boite.width / 2;
  const y = boite.y + boite.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const pas of [30, 80, 130]) await page.mouse.move(x - pas, y);
  await page.mouse.up();

  await expect(plein.getByText(/^2 \/ \d+/)).toBeVisible();
});

test("on peut prendre une photo depuis l'app, sans perdre la pellicule", async ({ page }) => {
  /**
   * Une bande à soi, et pas un membre de la démonstration.
   *
   * La première version se connectait à un compte existant. Elle passait seule
   * et tombait dans la suite complète : les autres specs remplissent les
   * journées, et les deux commandes d'ajout disparaissent quand la journée a
   * atteint son quota de médias. Un test dont le résultat dépend de l'ordre
   * d'exécution ne teste plus ce qu'il croit tester.
   */
  const nom = `Pellicule ${Date.now().toString(36)}`;
  try {
    await page.goto("/bienvenue/creer");
    await page.fill("#bande", nom);
    await page.fill("#pseudo", "Photographe");
    await page.getByRole("button", { name: /créer/i }).click();
    await page.waitForURL(/\/bienvenue\/code/);
    await page.getByRole("button", { name: /c'est noté/i }).click();
    await page.waitForURL("/");

    await page.goto("/aujourdhui", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /poser ma joie/i }).click();
    await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

    // Deux entrées distinctes, et c'est le point : sur iPhone, `capture` ouvre
    // l'appareil ET FERME la pellicule. Une seule commande obligerait à choisir
    // entre les deux pour tout le monde.
    const appareil = page.locator('input[type="file"][capture]');
    await expect(appareil).toHaveCount(1);
    await expect(appareil).toHaveAttribute("capture", "environment");

    const pellicule = page.locator('input[type="file"][multiple]:not([capture])');
    await expect(pellicule).toHaveCount(1);
  } finally {
    // La bande repart : le dernier membre qui quitte emporte le groupe.
    await page.goto("/reglages", { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.getByText("Quitter la bande", { exact: true }).click().catch(() => {});
    await page.locator("#confirmation").fill(nom).catch(() => {});
    await page
      .getByRole("button", { name: /partir pour de bon/i })
      .click()
      .catch(() => {});
  }
});
