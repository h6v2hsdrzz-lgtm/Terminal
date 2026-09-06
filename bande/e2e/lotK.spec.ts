import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imageFactice } from "../prisma/image-factice";

/** Le lot K : l'ergonomie de l'écran « Aujourd'hui ». */
const PNG = Buffer.from(imageFactice(48, 48, [120, 160, 90]));

function codeDe(pseudo: string): string {
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const ligne = fiche.split("\n").find((l) => l.startsWith(pseudo));
  if (!ligne) throw new Error(`Pas de code pour ${pseudo} — lance « npm run db:seed ».`);
  return ligne.split(/\s+/)[1];
}

/**
 * Une bande à soi.
 *
 * Les journées de la bande de démonstration sont remplies par les autres
 * specs, et les commandes d'ajout disparaissent quand le quota de médias est
 * atteint. Un test qui dépend de l'ordre d'exécution ne teste plus rien.
 */
async function bandeNeuve(page: Page, nom: string) {
  await page.goto("/bienvenue/creer");
  await page.fill("#bande", nom);
  await page.fill("#pseudo", "Photographe");
  await page.getByRole("button", { name: /créer/i }).click();
  await page.waitForURL(/\/bienvenue\/code/);
  await page.getByRole("button", { name: /c'est noté/i }).click();
  await page.waitForURL("/");
}

async function entrer(page: Page, pseudo: string) {
  await page.goto("/reprendre");
  await page.fill("#reprise", codeDe(pseudo));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
}

async function quitter(page: Page, nom: string) {
  await page.goto("/reglages", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.getByText("Quitter la bande", { exact: true }).click().catch(() => {});
  await page.locator("#confirmation").fill(nom).catch(() => {});
  await page.getByRole("button", { name: /partir pour de bon/i }).click().catch(() => {});
}

test("les deux boutons média : la caméra d'abord, et de vrais pavés", async ({ page }) => {
  test.slow();
  const nom = `Boutons ${Date.now().toString(36)}`;
  try {
    await bandeNeuve(page, nom);
    await page.goto("/aujourdhui", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /poser ma joie/i }).click();
    await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

    const photo = page.getByText("Photo", { exact: true });
    const galerie = page.getByText("Galerie", { exact: true });
    await expect(photo).toBeVisible();
    await expect(galerie).toBeVisible();

    // La caméra est lue en premier : dans un journal, on photographie sa
    // journée bien plus souvent qu'on ne retrouve une image d'hier.
    const gauche = (await photo.boundingBox())!;
    const droite = (await galerie.boundingBox())!;
    expect(gauche.x).toBeLessThan(droite.x);

    // Des pavés, pas des lignes de texte : 52 px de haut, largeurs égales.
    const pave = page.locator('label:has(input[capture])');
    const boite = (await pave.boundingBox())!;
    expect(boite.height).toBeGreaterThanOrEqual(50);
    const autre = (await page.locator('label:has(input[multiple])').boundingBox())!;
    expect(Math.abs(boite.width - autre.width)).toBeLessThan(2);

    // Une fois un média posé, les pavés se rétractent : la bande de vignettes
    // devient le sujet de l'écran.
    await page.setInputFiles('input[type="file"][multiple]', {
      name: "essai.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(page.locator('img[src^="/api/vignette/"]').first()).toBeVisible({
      timeout: 20_000,
    });
    const apres = (await page.locator('label:has(input[capture])').boundingBox())!;
    expect(apres.height).toBeLessThan(50);
    // Mais les deux commandes restent atteignables.
    await expect(page.getByText("Photo", { exact: true })).toBeVisible();
    await expect(page.getByText("Galerie", { exact: true })).toBeVisible();
  } finally {
    await quitter(page, nom);
  }
});

test("« Sceller quelque chose » est un vrai bouton, et sa feuille s'ouvre sur place", async ({
  page,
}) => {
  test.slow();
  const nom = `Sceller ${Date.now().toString(36)}`;
  try {
    await bandeNeuve(page, nom);
    await page.goto("/aujourdhui", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /poser ma joie/i }).click();
    await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

    // Pleine largeur, et pas un lien souligné de treize pixels.
    const bouton = page.getByRole("button", { name: /Sceller quelque chose/ });
    await expect(bouton).toBeVisible();
    const boite = (await bouton.boundingBox())!;
    expect(boite.height).toBeGreaterThanOrEqual(44);
    // Pleine largeur : on compare à la fenêtre, pas à une classe utilitaire —
    // un sélecteur sur un nom de classe casse au premier changement de style.
    const fenetre = page.viewportSize()!;
    expect(boite.width).toBeGreaterThan(fenetre.width * 0.6);

    // La feuille s'ouvre SUR PLACE : quitter l'écran pour sceller, c'est
    // perdre ce qu'on était en train d'écrire.
    const avant = page.url();
    await bouton.click();
    await expect(page.getByRole("dialog", { name: "Sceller quelque chose" })).toBeVisible();
    expect(page.url()).toBe(avant);

    // Les quatre types sont proposés d'emblée.
    for (const type of ["Un mot", "Une photo", "Une vidéo", "Une voix"]) {
      await expect(page.getByRole("button", { name: new RegExp(type) })).toBeVisible();
    }

    // Choisir un type mène au formulaire, avec le type DÉJÀ coché : le
    // redemander ferait de la feuille un écran de plus, pas un raccourci.
    // Le bouton du choix porte le type ET son explication ; celui du
    // formulaire porte le type seul. D'où le motif ici et l'exact plus bas.
    await page.getByRole("button", { name: /^Un mot/ }).click();
    await expect(page.getByRole("button", { name: "Sceller", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Un mot", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Et on renonce par « Annuler ». Le voile ferme aussi, mais on le touche
    // en haut de l'écran : son centre est sous la feuille.
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await bouton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Fermer" }).click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await quitter(page, nom);
  }
});

test("le pouls : deux curseurs, une courbe, et aucun point d'app", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/aujourdhui", { waitUntil: "networkidle" });

  // La bulle « La bande » a laissé la place au pouls.
  await expect(page.getByText("Le pouls")).toBeVisible();
  await expect(page.getByText(/ne rapporte aucun point/)).toBeVisible();

  // Deux curseurs, et le bouton dit ce qu'il fait.
  await expect(page.locator("#pouls-rire")).toBeVisible();
  await expect(page.locator("#pouls-énergie")).toBeVisible();

  // Le graphique : deux onglets, pas six courbes empilées.
  const onglets = page.getByRole("tab");
  await expect(onglets).toHaveCount(2);
  await expect(page.getByRole("img", { name: /Évolution du rire/ })).toBeVisible();
  await page.getByRole("tab", { name: "Énergie" }).click();
  await expect(page.getByRole("img", { name: /Évolution de l'énergie/ })).toBeVisible();

  // La valeur au tap, jamais au survol : on est sur un téléphone.
  await expect(page.getByText("Touche un point pour lire sa valeur.")).toBeVisible();
  // Le premier cercle du GRAPHIQUE, pas le premier de la page : l'icône de
  // l'appareil photo en contient un aussi.
  await page
    .getByRole("img", { name: /Évolution/ })
    .locator("circle")
    .first()
    .click({ force: true });
  await expect(page.getByText(/·.*·/)).toBeVisible();

  // Et poser un pouls marche.
  await page.locator("#pouls-rire").fill("9");
  await page.getByRole("button", { name: "Poser un pouls" }).click();
  await expect(page.getByRole("button", { name: "Posé ✓" })).toBeVisible();
});

test("sans aucun pouls du jour, le graphique bascule sur sept jours", async ({ page }) => {
  test.slow();
  const nom = `Vide ${Date.now().toString(36)}`;
  try {
    await bandeNeuve(page, nom);
    await page.goto("/aujourdhui", { waitUntil: "networkidle" });
    // Jamais d'écran vide : c'est le cas normal des premières semaines.
    await expect(page.getByRole("button", { name: "aujourd'hui" })).toBeVisible();
    await expect(page.getByText(/Pas encore de pouls cette semaine/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ça a cassé" })).toHaveCount(0);
  } finally {
    await quitter(page, nom);
  }
});
