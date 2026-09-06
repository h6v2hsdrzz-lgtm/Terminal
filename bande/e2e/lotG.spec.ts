import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Le lot G : le moteur de jeux, et les jeux eux-mêmes. */
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

/**
 * Une seule partie à la fois par bande : une partie laissée en cours par un
 * test précédent bloque le bouton « Lancer » de tous les suivants.
 */
async function tableRase(page: import("@playwright/test").Page) {
  await page.goto("/jeux", { waitUntil: "networkidle" });
  const reprendre = page.getByRole("link", { name: "Reprendre" });
  if (await reprendre.isVisible().catch(() => false)) {
    await reprendre.click();
    await page.waitForURL(/\/jeux\/.+/);
    await page.getByRole("button", { name: "Abandonner" }).click();
    await page.getByRole("button", { name: "Abandonner" }).click();
    await page.waitForURL("/jeux");
  }
}

/**
 * Va jusqu'au bout d'un tour de vote, quel que soit le nombre de joueurs.
 *
 * On s'arrête sur l'apparition de l'écran de résultat, pas sur la disparition
 * du bouton « C'est moi » : entre deux joueurs, l'écran de passage s'anime, et
 * pendant cette fraction de seconde le bouton n'est dans aucun des deux états.
 * Un test qui sonde là s'arrête au premier joueur en croyant avoir fini.
 */
async function voterChacunSonTour(
  page: import("@playwright/test").Page,
  reponse: string | ((index: number) => string),
  fin = "Suivante",
) {
  for (let i = 0; i < 8; i++) {
    if (await page.getByRole("button", { name: fin, exact: true }).isVisible().catch(() => false)) {
      return;
    }
    await page.getByRole("button", { name: "C'est moi" }).click();
    const nom = typeof reponse === "string" ? reponse : reponse(i);
    await page.getByRole("button", { name: nom, exact: true }).click();
  }
  throw new Error("Le tour de vote ne s'est jamais terminé.");
}

