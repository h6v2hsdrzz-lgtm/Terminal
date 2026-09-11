import { expect, test, type Page } from "@playwright/test";

import { aller, entrer, nouveauTelephone } from "./aide-jeux";
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

/**
 * Q2 — rien n'échoue en silence.
 *
 * `context.setOffline(true)` casse `createImageBitmap` dans ce WebKit (leçon du
 * lot K, payée une fois) : on abat donc des requêtes précises avec `page.route`
 * plutôt que le réseau entier. C'est de toute façon plus proche de la vérité —
 * un tunnel coupe une requête sur deux, pas la carte réseau.
 */
test("le bandeau dit qu'on est hors ligne, puis qu'on est revenu", async ({ page }) => {
  await entrer(page, "Momo");

  // Le sondage de synchronisation est le seul témoin du réseau dont dispose
  // l'application : c'est lui qu'on abat.
  await page.route("**/api/version", (route) => route.abort());
  const bandeau = page.getByRole("status").filter({ hasText: /hors ligne/i });
  await expect(bandeau).toBeVisible({ timeout: 15_000 });
  await expect(bandeau).toContainText(/gardé sur ce téléphone/i);

  await page.unroute("**/api/version");
  await expect(page.getByRole("status").filter({ hasText: /de retour en ligne/i })).toBeVisible({
    timeout: 15_000,
  });

  // Et ça se tait tout seul : un bandeau « tout va bien » permanent est du bruit.
  await expect(page.getByRole("status").filter({ hasText: /de retour en ligne/i })).toBeHidden({
    timeout: 15_000,
  });
});

test("une réaction qui ne part pas le dit, et le bouton réessayer marche", async ({ page }) => {
  await entrer(page, "Momo");

  // Abattre les actions serveur, et elles seules : une action de Next est un
  // POST sur l'adresse courante, reconnaissable à son en-tête.
  await page.route("**/*", async (route) => {
    const requete = route.request();
    if (requete.method() === "POST" && requete.headers()["next-action"]) return route.abort();
    return route.fallback();
  });

  await page.getByRole("button", { name: "Ajouter une réaction" }).first().click();
  await page.getByRole("button", { name: "🔥" }).first().click();

  const panne = page.getByRole("alert").filter({ hasText: /n'a pas pu partir/i });
  await expect(panne).toBeVisible({ timeout: 15_000 });
  await expect(panne).toContainText(/ta réaction/i);

  // Le réseau revient. Le bouton refait exactement ce qui avait raté.
  await page.unroute("**/*");
  await panne.getByRole("button", { name: /réessayer/i }).click();
  await expect(panne).toBeHidden({ timeout: 15_000 });
});

/**
 * Q5 — la recherche, et Q3 — l'écran d'une journée.
 *
 * Les deux vont ensemble : chercher ne sert à rien sans un endroit où aller, et
 * c'est le même endroit qu'ouvre une notification.
 */
test("chercher un mot trouve les journées, et le résultat mène au bon jour", async ({ page }) => {
  await entrer(page, "Momo");
  await page.getByRole("link", { name: "Chercher dans le journal" }).click();
  await page.waitForURL("/recherche");

  // Avant de taper, l'écran dit ce qu'il sait faire plutôt que d'afficher zéro.
  await expect(page.getByText(/deux lettres suffisent/i)).toBeVisible();

  await page.fill("#recherche", "pluie");
  const resultats = page.getByRole("listitem");
  await expect(resultats.first()).toBeVisible({ timeout: 15_000 });

  // Le mot cherché est surligné — `<mark>`, donc annoncé par un lecteur
  // d'écran. Un résultat où l'on ne voit pas POURQUOI il est là est un
  // résultat qui a l'air tiré au sort ; c'est le défaut qu'une capture a
  // montré et qu'aucun test n'aurait posé.
  await expect(resultats.first().locator("mark").first()).toContainText(/pluie/i);

  await resultats.first().getByRole("link").click();
  await page.waitForURL(/\/jour\/\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole("link", { name: /le fil/i })).toBeVisible();
});

test("la recherche ignore les accents et veut tous les mots", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/recherche");

  // « journee » sans accent doit trouver « journée » : c'est la moitié de
  // l'intérêt d'une recherche en français.
  await page.fill("#recherche", "journee");
  await expect(page.getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });

  // Deux mots dont un introuvable ne rendent rien : la recherche est un ET.
  await page.fill("#recherche", "journee xyzzyx");
  await expect(page.getByText(/rien pour/i)).toBeVisible({ timeout: 15_000 });
});

