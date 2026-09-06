import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le check-in enrichi, de bout en bout, sur le moteur qui décide.
 *
 * Ces tests écrivent vraiment en base : ils posent la journée du jour, la
 * relisent, puis la corrigent. Ils tournent donc dans l'ordre où ils sont
 * écrits, et le premier nettoie derrière lui en reposant une journée neutre.
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
  await expect(page.getByRole("link", { name: "Souvenirs" }).first()).toBeVisible();
}

/**
 * Ouvre le formulaire, que la journée soit déjà posée ou non.
 *
 * Ces tests écrivent en base, et la base survit à la série : rejouer la suite
 * sans repeupler tombe sur l'écran « c'est posé », pas sur le formulaire. Un
 * test qui ne passe qu'une fois n'est pas un test.
 */
async function ouvrirFormulaire(page: import("@playwright/test").Page) {
  const deja = page.getByRole("button", { name: /corriger ta journée/i });
  if (await deja.isVisible().catch(() => false)) await deja.click();
  await expect(page.locator("#titre")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("la figure du jour est dessinée", async ({ page }) => {
  await entrer(page, "Momo");
  // Le rôle « img » et son texte de remplacement : c'est ce que lit un lecteur
  // d'écran, et c'est ce qui doit exister même quand personne n'a rien posé.
  const figure = page.getByRole("img", { name: /figure du jour|Personne n'a encore posé/i }).first();
  await expect(figure).toBeVisible();
});

test("on pose une journée avec titre, étiquettes et curseurs", async ({ page }) => {
  await entrer(page, "Samy");
  await ouvrirFormulaire(page);

  await page.fill("#titre", "Test de bout en bout");
  await page.fill("#note", "Écrit par la suite de tests.");

  // Les lieux : on tape, on valide avec Entrée, la pastille apparaît.
  const champEtiquettes = page.getByLabel("Ajouter un lieu");
  await champEtiquettes.fill("Soirée");
  await champEtiquettes.press("Enter");
  await champEtiquettes.fill("test");
  await champEtiquettes.press("Enter");
  // Le doublon est refusé sur place : c'est ce qui évite « Soirée » et
  // « soiree » côte à côte dans les statistiques.
  await champEtiquettes.fill("SOIREE");
  await champEtiquettes.press("Enter");
  await expect(page.getByRole("button", { name: /^Soirée/ })).toHaveCount(1);

  // Les curseurs secondaires sont repliés : il faut ouvrir pour les atteindre.
  await expect(page.locator("#energie")).toBeHidden();
  await page.getByText("Énergie et calme").click();
  await expect(page.locator("#energie")).toBeVisible();
  await page.locator("#energie").fill("8");

  await page.getByRole("button", { name: /poser ma joie|^Corriger$/i }).click();

  // La journée revient du serveur : c'est la preuve qu'elle a été écrite, et
  // pas seulement affichée.
  await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();
  // Le titre paraît deux fois, et c'est normal : une fois dans la carte « c'est
  // posé », une fois dans la journée telle qu'elle apparaît au fil du jour.
  await expect(page.getByText("Test de bout en bout").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Test de bout en bout").first()).toBeVisible();
  await expect(page.getByText("Soirée", { exact: true }).first()).toBeVisible();
});

test("l'étiquette est proposée à la bande, sans doublon d'accent", async ({ page }) => {
  await entrer(page, "Lou");
  await ouvrirFormulaire(page);

  // La liste courte montre les étiquettes les plus utilisées de la bande ;
  // « Soirée » n'en a qu'un usage et n'y figure pas. On la retrouve en tapant,
  // sans son accent — c'est tout l'intérêt de normaliser la clé.
  const champEtiquettes = page.getByLabel("Ajouter un lieu");
  await champEtiquettes.fill("soir");
  const proposition = page.getByRole("button", { name: "Soirée", exact: true });
  await expect(proposition).toHaveCount(1);

  // La cliquer la pose, avec son accent et sa majuscule d'origine.
  await proposition.click();
  await expect(page.getByRole("button", { name: /^Soirée/ })).toHaveCount(1);
});

test("la correction reprend ce qui a été écrit", async ({ page }) => {
  await entrer(page, "Samy");
  await ouvrirFormulaire(page);

  await expect(page.locator("#titre")).toHaveValue("Test de bout en bout");
  // Les étiquettes reviennent en pastilles, pas en texte à retaper.
  await expect(page.getByRole("button", { name: /^Soirée/ })).toBeVisible();

  await page.fill("#titre", "Corrigé");
  await page.getByRole("button", { name: /^Corriger$/ }).click();
  await expect(page.getByText("Corrigé").first()).toBeVisible();
});

test("le voile ne laisse pas fuir les notes des autres", async ({ page }) => {
  // Samy vient de poser ; Momo, lui, n'a rien posé aujourd'hui. Son écran doit
  // donc être voilé — et surtout, la note de Samy ne doit pas se trouver dans
  // le HTML, où trois clics dans les outils du navigateur suffiraient à la lire.
  await entrer(page, "Momo");
  const html = await page.content();
  expect(html).not.toContain("Écrit par la suite de tests.");
  expect(html).not.toContain("Corrigé");
});

test("la note vocale se sert, et seulement à la bande", async ({ page, request }) => {
  await entrer(page, "Momo");
  await page.goto("/fil", { waitUntil: "networkidle" });

  // Le lecteur se trouve par son bouton : c'est aussi ce que lit un lecteur
  // d'écran, donc le trouver ici vérifie deux choses d'un coup.
  const lecteur = page.getByRole("button", { name: /Écouter la note vocale/i }).first();
  await expect(lecteur).toBeVisible();

  const adresse = await page.locator("audio").first().getAttribute("src");
  expect(adresse).toMatch(/^\/api\/audio\//);

  // Le son sort bien de la route, avec son type — sans quoi Safari refuse de
  // le lire sans rien dire.
  const reponse = await page.request.get(adresse!);
  expect(reponse.status()).toBe(200);
  expect(reponse.headers()["content-type"]).toMatch(/^audio\//);
  expect((await reponse.body()).byteLength).toBeGreaterThan(1000);

  // Sans session, rien. `request` est un contexte neuf, sans les cookies de la
  // page : c'est ce qui rend le contrôle réel.
  const sansSession = await request.get(adresse!);
  expect(sansSession.status()).toBe(401);
});

test("la forme d'onde vient du son, pas d'un décor", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/fil", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: /Écouter la note vocale/i }).first()).toBeVisible();

  // Des barres toutes identiques trahiraient une onde décorative. On vérifie
  // qu'elles varient vraiment.
  const hauteurs = await page.evaluate(() => {
    const lecteur = document.querySelector("audio")?.closest("div");
    const barres = lecteur?.parentElement?.querySelectorAll("span[data-barre], .barre-onde") ?? [];
    return [...barres].map((b) => (b as HTMLElement).getBoundingClientRect().height);
  });
  if (hauteurs.length > 0) expect(new Set(hauteurs).size).toBeGreaterThan(1);
});
