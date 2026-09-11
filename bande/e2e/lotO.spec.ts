import { devices, expect, test, type Browser } from "@playwright/test";

import { aller, deuxTelephonesEnPartie, entrer, libererLaBande, nouveauTelephone } from "./aide-jeux";

/**
 * Le lot O : les images des cartes, les trois jeux de Marie Janne, et « Le plus
 * rapide » refait.
 */

test.afterAll(async ({ browser }) => {
  // Comme le lot N : on ne laisse pas de partie ouverte au fichier suivant.
  const page = await nouveauTelephone(browser);
  await entrer(page, "Momo");
  await libererLaBande(page);
  await page.context().close();
});
const ADRESSE = process.env.ADRESSE ?? "http://localhost:3000";

/** Une carte dont on sait qu'elle a une photo, et une dont on sait que non. */
const AVEC = "Zinédine Zidane";
const SANS = "Un lundi matin";

test("l'image d'une carte passe par nous, et jamais par le téléphone", async ({ page }) => {
  await entrer(page, "Momo");

  // Ce qu'on sait de la carte avant de l'afficher : la forme, et le crédit.
  const infos = await page.request.get(`/api/carte/${encodeURIComponent(AVEC)}/infos`);
  expect(infos.status()).toBe(200);
  const donnees = (await infos.json()) as {
    largeur: number;
    hauteur: number;
    auteur: string;
    licence: string;
  };
  expect(donnees.largeur).toBeGreaterThan(200);
  expect(donnees.hauteur).toBeGreaterThan(200);
  // On crédite : c'est la contrepartie d'une image libre, et elle n'est pas
  // négociable.
  expect((donnees.auteur + donnees.licence).length).toBeGreaterThan(0);

  // Et l'image elle-même, servie par notre route — l'adresse Wikimedia ne
  // descend jamais dans le navigateur de la bande.
  const image = await page.request.get(`/api/carte/${encodeURIComponent(AVEC)}`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toMatch(/^image\//);
  expect((await image.body()).byteLength).toBeGreaterThan(2000);
});

test("une carte sans photo se joue en texte, sans rien casser", async ({ page }) => {
  await entrer(page, "Momo");
  // 404 et pas 500 : la moitié des cartes n'a pas d'illustration libre, et
  // « Un lundi matin » n'en aura jamais. L'écran retombe sur le nom en grand.
  const infos = await page.request.get(`/api/carte/${encodeURIComponent(SANS)}/infos`);
  expect(infos.status()).toBe(404);
  const image = await page.request.get(`/api/carte/${encodeURIComponent(SANS)}`);
  expect(image.status()).toBe(404);
});

test("sans session, aucune image de carte ne sort", async ({ browser }: { browser: Browser }) => {
  // Un contexte nu : pas de cookie, donc personne. Les routes de médias de la
  // bande répondent 401, et celle-ci ne fait pas exception — même si l'image
  // vient de Wikipédia, savoir CE QUI est joué n'appartient qu'à la bande.
  const contexte = await browser.newContext({ ...devices["iPhone 15"] });
  for (const chemin of [
    `/api/carte/${encodeURIComponent(AVEC)}`,
    `/api/carte/${encodeURIComponent(AVEC)}/infos`,
  ]) {
    const reponse = await contexte.request.get(`${ADRESSE}${chemin}`);
    expect(reponse.status()).toBe(401);
  }
  await contexte.close();
});

test("la route ne sert que les cartes qu'elle connaît, jamais une adresse", async ({ page }) => {
  await entrer(page, "Momo");
  // Le relais ouvert, c'est ça qu'on n'a pas voulu : une route qui accepterait
  // une adresse ferait partir des requêtes depuis notre serveur vers n'importe
  // où. Elle prend une carte, et une carte inconnue n'existe pas.
  const reponse = await page.request.get(
    `/api/carte/${encodeURIComponent("https://example.invalid/pixel.png")}`,
  );
  expect(reponse.status()).toBe(404);
});

/**
 * « Le mot de passe » : le jeu qui tourne pendant les autres.
 *
 * Deux choses à prouver, et la seconde est la plus importante : chacun ne voit
 * que SON mot, et le jeu **ne bloque pas** le lancement d'une autre partie.
 * S'il bloquait, il interdirait de jouer pendant trois heures — c'est-à-dire
 * exactement le contraire de ce qu'il est.
 */
test("« Le mot de passe » donne un mot à chacun et laisse jouer à autre chose", async ({
  browser,
}) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Le mot de passe/i);

  await expect(hote.getByText("Ton mot")).toBeVisible({ timeout: 25_000 });
  await expect(invite.getByText("Ton mot")).toBeVisible({ timeout: 15_000 });

  const motHote = (await hote.locator("p.text-\\[40px\\]").first().innerText()).trim();
  const motInvite = (await invite.locator("p.text-\\[40px\\]").first().innerText()).trim();
  expect(motHote.length).toBeGreaterThan(3);
  expect(motHote).not.toBe(motInvite);

  // Et l'écran de l'un ne montre nulle part le mot de l'autre.
  await expect(hote.getByText(motInvite, { exact: true })).toHaveCount(0);

  // Le voilà en arrière-plan : la liste des jeux le range à part, et les fiches
  // des autres jeux restent lançables.
  await aller(hote, "/jeux");
  await expect(hote.getByText("En arrière-plan")).toBeVisible();
  await hote.getByRole("button", { name: /Je n'ai jamais/i }).first().click();
  await expect(hote.getByRole("button", { name: /chacun son téléphone/i })).toBeEnabled();
});

/**
 * L'accusation : juste, elle marque ; à côté, elle coûte.
 *
 * Le test triche — il lit le mot de l'hôte sur l'écran de l'hôte, ce qu'aucun
 * joueur ne peut faire. C'est le seul moyen d'éprouver le dépouillement de bout
 * en bout ; la règle elle-même se vérifie en Vitest, où l'on peut poser les
 * trois mots à la main.
 */
test("dans « Le mot de passe », griller le bon mot se voit sur les deux écrans", async ({
  browser,
}) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Le mot de passe/i);
  await expect(hote.getByText("Ton mot")).toBeVisible({ timeout: 25_000 });

  const motHote = (await hote.locator("p.text-\\[40px\\]").first().innerText()).trim();
  const nomHote = await invite
    .getByRole("button", { name: /^(Momo|Sam|Samy|Lou)$/ })
    .first()
    .innerText();

  await invite.getByRole("button", { name: nomHote, exact: true }).click();
  await invite.getByPlaceholder("Le mot que tu as entendu").fill(motHote);
  await invite.getByRole("button", { name: /^je te grille$/i }).click();
  await expect(invite.getByText(/accusation envoyée/i)).toBeVisible({ timeout: 15_000 });

  // On attend que l'accusation soit ARRIVÉE chez l'hôte avant qu'il retourne
  // les cartes : c'est son état à lui qui sert au dépouillement, et le flux met
  // quelques centaines de millisecondes. Sans cette attente, le verdict annonce
  // « personne n'a rien vu venir » une fois sur trois.
  await expect(hote.getByText(/1 sur 2 a accusé/)).toBeVisible({ timeout: 15_000 });

  // L'hôte retourne les cartes : le jeu n'a pas de fin mécanique, c'est lui qui
  // décide. Le verdict nomme qui a grillé qui, des deux côtés.
  await hote.getByRole("button", { name: /retourner les cartes/i }).click();
  await expect(hote.getByText(/a grillé/i)).toBeVisible({ timeout: 20_000 });
  await expect(invite.getByText(/a grillé/i)).toBeVisible({ timeout: 20_000 });
});

/**
 * « La théorie du complot » : deux choses sans rapport, et un micro.
 *
 * Le WebKit de Playwright n'a pas `MediaRecorder` — c'est écrit dans
 * `CLAUDE.md`, et ça vaut ici : on ne peut pas éprouver l'enregistrement.
 * Ce qui se vérifie, et qui est déjà beaucoup : les deux écrans ne montrent pas
 * la même chose, l'énoncé relie bien deux mondes, et celui qui écoute sait
 * combien de temps l'autre a.
 */
test("dans « La théorie du complot », l'écran de celui qui parle n'est pas celui des autres", async ({
  browser,
}) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /La théorie du complot/i);

  const plaide = hote.getByText(/plaide$/);
  const plaideInvite = invite.getByText(/plaide$/);
  await expect
    .poll(async () => (await plaide.count()) + (await plaideInvite.count()), { timeout: 25_000 })
    .toBe(1);

  const spectateur = (await plaide.count()) === 1 ? hote : invite;
  const acteur = spectateur === hote ? invite : hote;

  await expect(acteur.getByText(/^Relie .+ et .+\. Quatre-vingt-dix secondes\.$/)).toBeVisible();
  await expect(spectateur.getByText(/a 90 secondes/)).toBeVisible();
});
