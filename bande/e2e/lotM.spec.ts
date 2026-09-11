import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imageFactice } from "../prisma/image-factice";
import { passerLesNouveautes } from "./aide-jeux";

test("une photo envoyée ressort en WebP, en deux tailles", async ({ page }) => {
  await page.goto("/bienvenue/creer");
  await page.fill("#bande", `M2 ${Date.now().toString(36)}`);
  await page.fill("#pseudo", "Photographe");
  await page.getByRole("button", { name: /créer/i }).click();
  await page.waitForURL(/\/bienvenue\/code/);
  await page.getByRole("button", { name: /c'est noté/i }).click();
  await page.waitForURL("/");
  await passerLesNouveautes(page);
  await page.goto("/aujourdhui");
  await page.getByRole("button", { name: /poser ma joie/i }).click();
  await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

  await page.setInputFiles('input[type="file"][accept="image/*,video/*"]', {
    name: "grande.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageFactice(2400, 1800, [90, 140, 200])),
  });
  await expect(page.locator("img[src*='/api/vignette/']").first()).toBeVisible({ timeout: 30000 });

  const src = await page.locator("img[src*='/api/vignette/']").first().getAttribute("src");
  const id = src!.split("/").pop()!.split("?")[0];

  const vignette = await page.request.get(`/api/vignette/${id}`);
  const originale = await page.request.get(`/api/photo/${id}`);
  const mesure = await page.evaluate(async (id) => {
    const charger = (url: string) =>
      new Promise<{ l: number; h: number }>((ok) => {
        const i = new Image();
        i.onload = () => ok({ l: i.naturalWidth, h: i.naturalHeight });
        i.src = url;
      });
    return { petite: await charger(`/api/vignette/${id}`), grande: await charger(`/api/photo/${id}`) };
  }, id);

  console.log("vignette", vignette.headers()["content-type"], Math.round((await vignette.body()).length / 1024) + " Ko", mesure.petite);
  console.log("originale", originale.headers()["content-type"], Math.round((await originale.body()).length / 1024) + " Ko", mesure.grande);

  expect(vignette.headers()["content-type"]).toBe("image/webp");
  expect(originale.headers()["content-type"]).toBe("image/webp");
  expect(Math.max(mesure.grande.l, mesure.grande.h)).toBe(1600);
  expect(Math.max(mesure.petite.l, mesure.petite.h)).toBe(640);
});

/** L'écran de stockage : il doit dire la vérité, et savoir libérer. */
test("l'écran de stockage montre la répartition et reprend les doublons", async ({ page }) => {
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const code = fiche.split("\n").find((l) => l.startsWith("Momo"))!.split(/\s+/)[1];
  await page.goto("/reprendre");
  await page.fill("#reprise", code);
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
  await passerLesNouveautes(page);

  await page.goto("/reglages/stockage");
  await expect(page.getByRole("heading", { name: "Stockage" })).toBeVisible();
  await expect(page.getByRole("meter", { name: /place occupée/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Par personne" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Par type" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Les plus gros" })).toBeVisible();

  // Le peuplement réutilise les mêmes images : il y a forcément des doublons.
  const section = page.locator("section").filter({ hasText: "Les mêmes, plusieurs fois" });
  await expect(section).toBeVisible();

  // Deux temps : le premier tap demande confirmation, il n'efface rien.
  const bouton = section.getByRole("button", { name: /retirer les copies/i }).first();
  await bouton.click();
  await expect(section.getByRole("button", { name: /confirmer/i }).first()).toBeVisible();
});

/**
 * La file d'envoi : elle ne bloque pas, et elle reprend après une coupure.
 *
 * On coupe la requête d'envoi, pas le réseau entier : `context.setOffline` fait
 * échouer `createImageBitmap` dans le WebKit de Playwright — un artefact du
 * harnais, un vrai iPhone décodant très bien un fichier local hors réseau. En
 * n'abattant que l'appel d'envoi, on éprouve le chemin qui compte, celui de la
 * reprise, sans dépendre d'un bogue du moteur de test.
 */
test("la file d'envoi laisse écrire, et reprend au retour du réseau", async ({ page }) => {
  await page.goto("/bienvenue/creer");
  await page.fill("#bande", `File ${Date.now().toString(36)}`);
  await page.fill("#pseudo", "Patient");
  await page.getByRole("button", { name: /créer/i }).click();
  await page.waitForURL(/\/bienvenue\/code/);
  await page.getByRole("button", { name: /c'est noté/i }).click();
  await page.waitForURL("/");
  await passerLesNouveautes(page);
  await page.goto("/aujourdhui");
  await page.getByRole("button", { name: /poser ma joie/i }).click();
  await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

  let coupe = true;
  await page.route("**/aujourdhui", async (route) => {
    if (coupe && route.request().method() === "POST") {
      await route.abort("internetdisconnected");
      return;
    }
    await route.continue();
  });

  await page.setInputFiles('input[type="file"][accept="image/*,video/*"]', {
    name: "coupure.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageFactice(600, 400, [200, 90, 90])),
  });

  // L'écran reste utilisable, et l'avancement reste visible même en changeant
  // de mode : c'est tout l'intérêt de sortir la file du composant.
  const avancement = page.getByRole("status").filter({ hasText: /envoi|réseau/i });
  await expect(avancement).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: /corriger ta journée/i }).click();
  await expect(avancement).toBeVisible();
  await page.fill("#titre", "Pendant le tunnel");
  await expect(page.locator("#titre")).toHaveValue("Pendant le tunnel");

  // Le réseau revient : la file repart sans qu'on lui demande.
  coupe = false;
  await expect(page.locator("img[src*='/api/vignette/']").first()).toBeVisible({ timeout: 45000 });
});
