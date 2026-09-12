import { expect, test, type Page } from "@playwright/test";
import { codeDe as lireCode, entrer, passerLesNouveautes } from "./aide-jeux";

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
  await passerLesNouveautes(page);
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
  { nom: "recherche", url: "/recherche" },
  { nom: "jour", url: "/jour/1999-01-01" },
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

/**
 * Les états du lot Q, ceux qu'on ne voit que quand ça se passe mal.
 *
 * Ils comptent autant que les écrans pleins : un bandeau mal posé se voit
 * exactement au moment où la personne est déjà contrariée.
 */
test("le réseau qui lâche, et le geste qui ne passe pas", async ({ page }, infos) => {
  test.slow();
  await entrer(page, "Momo");

  // Hors ligne : le sondage de version est le seul témoin dont dispose
  // l'application, c'est donc lui qu'on abat.
  await page.route("**/api/version", (route) => route.abort());
  await expect(page.getByRole("status").filter({ hasText: /hors ligne/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: `captures/${infos.project.name}/etat-hors-ligne.png`,
    clip: { x: 0, y: 0, width: 393, height: 220 },
  });

  // Une action serveur qui n'arrive pas : un POST reconnaissable à son en-tête.
  await page.route("**/*", async (route) => {
    const requete = route.request();
    if (requete.method() === "POST" && requete.headers()["next-action"]) return route.abort();
    return route.fallback();
  });
  await page.getByRole("button", { name: "Ajouter une réaction" }).first().click();
  await page.getByRole("button", { name: "🔥" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: /n'a pas pu partir/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: `captures/${infos.project.name}/etat-panne.png`,
    clip: { x: 0, y: 0, width: 393, height: 220 },
  });
});

test("l'écran qui casse, et celui qui charge", async ({ page }, infos) => {
  test.slow();
  await entrer(page, "Momo");

  // Le squelette de chargement : on retient la réponse du serveur assez
  // longtemps pour le voir. C'est exactement ce qui se passe avec une base à
  // l'autre bout du monde et une barre de métro.
  // Un PRÉDICAT et pas un motif : l'adresse d'une charge React de Next porte
  // `_rsc` mais pas toujours à la même place, et un `**/souvenirs?_rsc=*` rate
  // une fois sur trois — le squelette passe alors trop vite pour être vu.
  const estLaChargeDesSouvenirs = (url: URL) =>
    url.pathname.startsWith("/souvenirs") && url.searchParams.has("_rsc");
  await page.route(estLaChargeDesSouvenirs, async (route) => {
    await new Promise((suite) => setTimeout(suite, 2500));
    await route.fallback();
  });
  await page.getByRole("link", { name: "Souvenirs" }).first().click();
  await expect(page.getByText("Chargement…")).toBeAttached({ timeout: 15_000 });
  await page.screenshot({ path: `captures/${infos.project.name}/etat-chargement.png` });
  await page.unroute(estLaChargeDesSouvenirs);

  // Et ce qui se passe quand la charge d'une navigation n'arrive JAMAIS.
  //
  // On s'attendait à voir `error.tsx`. On voit autre chose, et c'est mieux :
  // Next abandonne la navigation côté client et **recharge la page en entier**,
  // qui aboutit. L'écran d'erreur n'est donc pas atteignable de l'extérieur —
  // il ne sert que quand c'est le rendu lui-même qui casse. C'est une bonne
  // nouvelle, et elle se vérifie plutôt que de se supposer.
  await page.goto("/", { waitUntil: "networkidle" });
  await page.route("**/profil?_rsc=*", (route) => route.abort());
  await page.getByRole("link", { name: "Profil" }).first().click();
  await expect(page).toHaveURL(/\/profil/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /tes points/i }).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("les nouveautés, en plein cadre", async ({ page }, infos) => {
  await page.goto("/reprendre");
  await page.fill("#reprise", lireCode("Momo"));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
  // Pas de `passerLesNouveautes` : c'est elles qu'on photographie.
  const feuille = page.getByRole("dialog", { name: "Les nouveautés" });
  await expect(feuille).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `captures/${infos.project.name}/etat-nouveautes.png` });
});
