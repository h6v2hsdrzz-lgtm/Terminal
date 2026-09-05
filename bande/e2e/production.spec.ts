import { expect, test } from "@playwright/test";

/**
 * Le test de fumée : une bande neuve, tout le rituel, puis on efface.
 *
 * Il ne dépend d'aucune base peuplée et ne touche à aucune donnée existante :
 * il crée sa propre bande, y travaille, puis la quitte — et le dernier membre
 * qui part emporte le groupe avec lui. C'est ce qui le rend exécutable contre
 * la production sans rien y abîmer :
 *
 *   ADRESSE=https://journal-de-joie-v2.vercel.app npx playwright test e2e/production
 *
 * Ce qu'il ne couvre pas : l'enregistrement vocal. Il demande un vrai micro, et
 * WebKit sans tête n'en simule pas. Le stockage et la lecture du son sont
 * éprouvés par `lot1.spec.ts` sur la base locale, et la route qui le sert est
 * vérifiée ici — elle doit refuser sans session.
 */

/** Un PNG rouge de 2×2, écrit à la main : pas de fichier binaire au dépôt. */
const PNG_2x2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z4AATAxIYFSAaAIA" +
    "W6gCFwtlHzYAAAAASUVORK5CYII=",
  "base64",
);

test("une bande neuve, de bout en bout, puis effacée", async ({ page, request }) => {
  // Un nom unique : deux exécutions simultanées ne doivent pas se gêner, et un
  // nom fixe finirait par laisser des bandes fantômes si le test s'interrompt.
  const nomBande = `Fumée ${Date.now().toString(36)}`;

  await page.goto("/bienvenue/creer");
  await page.fill("#bande", nomBande);
  await page.fill("#pseudo", "Testeur");
  await page.getByRole("button", { name: /créer/i }).click();

  // L'écran du code de reprise : on le note et on entre.
  await page.waitForURL(/\/bienvenue\/code/);
  await page.getByRole("button", { name: /c'est noté/i }).click();
  await page.waitForURL("/");

  // ── La figure du jour, avant d'avoir rien posé ─────────────────────────
  await expect(
    page.getByRole("img", { name: /figure du jour|Personne n'a encore posé/i }).first(),
  ).toBeVisible();

  // ── Le check-in enrichi ────────────────────────────────────────────────
  await page.fill("#titre", "Premier jour");
  await page.fill("#note", "On essaie tout.");

  const etiquettes = page.getByLabel("Ajouter une étiquette");
  await etiquettes.fill("Essai");
  await etiquettes.press("Enter");

  await page.getByText("Énergie et calme").click();
  await page.locator("#energie").fill("8");
  await page.locator("#calme").fill("3");

  await page.getByRole("button", { name: /poser ma joie/i }).click();
  await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

  // Le serveur a bien écrit : on recharge plutôt que de croire l'écran.
  await page.reload();
  await expect(page.getByText("Premier jour").first()).toBeVisible();
  await expect(page.getByText("Essai", { exact: true }).first()).toBeVisible();

  // ── Une photo ──────────────────────────────────────────────────────────
  await page.setInputFiles('input[type="file"][accept="image/*"]', {
    name: "essai.png",
    mimeType: "image/png",
    buffer: PNG_2x2,
  });
  const image = page.locator('img[src^="/api/photo/"]').first();
  await expect(image).toBeVisible({ timeout: 20_000 });

  // Elle se sert vraiment, et pas à n'importe qui.
  const adressePhoto = await image.getAttribute("src");
  const servie = await page.request.get(adressePhoto!);
  expect(servie.status()).toBe(200);
  expect(servie.headers()["content-type"]).toMatch(/^image\//);
  // `request` est un contexte neuf, sans les cookies de la page.
  expect((await request.get(new URL(adressePhoto!, page.url()).href)).status()).toBe(401);

  // ── La route du vocal existe et se garde ───────────────────────────────
  expect((await request.get(new URL("/api/audio/inexistant", page.url()).href)).status()).toBe(401);

  // ── Les autres écrans tiennent debout avec une seule journée ───────────
  for (const chemin of ["/fil", "/stats", "/souvenirs", "/profil"]) {
    await page.goto(chemin, { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: "Souvenirs" }).first()).toBeVisible();
    const debordement = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(debordement, `${chemin} déborde`).toBeLessThanOrEqual(1);
  }

  // ── On efface : le dernier membre qui part emporte la bande ────────────
  await page.goto("/reglages", { waitUntil: "networkidle" });
  await page.getByText("Quitter la bande", { exact: true }).click();
  // Le nom se recopie à la main : un bouton se clique par erreur, pas une phrase.
  await page.locator("#confirmation").fill(nomBande);
  await page.getByRole("button", { name: /partir pour de bon/i }).click();

  await page.waitForURL(/\/bienvenue/);
  // Et la session est bien fermée : revenir à l'accueil renvoie au portail.
  await page.goto("/");
  await page.waitForURL(/\/bienvenue/);
});
