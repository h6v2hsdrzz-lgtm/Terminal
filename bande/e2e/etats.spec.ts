import { expect, test, type Page } from "@playwright/test";

/**
 * L'audit visuel du plan : **chaque état**, pas seulement chaque écran.
 *
 * Les captures de `captures.spec.ts` montrent l'application pleine, avec quatre
 * cents jours d'historique. Ce sont les états qu'on ne regarde jamais qui
 * cassent : une bande neuve où tout est vide, une page qui n'existe pas, une
 * partie qu'on vient de finir. Ils ont chacun leur capture ici.
 *
 * La bande est créée pour l'occasion et repart à la fin, donc ce fichier ne
 * dépend d'aucune base peuplée.
 */
async function bandeNeuve(page: Page, nom: string) {
  await page.goto("/bienvenue/creer");
  await page.fill("#bande", nom);
  await page.fill("#pseudo", "Seul");
  await page.getByRole("button", { name: /créer/i }).click();
  await page.waitForURL(/\/bienvenue\/code/);
  await page.getByRole("button", { name: /c'est noté/i }).click();
  await page.waitForURL("/");
}

async function quitter(page: Page, nom: string) {
  await page.goto("/reglages", { waitUntil: "domcontentloaded" });
  await page.getByText("Quitter la bande", { exact: true }).click();
  await page.locator("#confirmation").fill(nom);
  await page.getByRole("button", { name: /partir pour de bon/i }).click();
  await page.waitForURL(/\/bienvenue/);
}

const VIDES = [
  { nom: "fil", url: "/" },
  { nom: "aujourdhui", url: "/aujourdhui" },
  { nom: "jeux", url: "/jeux" },
  { nom: "souvenirs", url: "/souvenirs" },
  { nom: "galerie", url: "/galerie" },
  { nom: "profil", url: "/profil" },
];

test("les écrans vides d'une bande qui vient de naître", async ({ page }, infos) => {
  test.slow();
  const nom = `Vide ${Date.now().toString(36)}`;
  try {
    await bandeNeuve(page, nom);
    for (const ecran of VIDES) {
      await page.goto(ecran.url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `captures/${infos.project.name}/vide-${ecran.nom}.png`,
        fullPage: true,
      });
      // Rien ne doit déborder, même sans contenu pour tenir la largeur.
      const debordement = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(debordement, `${ecran.url} déborde`).toBeLessThanOrEqual(1);
      // Et aucun écran vide ne doit être un écran cassé.
      await expect(page.getByRole("heading", { name: "Ça a cassé" })).toHaveCount(0);
    }

    // Un titre de section au-dessus de rien : le défaut que seule une capture
    // d'un écran vide fait voir.
    await page.goto("/souvenirs", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Les dernières formes")).toHaveCount(0);

    // Et une bande d'une seule personne doit apprendre POURQUOI elle ne peut
    // rien lancer, sans avoir à déplier une fiche pour le découvrir.
    await page.goto("/jeux", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Il manque du monde")).toBeVisible();
    {
    }
  } finally {
    await quitter(page, nom).catch(() => {});
  }
});

test("la page qui n'existe pas", async ({ page }, infos) => {
  await page.goto("/une-adresse-qui-n-existe-pas");
  await expect(page.getByRole("heading", { name: "Introuvable" })).toBeVisible();
  await page.screenshot({ path: `captures/${infos.project.name}/etat-introuvable.png` });
});

test("le portail, avant toute session", async ({ page }, infos) => {
  await page.goto("/bienvenue", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `captures/${infos.project.name}/etat-bienvenue.png`, fullPage: true });
  await page.goto("/reprendre", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `captures/${infos.project.name}/etat-reprendre.png`, fullPage: true });
  // Un code refusé : l'état d'erreur, celui qu'on ne regarde jamais.
  //
  // On cherche le TEXTE, pas `role="alert"` : Next pose son propre annonceur
  // de route avec ce rôle, vide, sur chaque page. Le piège a déjà coûté une
  // demi-heure une fois.
  await page.fill("#reprise", "AAAA-BBBB-CCCC");
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await expect(page.getByText(/ne correspond à rien|pas la bonne forme/)).toBeVisible();
  await page.screenshot({ path: `captures/${infos.project.name}/etat-code-refuse.png` });
});
