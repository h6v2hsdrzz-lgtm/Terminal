import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le lot F : le lieu.
 *
 * Ce qui est vérifié ici n'est pas « le bouton marche » mais « rien ne sort ».
 * La position exacte du téléphone ne doit jamais quitter notre serveur, et la
 * carte ne doit demander aucune tuile à personne.
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
}

test("la route du lieu exige une session et n'accepte pas n'importe quoi", async ({
  page,
  request,
}) => {
  // Sans session, la route ne dit même pas si le point existe.
  expect((await request.get("/api/lieu?lat=48.86&lon=2.35")).status()).toBe(401);

  await entrer(page, "Momo");
  // Une latitude impossible n'est pas arrondie « au mieux » : elle est refusée.
  expect((await page.request.get("/api/lieu?lat=91&lon=2.35")).status()).toBe(400);
  expect((await page.request.get("/api/lieu?lat=paris&lon=2.35")).status()).toBe(400);
});

test("la position ne ressort jamais plus précise qu'un kilomètre", async ({ page }) => {
  await entrer(page, "Momo");

  // Six décimales entrent — la précision d'un GPS, quelques mètres.
  const reponse = await page.request.get("/api/lieu?lat=48.858370&lon=2.294481");
  expect(reponse.status()).toBe(200);
  const { position } = (await reponse.json()) as {
    nom: string | null;
    position?: { latitude: number; longitude: number };
  };

  // Deux décimales sortent, et c'est cette valeur-là qui sera stockée. Le test
  // tient même si Nominatim est injoignable : l'arrondi est fait AVANT l'appel,
  // donc il ne dépend pas de la réponse du tiers.
  expect(position).toEqual({ latitude: 48.86, longitude: 2.29 });
});

test.describe("avec la géolocalisation autorisée", () => {
  test.use({
    permissions: ["geolocation"],
    geolocation: { latitude: 48.858370, longitude: 2.294481 },
  });

  test("« utiliser ma position » pose une étiquette et garde l'arrondi", async ({ page }) => {
    await entrer(page, "Momo");

    // On répond à la place de Nominatim : la suite du test porte sur le
    // câblage du bouton, pas sur la disponibilité d'un service gratuit.
    let demandee: string | null = null;
    await page.route("**/api/lieu?*", async (route) => {
      demandee = new URL(route.request().url()).search;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nom: "Champ-de-Mars",
          position: { latitude: 48.86, longitude: 2.29 },
        }),
      });
    });

    await page.goto("/aujourdhui", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /utiliser ma position/i }).click();

    // L'étiquette arrive dans le champ, sans que personne n'ait tapé.
    await expect(page.getByRole("button", { name: /Champ-de-Mars retirer/i })).toBeVisible();

    // Le formulaire emporte la position ARRONDIE, celle que le serveur a
    // rendue — pas les six décimales du capteur.
    await expect(page.locator('input[name="lieuPosition"]')).toHaveValue(
      "Champ-de-Mars|48.86|2.29",
    );

    // Et la seule requête partie du téléphone est allée chez nous.
    expect(demandee).toContain("lat=48.85837");
  });
});

test("la constellation des lieux ne demande aucune tuile", async ({ page }) => {
  await entrer(page, "Momo");

  // Un fond de carte, ce sont des dizaines de requêtes vers un serveur tiers,
  // et la liste des tuiles demandées dit où sont vos souvenirs. On compte.
  const sorties: string[] = [];
  page.on("request", (requete) => {
    const hote = new URL(requete.url()).host;
    if (!hote.startsWith("localhost") && !hote.startsWith("127.0.0.1")) sorties.push(requete.url());
  });

  await page.goto("/souvenirs", { waitUntil: "networkidle" });

  const carte = page.getByRole("img", { name: /lieux de la bande/ });
  await expect(carte).toBeVisible();
  // Chez Mamie est à Nantes, le reste à Paris : la constellation doit montrer
  // l'écart, donc placer les points à des endroits différents.
  const points = carte.locator("circle");
  expect(await points.count()).toBeGreaterThanOrEqual(2);

  expect(sorties).toEqual([]);
});