test("une journée inexistante ne casse rien", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/jour/1999-01-01");
  await expect(page.getByText(/personne n'a écrit ce jour-là/i)).toBeVisible();
});

/**
 * Le voile, appliqué à la recherche.
 *
 * C'est le test le plus important du lot : une recherche qui traverse le voile
 * annoncerait « il y a le mot “rupture” dans la journée que tu n'as pas encore
 * le droit de lire », et c'est exactement le bit d'information que le voile
 * existe pour retenir.
 *
 * Il crée sa propre bande plutôt que d'emprunter celle de démonstration : le
 * voile dépend de « ai-je posé aujourd'hui », et cet état change à chaque
 * exécution de la suite. Une bande neuve, deux personnes, aucune journée : la
 * situation est la même à chaque fois.
 */
test("la recherche ne traverse pas le voile", async ({ browser }) => {
  test.slow();
  const marque = `zibouline${Date.now().toString(36)}`;
  const nom = `Voile ${Date.now().toString(36)}`;

  const premier = await nouveauTelephone(browser);
  const second = await nouveauTelephone(browser);

  // ── Une bande neuve, et quelqu'un qui la rejoint ──────────────────────────
  await premier.goto("/bienvenue/creer");
  await premier.fill("#bande", nom);
  await premier.fill("#pseudo", "Ecrit");
  await premier.getByRole("button", { name: /créer/i }).click();
  await premier.waitForURL(/\/bienvenue\/code/);
  await premier.getByRole("button", { name: /c'est noté/i }).click();
  await premier.waitForURL("/");

  await aller(premier, "/reglages");
  const invitation = await premier.locator(".chiffres").first().innerText();

  await second.goto("/bienvenue/rejoindre");
  await second.fill("#invitation", invitation.replace(/\s+/g, ""));
  await second.fill("#pseudo", "Cherche");
  await second.getByRole("button", { name: /rejoindre/i }).click();
  await second.waitForURL(/\/bienvenue\/code/);
  await second.getByRole("button", { name: /c'est noté/i }).click();
  await second.waitForURL("/");

  // ── Le premier pose une journée avec un mot qu'on ne trouve nulle part ────
  await aller(premier, "/aujourdhui");
  await premier.fill("#titre", marque);
  await premier.getByRole("button", { name: /poser ma joie du jour/i }).click();
  await expect(premier.getByRole("button", { name: /corriger ta journée/i })).toBeVisible({
    timeout: 15_000,
  });

  // ── Le second n'a rien posé : il ne doit RIEN trouver ─────────────────────
  await aller(second, "/recherche");
  await second.fill("#recherche", marque);
  await expect(second.getByText(/rien pour/i)).toBeVisible({ timeout: 15_000 });

  // ── Il pose la sienne : le voile tombe, la journée apparaît ───────────────
  await aller(second, "/aujourdhui");
  await second.fill("#note", "Posée pour lever le voile.");
  await second.getByRole("button", { name: /poser ma joie du jour/i }).click();
  await expect(second.getByRole("button", { name: /corriger ta journée/i })).toBeVisible({
    timeout: 15_000,
  });

  await aller(second, "/recherche");
  await second.fill("#recherche", marque);
  await expect(second.getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });
  await expect(second.getByRole("listitem").first()).toContainText(marque);

  // ── On remballe : le dernier parti emporte la bande ───────────────────────
  for (const [page, pseudo] of [[premier, "Ecrit"], [second, "Cherche"]] as const) {
    void pseudo;
    await aller(page, "/reglages");
    await page.getByText("Quitter la bande", { exact: true }).click();
    await page.locator("#confirmation").fill(nom);
    await page.getByRole("button", { name: /partir pour de bon/i }).click();
    await page.waitForURL(/\/bienvenue/);
  }
});
