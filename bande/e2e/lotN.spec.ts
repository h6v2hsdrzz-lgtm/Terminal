import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le lot N : une partie sur trois téléphones.
 *
 * Ces tests ouvrent **deux contextes de navigateur**, c'est-à-dire deux
 * sessions, c'est-à-dire deux téléphones. C'est la seule façon d'éprouver ce
 * lot : un salon qui marche sur un onglet ne prouve rien, tout l'intérêt est
 * que le deuxième écran voie le premier bouger.
 */
/**
 * Un deuxième téléphone.
 *
 * `browser.newContext()` n'hérite **rien** de la configuration : ni l'adresse
 * de base, ni le gabarit, ni le fuseau. Un `page.goto("/jeux")` dans un
 * contexte nu part donc vers nulle part, et le test attend soixante secondes
 * sans rien dire. D'où ces options recopiées ici, explicitement.
 */
async function nouveauTelephone(navigateur: Browser): Promise<Page> {
  const contexte = await navigateur.newContext({
    ...devices["iPhone 15"],
    baseURL: process.env.ADRESSE ?? "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });
  return contexte.newPage();
}

function codeDe(pseudo: string): string {
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const ligne = fiche.split("\n").find((l) => l.startsWith(pseudo));
  if (!ligne) throw new Error(`Pas de code pour ${pseudo} — lance « npm run db:seed ».`);
  return ligne.split(/\s+/)[1];
}

async function entrer(page: Page, pseudo: string) {
  await page.goto("/reprendre");
  await page.fill("#reprise", codeDe(pseudo));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
}

/** Ouvre un salon sur « Je n'ai jamais » et rend le code à quatre chiffres. */
async function ouvrirSalon(page: Page): Promise<string> {
  await page.goto("/jeux");
  await page.getByRole("button", { name: /Je n'ai jamais/i }).first().click();
  await page.getByRole("button", { name: /chacun son téléphone/i }).click();
  await page.waitForURL(/\/jeux\/[a-z0-9]+/);
  await expect(page.getByText("Le code à dicter")).toBeVisible();
  const code = await page.locator(".chiffres").first().innerText();
  expect(code).toMatch(/^[1-9]\d{3}$/);
  return code;
}

/**
 * Taper le code et entrer.
 *
 * On vérifie que la valeur a bien PRIS avant de cliquer : un remplissage
 * arrivé avant l'hydratation s'écrit dans le DOM sans que React le voie, et le
 * bouton reste désactivé pour toujours. Un humain met plus d'une seconde à
 * taper quatre chiffres, un test non.
 */
async function rejoindreParCode(page: Page, code: string) {
  const champ = page.locator("#code-partie");
  const entrer = page.getByRole("button", { name: /entrer/i });
  await expect(champ).toBeVisible();

  // On retape tant que le bouton ne s'allume pas : le bouton suit l'ÉTAT
  // React, et c'est le seul témoin fiable que la saisie a été vue. Vérifier la
  // valeur du champ ne suffit pas — elle est dans le DOM avant l'hydratation,
  // et l'hydratation la remet à zéro juste après.
  await expect
    .poll(
      async () => {
        await champ.fill(code);
        return entrer.isEnabled();
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await entrer.click();
  await page.waitForURL(/\/jeux\/[a-z0-9]+/);
}

test("un salon s'ouvre, un deuxième téléphone le rejoint par le code", async ({ browser }) => {
  const pageHote = await nouveauTelephone(browser);
  const pageInvite = await nouveauTelephone(browser);

  await entrer(pageHote, "Momo");
  await entrer(pageInvite, "Sam");

  const code = await ouvrirSalon(pageHote);

  // L'invité voit le bandeau sur son accueil — sans avoir rien demandé.
  await pageInvite.reload();
  await expect(pageInvite.getByRole("button", { name: /lance Je n'ai jamais/i })).toBeVisible();

  // Mais on éprouve le chemin de secours, celui du code dicté à voix haute.
  await pageInvite.goto("/jeux");
  await rejoindreParCode(pageInvite, code);

  // Et l'écran de l'hôte l'apprend tout seul, par le flux : personne ne
  // rafraîchit rien.
  await expect(pageHote.getByText("Sam", { exact: false }).first()).toBeVisible({
    timeout: 15000,
  });
  await expect(pageHote.getByRole("button", { name: /lancer la partie/i })).toBeEnabled();

  // L'invité, lui, n'a pas le droit de lancer : ce n'est pas son salon.
  await expect(pageInvite.getByRole("button", { name: /lancer la partie/i })).toHaveCount(0);
  await expect(pageInvite.getByText(/lance quand tout le monde est là/i)).toBeVisible();
});

test("l'hôte lance, et les deux écrans basculent ensemble", async ({ browser }) => {
  const pageHote = await nouveauTelephone(browser);
  const pageInvite = await nouveauTelephone(browser);

  await entrer(pageHote, "Momo");
  await entrer(pageInvite, "Sam");
  const code = await ouvrirSalon(pageHote);

  await pageInvite.goto("/jeux");
  await rejoindreParCode(pageInvite, code);
  await expect(pageHote.getByText("Sam", { exact: false }).first()).toBeVisible({
    timeout: 15000,
  });

  await pageHote.getByRole("button", { name: /lancer la partie/i }).click();

  // Le salon disparaît des deux côtés. L'invité n'a touché à rien.
  await expect(pageHote.getByText("Le code à dicter")).toBeHidden({ timeout: 20000 });
  await expect(pageInvite.getByText("Le code à dicter")).toBeHidden({ timeout: 20000 });
});

test("un code inconnu est refusé sans rien casser", async ({ page }) => {
  await entrer(page, "Samy");
  await page.goto("/jeux");
  const champ = page.locator("#code-partie");
  await expect(champ).toBeVisible();
  await champ.fill("1111");
  await expect(champ).toHaveValue("1111");
  await page.getByRole("button", { name: /entrer/i }).click();
  await expect(page.getByRole("alert").first()).toContainText(/aucune partie|expiré/i);
  await expect(page).toHaveURL(/\/jeux$/);
});
