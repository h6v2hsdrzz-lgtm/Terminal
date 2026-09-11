import { expect, test, type Page } from "@playwright/test";

import { entrer } from "./aide-jeux";
import { TYPES } from "../src/lib/pousse/types";

/**
 * Le lot Q : l'écran de réglages.
 *
 * Trois choses s'y règlent et une s'y fait. Les notifications par type, qui
 * vivent **en base** parce qu'elles suivent la personne ; le thème, qui vit dans
 * **le navigateur** parce qu'il suit l'appareil ; et la déconnexion, qui est le
 * geste le plus banal d'une application et le plus dangereux de celle-ci.
 *
 * Le WebKit de Playwright n'a **ni `PushManager` ni `Notification`** — mesuré,
 * pas supposé. On ne peut donc pas éprouver un abonnement ici ; en revanche on
 * peut éprouver exactement ce qu'un appareil sans pousse doit voir, et c'est
 * d'ailleurs le cas d'un iPhone tant que l'application n'est pas sur l'écran
 * d'accueil. Le chiffrement et l'envoi, eux, se vérifient en Vitest
 * (`src/lib/pousse/*.test.ts`) contre les intermédiaires publiés du RFC 8291.
 */
/**
 * Le bloc des notifications, et rien d'autre.
 *
 * L'écran de réglages porte d'autres cases à cocher — « révéler après avoir
 * posé » en a une. Compter les cases de la page entière faisait dire au test
 * qu'il y avait sept types de notification.
 */
function bloc(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /les notifications/i }) });
}

/** La case d'une ligne de réglage, trouvée par son libellé. */
function ligne(page: Page, libelle: string | RegExp) {
  return bloc(page).locator("label").filter({ hasText: libelle }).getByRole("checkbox");
}

test("les six types de notification sont là, et les réactions sont coupées par défaut", async ({
  page,
}) => {
  await entrer(page, "Momo");
  await page.goto("/reglages");

  await expect(page.getByRole("heading", { name: /les notifications/i })).toBeVisible();

  // Un type sans case à cocher est un type qu'on ne peut pas refuser.
  await expect(bloc(page).getByRole("checkbox")).toHaveCount(TYPES.length);

  // Le défaut a un avis : tout sauf les petits cœurs.
  await expect(ligne(page, /les réactions/i)).not.toBeChecked();
  await expect(ligne(page, /quelqu'un pose sa journée/i)).toBeChecked();
  await expect(ligne(page, /les commentaires/i)).toBeChecked();
});

test("couper un type tient après un rechargement", async ({ page }) => {
  await entrer(page, "Sam");
  await page.goto("/reglages");

  const commentaires = ligne(page, /les commentaires/i);
  const reactions = ligne(page, /les réactions/i);

  await expect(commentaires).toBeChecked();
  await commentaires.click();
  await expect(commentaires).not.toBeChecked();

  // Et dans l'autre sens, sur une case qui part éteinte.
  await reactions.click();
  await expect(reactions).toBeChecked();

  // Le seul témoin qui compte : la base. Un état React qui survit à un clic ne
  // prouve rien du tout.
  await page.reload();
  await expect(ligne(page, /les commentaires/i)).not.toBeChecked();
  await expect(ligne(page, /les réactions/i)).toBeChecked();

  // Remettre comme avant : un test qui laisse les réglages de Sam à l'envers
  // fait rougir le suivant.
  await ligne(page, /les commentaires/i).click();
  await ligne(page, /les réactions/i).click();
  await expect(ligne(page, /les commentaires/i)).toBeChecked();
  await page.reload();
  await expect(ligne(page, /les réactions/i)).not.toBeChecked();
});

test("un appareil sans pousse le dit, au lieu de tourner dans le vide", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/reglages");

  await bloc(page).getByRole("button", { name: /me prévenir/i }).click();

  // Mesuré : ce WebKit n'a pas `PushManager`. C'est le chemin que prend aussi
  // un iPhone qui n'a pas encore ajouté l'application à son écran d'accueil,
  // et c'est exactement ce qu'il faut lui dire.
  // `role="alert"` existe aussi ailleurs : Next.js en pose un, invisible, pour
  // annoncer les changements de route aux lecteurs d'écran. D'où le bloc.
  const message = bloc(page).getByRole("alert");
  await expect(message).toContainText(/ne sait pas recevoir/i);
  await expect(message).toContainText(/écran d'accueil/i);
});

test("le thème forcé tient d'un écran à l'autre, posé avant le premier pixel", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/reglages");

  const sombre = page.getByRole("button", { name: /toujours sombre/i });
  await sombre.click();
  await expect(sombre).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/sombre/);

  // La preuve que c'est le script du document qui pose la classe, et pas React :
  // le profil ne monte **aucun** composant de thème. Si la classe y est, elle a
  // été posée avant que React se réveille — donc pas d'éclair blanc à minuit.
  await page.goto("/profil");
  await expect(page.locator("html")).toHaveClass(/sombre/);
  expect(await page.evaluate(() => localStorage.getItem("joie-theme"))).toBe("sombre");

  // Et le retour au choix du téléphone n'oublie pas d'effacer.
  await page.goto("/reglages");
  await page.getByRole("button", { name: /le téléphone décide/i }).click();
  await expect(page.locator("html")).not.toHaveClass(/sombre/);
  expect(await page.evaluate(() => localStorage.getItem("joie-theme"))).toBeNull();
});

test("se déconnecter prévient d'abord, et coupe vraiment", async ({ page }) => {
  await entrer(page, "Samy");
  await page.goto("/reglages");

  // L'avertissement fait partie du geste : sans mot de passe, le code de
  // reprise est la seule porte de retour.
  await expect(page.getByText(/code de reprise/i).first()).toBeVisible();

  await page.getByRole("button", { name: /^se déconnecter$/i }).click();
  await page.waitForURL(/\/bienvenue/);

  // Et la session est bien partie : le repaire renvoie dehors.
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue/);
});
