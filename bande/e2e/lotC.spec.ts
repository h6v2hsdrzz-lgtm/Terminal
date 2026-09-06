import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imageFactice } from "../prisma/image-factice";

/** Le lot C : les scellés — quatre types, le sablier, l'empilement. */
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

test("le fil empile les scellés au lieu de les aligner", async ({ page }) => {
  await entrer(page, "Momo");

  // Quatre scellés en attente dans la base de démonstration : au-delà de deux,
  // ils tiennent dans une seule bulle. L'espace du fil est précieux.
  const pile = page.getByRole("button", { name: /scellés en attente/ });
  await expect(pile).toBeVisible();
  await expect(page.getByText(/Le prochain, .*, s'ouvre dans/)).toBeVisible();

  await pile.click();
  // Déployée, chaque scellé a sa ligne, et on peut replier.
  await expect(page.getByRole("button", { name: "replier" })).toBeVisible();
  expect(await page.getByText(/S'ouvre dans/).count()).toBeGreaterThan(2);
});

test("un scellé fermé ne laisse rien passer, même à son auteur", async ({ page, request }) => {
  await entrer(page, "Momo");
  await page.goto("/souvenirs", { waitUntil: "networkidle" });

  // L'aperçu se sert — il est déjà illisible dans ses octets, trente-deux
  // pixels de côté. Le contenu, lui, refuse jusqu'au jour dit.
  const apercu = page.locator('img[src^="/api/scelle/"][src$="/apercu"]').first();
  await expect(apercu).toBeVisible();
  const adresseApercu = (await apercu.getAttribute("src"))!;
  const reponseApercu = await page.request.get(adresseApercu);
  expect(reponseApercu.status()).toBe(200);
  // Trente-deux pixels de côté : quelques centaines d'octets, pas une photo.
  expect((await reponseApercu.body()).byteLength).toBeLessThan(4000);

  // Le contenu du même scellé : 404 tant que la date n'est pas venue, et ça
  // vaut pour celui qui l'a écrit. Un scellé qu'on peut rouvrir soi-même n'en
  // est pas un.
  const contenu = adresseApercu.replace(/\/apercu$/, "");
  expect((await page.request.get(contenu)).status()).toBe(404);

  // Et rien du tout sans session.
  expect((await request.get(new URL(adresseApercu, page.url()).href)).status()).toBe(401);
});

test("on scelle un mot, et il apparaît en sablier", async ({ page }) => {
  await entrer(page, "Lou");
  await page.goto("/souvenirs", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /en sceller un/i }).click();
  await page.getByRole("button", { name: "Un mot", exact: true }).click();

  const message = `Essai ${Date.now().toString(36)}`;
  await page.locator("#texte-scelle").fill(message);
  await page.getByRole("button", { name: "Sceller" }).click();

  // Il rejoint les sabliers, et son contenu ne s'affiche pas.
  await expect(page.getByText(/Tu as scellé un mot/).first()).toBeVisible();
  await page.reload();
  expect(await page.getByText(message).count()).toBe(0);
});

test("le formulaire refuse une date trop proche", async ({ page }) => {
  await entrer(page, "Lou");
  await page.goto("/souvenirs", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /en sceller un/i }).click();

  await page.locator("#texte-scelle").fill("Trop tôt");

  // Le champ porte un `min`, mais il se contourne — c'est le serveur qui
  // tranche, et c'est ce qu'on éprouve ici. On part du `min` affiché pour
  // trouver une date interdite, plutôt que de supposer la date du jour : la
  // journée de la bande ne commence pas forcément à minuit.
  const champDate = page.locator("#ouvrir-le");
  const minimum = (await champDate.getAttribute("min"))!;
  const interdite = new Date(`${minimum}T00:00:00Z`);
  interdite.setUTCDate(interdite.getUTCDate() - 6);
  // `fill` passe par les événements natifs, que React écoute vraiment :
  // écrire `.value` à la main ne prévient pas un champ contrôlé, et le
  // formulaire partait avec la date d'origine — le test passait à côté.
  await champDate.fill(interdite.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Sceller" }).click();

  // Pas `getByRole("alert").first()` : Next pose son propre alerte vide pour
  // annoncer les changements de route, et elle vient en premier dans le DOM.
  await expect(page.getByText(/Choisis une date d'au moins/)).toBeVisible();
});

test("on scelle une photo, et l'aperçu ne la montre pas", async ({ page }) => {
  await entrer(page, "Sam");
  await page.goto("/souvenirs", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /en sceller un/i }).click();
  await page.getByRole("button", { name: "Une photo", exact: true }).click();
  await page.setInputFiles('input[type="file"][accept="image/*"]', {
    name: "secret.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageFactice(600, 400, [40, 160, 90])),
  });
  await expect(page.getByText("c'est prêt")).toBeVisible({ timeout: 30_000 });

  await page.locator("#texte-scelle").fill("À rouvrir plus tard");
  await page.getByRole("button", { name: "Sceller" }).click();
  await expect(page.getByText(/Tu as scellé une photo/).first()).toBeVisible();

  // L'aperçu envoyé pèse quelques centaines d'octets : c'est une image de
  // trente-deux pixels, pas la photo floutée à l'affichage.
  const apercu = page.locator('img[src^="/api/scelle/"][src$="/apercu"]').first();
  const octets = (await (await page.request.get((await apercu.getAttribute("src"))!)).body()).byteLength;
  expect(octets).toBeLessThan(4000);
});
