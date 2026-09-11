import { devices, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * De quoi jouer à deux téléphones dans un test.
 *
 * Ces fonctions ouvrent **deux contextes de navigateur**, c'est-à-dire deux
 * sessions, c'est-à-dire deux téléphones. C'est la seule façon d'éprouver le
 * multi : un salon qui marche sur un onglet ne prouve rien, tout l'intérêt est
 * que le deuxième écran voie le premier bouger.
 *
 * Elles vivent à part parce que deux fichiers de tests s'en servent — le lot N
 * pour le moteur, le lot O pour les jeux qu'il a ajoutés — et qu'une copie de
 * `libererLaBande` sur deux ne se corrige jamais.
 */
/**
 * Un deuxième téléphone.
 *
 * `browser.newContext()` n'hérite **rien** de la configuration : ni l'adresse
 * de base, ni le gabarit, ni le fuseau. Un `page.goto("/jeux")` dans un
 * contexte nu part donc vers nulle part, et le test attend soixante secondes
 * sans rien dire. D'où ces options recopiées ici, explicitement.
 */
export async function nouveauTelephone(navigateur: Browser): Promise<Page> {
  const contexte = await navigateur.newContext({
    ...devices["iPhone 15"],
    baseURL: process.env.ADRESSE ?? "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });
  return contexte.newPage();
}

/**
 * Aller quelque part, même si une navigation est encore en vol.
 *
 * L'entrée dans l'application finit par une redirection côté client. Le titre du
 * fil apparaît avant qu'elle soit rangée, et un `goto` lancé à cet instant se
 * fait annuler par Playwright — « interrupted by another navigation ». Une seule
 * reprise suffit : ce n'est pas un problème de réseau, c'est un croisement, et
 * il a rendu un test sur neuf instable une fois sur trois.
 */
export async function aller(page: Page, adresse: string) {
  try {
    await page.goto(adresse);
  } catch (erreur) {
    if (!/interrupted by another navigation/.test(String(erreur))) throw erreur;
    await page.goto(adresse);
  }
}

export function codeDe(pseudo: string): string {
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const ligne = fiche.split("\n").find((l) => l.startsWith(pseudo));
  if (!ligne) throw new Error(`Pas de code pour ${pseudo} — lance « npm run db:seed ».`);
  return ligne.split(/\s+/)[1];
}

/**
 * Refermer les nouveautés si elles s'ouvrent.
 *
 * Depuis le lot Q, la première ouverture après une mise à jour affiche cinq
 * écrans en plein cadre — c'est le produit, pas un accident, et un contexte de
 * navigateur neuf n'a jamais rien vu. Sans ce geste, chaque test se cognerait à
 * un voile qui intercepte tous les clics, et la suite entière deviendrait rouge
 * d'un coup.
 *
 * Le test qui éprouve les nouveautés elles-mêmes est dans `lotQ.spec.ts` : on
 * ne les fait pas disparaître partout sans les regarder quelque part.
 */
export async function passerLesNouveautes(page: Page) {
  const feuille = page.getByRole("dialog", { name: "Les nouveautés" });
  if (!(await feuille.isVisible().catch(() => false))) return;
  await feuille.getByRole("button", { name: /passer|c'est parti/i }).click();
  await expect(feuille).toBeHidden();
}

export async function entrer(page: Page, pseudo: string) {
  await page.goto("/reprendre");
  await page.fill("#reprise", codeDe(pseudo));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
  // Attendre le titre et pas seulement l'adresse : la redirection vers
  // l'accueil peut encore être en vol, et une navigation lancée pendant
  // qu'une autre se termine est annulée par Playwright.
  await expect(page.getByRole("heading", { name: "Le fil" })).toBeVisible();
  await passerLesNouveautes(page);
}

/**
 * Rend la bande disponible.
 *
 * Une partie lancée bloque l'ouverture de la suivante — c'est voulu dans le
 * produit, et c'est du désordre dans une suite de tests : chaque test laisse
 * derrière lui la partie qu'il a commencée. On la termine par l'écran, comme
 * le ferait quelqu'un, plutôt que d'aller bricoler la base.
 *
 * Le piège, payé une fois : `page.goto()` **annule l'action serveur en vol**.
 * Cliquer « Terminer » puis partir aussitôt laisse la partie en cours, la
 * fiche du jeu suivante reste bloquée, et le test d'après meurt quarante
 * secondes plus loin sur un bouton qui n'existe pas. On attend donc le podium.
 */
export async function libererLaBande(page: Page) {
  await aller(page, "/jeux");

  // Deux tours suffisent : une seule partie vit à la fois pour la bande. Le
  // deuxième n'est là que pour vérifier que le premier a bien libéré.
  // Trois tours : il peut y avoir DEUX parties vivantes à la fois depuis le lot
  // O — une normale, et un jeu de fond qui tourne par-dessus.
  for (let essai = 0; essai < 3; essai += 1) {
    // Deux portes d'entrée, parce qu'il y a deux cartes : « Reprendre » pour la
    // partie en cours, « Voir mon mot » pour le jeu de fond. Ne connaître que la
    // première laissait « Le mot de passe » ouvert, et le test suivant trouvait
    // toutes les fiches bloquées.
    const reprendre = page.getByRole("link", { name: /reprendre|voir mon mot/i }).first();
    if (!(await reprendre.isVisible().catch(() => false))) return;

    await reprendre.click();
    await page.waitForURL(/\/jeux\/[a-z0-9]+/);

    // « Terminer » pour une partie à plusieurs téléphones, « Abandonner » pour
    // le mode d'un seul : une partie laissée par un autre fichier de tests ne
    // doit pas bloquer celui-ci.
    const terminer = page.getByRole("button", { name: /^terminer$/i }).first();
    const abandonner = page.getByRole("button", { name: /^abandonner$/i }).first();
    const sortie = await Promise.race([
      terminer.waitFor({ timeout: 20_000 }).then(() => terminer),
      abandonner.waitFor({ timeout: 20_000 }).then(() => abandonner),
    ]).catch(() => null);
    if (!sortie) {
      await aller(page, "/jeux");
      return;
    }

    await sortie.click();
    // Le podium, ou le retour à la liste : dans les deux cas l'action a abouti.
    await expect(
      page.getByText("C'est fini").or(page.getByRole("heading", { name: "Les jeux" })),
    ).toBeVisible({ timeout: 20_000 });
    await aller(page, "/jeux");
  }
}

/** Ouvre un salon sur le jeu nommé et rend le code à quatre chiffres. */
export async function ouvrirSalonDe(page: Page, jeu: RegExp): Promise<string> {
  await libererLaBande(page);
  await page.getByRole("button", { name: jeu }).first().click();
  await page.getByRole("button", { name: /chacun son téléphone/i }).click();
  await page.waitForURL(/\/jeux\/[a-z0-9]+/);
  await expect(page.getByText("Le code à dicter")).toBeVisible();
  const code = await page.locator(".chiffres").first().innerText();
  expect(code).toMatch(/^[1-9]\d{3}$/);
  return code;
}

/** Ouvre un salon sur « Je n'ai jamais », le jeu de référence des tests. */
export async function ouvrirSalon(page: Page): Promise<string> {
  return ouvrirSalonDe(page, /Je n'ai jamais/i);
}

/**
 * Attendre que le deuxième téléphone soit vu par le premier.
 *
 * Le pseudo ne prouve rien : « Sam » est dans la liste des présents comme dans
 * celle des manquants, et « Sam » est d'ailleurs un préfixe de « Samy ». Le
 * point de présence, lui, ne s'allume que pour quelqu'un qui a donné signe de
 * vie il y a moins de vingt secondes — c'est exactement la question posée.
 */
export async function attendreDeuxPresents(page: Page) {
  await expect(page.getByLabel("connecté")).toHaveCount(2, { timeout: 15_000 });
}

/**
 * Deux téléphones dans une partie lancée, et rien d'autre.
 *
 * Les quatre derniers tests partagent ces sept lignes. Les recopier était déjà
 * la deuxième fois ; à la troisième on ne corrige plus qu'une copie sur trois.
 */
export async function deuxTelephonesEnPartie(
  navigateur: Browser,
  jeu: RegExp,
): Promise<{ hote: Page; invite: Page }> {
  const hote = await nouveauTelephone(navigateur);
  const invite = await nouveauTelephone(navigateur);
  await entrer(hote, "Momo");
  await entrer(invite, "Sam");

  const code = await ouvrirSalonDe(hote, jeu);
  await aller(invite, "/jeux");
  await rejoindreParCode(invite, code);
  await attendreDeuxPresents(hote);

  await hote.getByRole("button", { name: /lancer la partie/i }).click();
  return { hote, invite };
}

/**
 * Taper dans un champ jusqu'à ce que React l'ait vu.
 *
 * Le bouton d'envoi suit l'ÉTAT React : c'est le seul témoin fiable que la
 * saisie a été enregistrée. Vérifier la valeur du champ ne suffit pas — elle est
 * dans le DOM avant l'hydratation, et l'hydratation la remet à zéro juste après.
 * Un humain met plus d'une seconde à taper, un test non.
 *
 * Et il faut **repasser par le vide** à chaque essai. React ne compare pas la
 * valeur à son état, il compare la valeur du nœud à celle qu'il avait notée
 * lors du dernier événement : réécrire « 5732 » par-dessus un « 5732 » posé
 * avant l'hydratation ne lui fait voir aucun changement, donc aucun
 * `onChange`, donc un bouton désactivé jusqu'à la fin des temps. Un test qui
 * réessaie cent fois le même remplissage échoue cent fois de la même façon.
 */
export async function taper(champ: Locator, bouton: Locator, valeur: string) {
  await expect(champ).toBeVisible();
  await expect
    .poll(
      async () => {
        await champ.fill("");
        await champ.fill(valeur);
        return bouton.isEnabled();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** Taper le code à quatre chiffres et entrer dans le salon. */
export async function rejoindreParCode(page: Page, code: string) {
  const entrer = page.getByRole("button", { name: /entrer/i });
  await taper(page.locator("#code-partie"), entrer, code);
  await entrer.click();
  await page.waitForURL(/\/jeux\/[a-z0-9]+/);
}