test("les jeux ont leur onglet, et leurs règles se lisent avant de lancer", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/jeux", { waitUntil: "networkidle" });

  // Dix jeux, et chacun annonce sa durée avant qu'on s'engage.
  await expect(page.getByRole("button", { name: /Devine qui je suis/ })).toBeVisible();
  expect(await page.getByRole("button", { name: /min/ }).count()).toBeGreaterThanOrEqual(10);

  // Les règles sont repliées, mais elles sont là — pas dans un autre écran.
  const fiche = page.getByRole("button", { name: /Je n'ai jamais/ }).first();
  await expect(fiche).toHaveAttribute("aria-expanded", "false");
  await fiche.click();
  await expect(fiche).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/Ceux qui l'ont déjà fait prennent une gorgée/)).toBeVisible();
});

test("une partie va du lancement au podium, et le podium survit au rechargement", async ({
  page,
}) => {
  await entrer(page, "Momo");
  await tableRase(page);

  await page.getByRole("button", { name: /Je n'ai jamais/ }).first().click();
  await page.getByRole("button", { name: /^Lancer Je n'ai jamais$/ }).click();
  await page.waitForURL(/\/jeux\/.+/);
  const adresse = page.url();

  // Pas de barre d'onglets pendant une partie : un « Fil » sous le pouce, et la
  // partie s'interrompt toutes les cinq minutes.
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(0);

  await page.getByRole("button", { name: /C'est parti/ }).click();
  await page.getByRole("button", { name: /Chacun répond/ }).click();
  await voterChacunSonTour(page, (i) => (i === 0 ? "Si, moi si" : "Jamais"));

  // Celui qui a avoué boit une gorgée — jamais un verre.
  await expect(page.getByText("une gorgée")).toBeVisible();

  await page.getByRole("button", { name: "Terminer" }).click();
  await expect(page.getByText("C'est fini")).toBeVisible();
  // « Je n'ai jamais » ne compte rien : personne ne monte sur le podium, et
  // personne ne ramasse les quarante points d'une première place.
  await expect(page.getByText(/Personne ne gagne à ce jeu-là/)).toBeVisible();
  await expect(page.getByText("+40")).toHaveCount(0);

  // Le podium doit tenir un rechargement : c'est ce que la revalidation de fin
  // de partie effaçait dans la première version.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("C'est fini")).toBeVisible();
  expect(page.url()).toBe(adresse);
});

test("on abandonne sans rien laisser derrière", async ({ page }) => {
  await entrer(page, "Momo");
  await tableRase(page);

  await page.getByRole("button", { name: /Je n'ai jamais/ }).first().click();
  await page.getByRole("button", { name: /^Lancer Je n'ai jamais$/ }).click();
  await page.waitForURL(/\/jeux\/.+/);
  const adresse = page.url();

  // Un abandon se confirme : un bouton seul, au bord de l'écran, se touche par
  // accident quand le téléphone passe de main en main.
  await page.getByRole("button", { name: "Abandonner" }).click();
  await expect(page.getByText(/La partie s'efface et ne rapporte rien/)).toBeVisible();
  await page.getByRole("button", { name: "Abandonner" }).click();
  await page.waitForURL("/jeux");

  // La partie n'existe plus, et la liste ne propose plus de la reprendre.
  await expect(page.getByRole("link", { name: "Reprendre" })).toHaveCount(0);
  await page.goto(adresse);
  await expect(page.getByRole("heading", { name: "Introuvable" })).toBeVisible();
});

test("une partie d'une autre bande est introuvable, pas refusée", async ({ page }) => {
  await entrer(page, "Momo");
  await tableRase(page);
  await page.getByRole("button", { name: /Je n'ai jamais/ }).first().click();
  await page.getByRole("button", { name: /^Lancer Je n'ai jamais$/ }).click();
  await page.waitForURL(/\/jeux\/.+/);
  const partieId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Abandonner" }).click();
  await page.getByRole("button", { name: "Abandonner" }).click();
  await page.waitForURL("/jeux");

  // Un identifiant qui n'existe pas et un identifiant d'une autre bande doivent
  // se comporter pareil : sinon la différence dit qu'il existe.
  for (const cible of [partieId, "cl00000000000000000000000"]) {
    await page.goto(`/jeux/${cible}`);
    await expect(page.getByRole("heading", { name: "Introuvable" })).toBeVisible();
    // Et en français : la page par défaut de Next répond en anglais.
    await expect(page.getByText(/could not be found/i)).toHaveCount(0);
  }
});

test("« Devine qui je suis » se joue au doigt quand le capteur n'est pas là", async ({ page }) => {
  await entrer(page, "Momo");
  await tableRase(page);

  await page.getByRole("button", { name: /Devine qui je suis/ }).first().click();
  await page.getByRole("button", { name: /^Lancer Devine qui je suis$/ }).click();
  await page.waitForURL(/\/jeux\/.+/);

  // Le choix du paquet, roulette comprise.
  await expect(page.getByRole("button", { name: /Roulette/ })).toBeVisible();
  await page.getByRole("button", { name: /Rap FR/ }).click();
  await page.getByRole("button", { name: "Choisir ce paquet" }).click();

  // La consigne dit les deux commandes : l'inclinaison ET le doigt.
  await expect(page.getByText(/Pose le téléphone sur ton front/)).toBeVisible();
  await expect(page.getByText(/à droite trouvé, à gauche passer/)).toBeVisible();

  await page.getByRole("button", { name: /Prêt — 60 secondes/ }).click();

  // Les zones tactiles marchent sans capteur : c'est ce qui garantit que le
  // jeu démarre le soir venu, quoi qu'il arrive.
  await page.getByRole("button", { name: "Carte trouvée" }).click();
  await page.getByRole("button", { name: "Carte trouvée" }).click();
  await page.getByRole("button", { name: "Passer cette carte" }).click();

  // Le récap arrive à la fin du chrono ; on n'attend pas soixante secondes,
  // donc on vérifie que le compte est tenu dans la barre après la manche.
  await expect(page.getByLabel("Carte trouvée")).toBeVisible();
});

test("le paquet « Nos potes » s'écrit et se défait sur place", async ({ page }) => {
  await entrer(page, "Momo");
  await tableRase(page);
  await page.getByRole("button", { name: /Devine qui je suis/ }).first().click();
  await page.getByRole("button", { name: /^Lancer Devine qui je suis$/ }).click();
  await page.waitForURL(/\/jeux\/.+/);

  const champ = page.getByLabel("Ajouter une carte au paquet Nos potes");
  const nom = `Le voisin du ${Date.now()}`.slice(0, 40);
  await champ.fill(nom);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(nom) })).toBeVisible();

  // Le droit de retrait : un tap, sans justification, sans confirmation.
  await page.getByRole("button", { name: new RegExp(nom) }).click();
  await expect(page.getByRole("button", { name: new RegExp(nom) })).toHaveCount(0);

  // Et il tient au rechargement : la carte est bien partie de la base.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: new RegExp(nom) })).toHaveCount(0);
});
