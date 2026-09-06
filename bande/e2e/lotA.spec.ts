import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imageFactice } from "../prisma/image-factice";

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

test("on met une photo de profil, on la recadre, on la retire", async ({ page, request }) => {
  await entrer(page, "Samy");
  await page.goto("/profil", { waitUntil: "networkidle" });

  // Une image plus large que haute : c'est le cas qui met le recadrage à
  // l'épreuve, puisqu'il faut en tirer un carré.
  await page.setInputFiles('input[type="file"][accept="image/*"]', {
    name: "moi.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageFactice(240, 120, [80, 140, 200])),
  });

  const decoupe = page.getByRole("dialog", { name: /recadrer/i });
  await expect(decoupe).toBeVisible();
  await page.locator("#zoom").fill("1.6");
  await decoupe.getByRole("button", { name: "Garder" }).click();

  const photo = page.locator('img[src^="/api/avatar/"]').first();
  await expect(photo).toBeVisible();

  // Elle est bien servie, en JPEG, et carrée : c'est le navigateur qui a
  // découpé, donc c'est là que ça pouvait rater.
  const adresse = (await photo.getAttribute("src"))!;
  const servie = await page.request.get(adresse);
  expect(servie.status()).toBe(200);
  expect(servie.headers()["content-type"]).toBe("image/jpeg");
  expect((await servie.body()).byteLength).toBeGreaterThan(500);

  // Et pas sans session : `request` est un contexte neuf, sans les cookies.
  expect((await request.get(new URL(adresse, page.url()).href)).status()).toBe(401);

  // Elle remplace les initiales partout, pas seulement sur le profil.
  await page.goto("/fil", { waitUntil: "networkidle" });
  await expect(page.locator('img[src^="/api/avatar/"]').first()).toBeVisible();

  // On repose le décor.
  await page.goto("/profil", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /revenir aux initiales/i }).click();
  await expect(page.locator('img[src^="/api/avatar/"]')).toHaveCount(0);
});

test("la photo d'une autre bande ne se sert pas", async ({ page }) => {
  // C'est le contrôle qui remplace la RLS ici : l'autorisation est vérifiée
  // dans la requête, pas dans la base. Une bande neuve ne doit pas pouvoir
  // tirer l'avatar de quelqu'un d'autre, même avec son identifiant en main.
  await entrer(page, "Samy");
  await page.goto("/profil", { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"][accept="image/*"]', {
    name: "moi.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageFactice(200, 200, [200, 90, 90])),
  });
  await page.getByRole("dialog", { name: /recadrer/i }).getByRole("button", { name: "Garder" }).click();
  const adresse = (await page.locator('img[src^="/api/avatar/"]').first().getAttribute("src"))!;

  // Une bande neuve, sans aucun rapport.
  const nomBande = `Intrus ${Date.now().toString(36)}`;
  await page.goto("/bienvenue/creer");
  await page.fill("#bande", nomBande);
  await page.fill("#pseudo", "Curieux");
  await page.getByRole("button", { name: /créer/i }).click();
  await page.waitForURL(/\/bienvenue\/code/);
  await page.getByRole("button", { name: /c'est noté/i }).click();
  await page.waitForURL("/");

  // Session valide, identifiant valide, bande différente : rien.
  expect((await page.request.get(adresse)).status()).toBe(404);

  // On efface la bande d'essai : le dernier membre qui part l'emporte.
  await page.goto("/reglages", { waitUntil: "networkidle" });
  await page.getByText("Quitter la bande", { exact: true }).click();
  await page.locator("#confirmation").fill(nomBande);
  await page.getByRole("button", { name: /partir pour de bon/i }).click();
  await page.waitForURL(/\/bienvenue/);

  // Et on repose le décor de la bande de démonstration.
  await entrer(page, "Samy");
  await page.goto("/profil", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /revenir aux initiales/i }).click();
  await expect(page.locator('img[src^="/api/avatar/"]')).toHaveCount(0);
});
