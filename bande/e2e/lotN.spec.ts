import { devices, expect, test, type Browser, type Locator, type Page } from "@playwright/test";
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

/**
 * Aller quelque part, même si une navigation est encore en vol.
 *
 * L'entrée dans l'application finit par une redirection côté client. Le titre du
 * fil apparaît avant qu'elle soit rangée, et un `goto` lancé à cet instant se
 * fait annuler par Playwright — « interrupted by another navigation ». Une seule
 * reprise suffit : ce n'est pas un problème de réseau, c'est un croisement, et
 * il a rendu un test sur neuf instable une fois sur trois.
 */
async function aller(page: Page, adresse: string) {
  try {
    await page.goto(adresse);
  } catch (erreur) {
    if (!/interrupted by another navigation/.test(String(erreur))) throw erreur;
    await page.goto(adresse);
  }
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
  // Attendre le titre et pas seulement l'adresse : la redirection vers
  // l'accueil peut encore être en vol, et une navigation lancée pendant
  // qu'une autre se termine est annulée par Playwright.
  await expect(page.getByRole("heading", { name: "Le fil" })).toBeVisible();
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
async function libererLaBande(page: Page) {
  await aller(page, "/jeux");

  // Deux tours suffisent : une seule partie vit à la fois pour la bande. Le
  // deuxième n'est là que pour vérifier que le premier a bien libéré.
  for (let essai = 0; essai < 2; essai += 1) {
    const reprendre = page.getByRole("link", { name: /reprendre/i }).first();
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
async function ouvrirSalonDe(page: Page, jeu: RegExp): Promise<string> {
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
async function ouvrirSalon(page: Page): Promise<string> {
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
async function attendreDeuxPresents(page: Page) {
  await expect(page.getByLabel("connecté")).toHaveCount(2, { timeout: 15_000 });
}

/**
 * Deux téléphones dans une partie lancée, et rien d'autre.
 *
 * Les quatre derniers tests partagent ces sept lignes. Les recopier était déjà
 * la deuxième fois ; à la troisième on ne corrige plus qu'une copie sur trois.
 */
async function deuxTelephonesEnPartie(
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
async function taper(champ: Locator, bouton: Locator, valeur: string) {
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
async function rejoindreParCode(page: Page, code: string) {
  const entrer = page.getByRole("button", { name: /entrer/i });
  await taper(page.locator("#code-partie"), entrer, code);
  await entrer.click();
  await page.waitForURL(/\/jeux\/[a-z0-9]+/);
}

/**
 * Rendre la bande comme on l'a trouvée, une fois le fichier terminé.
 *
 * Libérer la bande au DÉBUT de chaque test suffisait tant que le lot N tournait
 * seul. Ça ne suffit plus dans la suite complète : le dernier test du fichier
 * laissait une partie multi en cours, et les seize tests du lot G — qui cherchent
 * « Abandonner », le mot du mode à un seul téléphone — mouraient tous dessus.
 * Un fichier de tests ne laisse pas de vaisselle sale aux suivants.
 */
test.afterAll(async ({ browser }) => {
  const page = await nouveauTelephone(browser);
  await entrer(page, "Momo");
  await libererLaBande(page);
  await page.context().close();
});

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
  await aller(pageInvite, "/jeux");
  await rejoindreParCode(pageInvite, code);

  // Et l'écran de l'hôte l'apprend tout seul, par le flux : personne ne
  // rafraîchit rien.
  await attendreDeuxPresents(pageHote);
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

  await aller(pageInvite, "/jeux");
  await rejoindreParCode(pageInvite, code);
  await attendreDeuxPresents(pageHote);

  await pageHote.getByRole("button", { name: /lancer la partie/i }).click();

  // Le salon disparaît des deux côtés. L'invité n'a touché à rien.
  await expect(pageHote.getByText("Le code à dicter")).toBeHidden({ timeout: 20000 });
  await expect(pageInvite.getByText("Le code à dicter")).toBeHidden({ timeout: 20000 });
});

test("un code inconnu est refusé sans rien casser", async ({ page }) => {
  await entrer(page, "Samy");
  await aller(page, "/jeux");
  const champ = page.locator("#code-partie");
  await expect(champ).toBeVisible();
  await champ.fill("1111");
  await expect(champ).toHaveValue("1111");
  await page.getByRole("button", { name: /entrer/i }).click();
  await expect(page.getByRole("alert").first()).toContainText(/aucune partie|expiré/i);
  await expect(page).toHaveURL(/\/jeux$/);
});

/**
 * Une manche complète de « Je n'ai jamais », à deux téléphones.
 *
 * C'est le test qui compte : il prouve que la carte est la même des deux
 * côtés, que chacun répond chez lui, et que la révélation arrive aux deux
 * écrans sans que personne ne rafraîchisse.
 */
test("une manche se joue et se révèle sur les deux écrans", async ({ browser }) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Je n'ai jamais/i);

  // La même carte, aux deux écrans, sans que personne ne rafraîchisse.
  const carteHote = hote.getByText(/Je n'ai jamais/).first();
  const carteInvite = invite.getByText(/Je n'ai jamais/).first();
  await expect(carteHote).toBeVisible({ timeout: 25_000 });
  await expect(carteInvite).toBeVisible({ timeout: 25_000 });
  expect(await carteHote.innerText()).toBe(await carteInvite.innerText());

  // Chacun répond chez lui.
  await hote.getByRole("button", { name: /je l'ai fait/i }).click();
  await expect(hote.getByText(/c'est envoyé/i)).toBeVisible({ timeout: 10_000 });
  await invite.getByRole("button", { name: /^jamais$/i }).click();

  // Et la révélation arrive aux deux, toute seule.
  await expect(hote.getByRole("button", { name: /manche suivante/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(invite.getByText(/l'hôte enchaîne/i)).toBeVisible({ timeout: 20_000 });

  // L'hôte enchaîne, et le deuxième écran suit.
  await hote.getByRole("button", { name: /manche suivante/i }).click();
  await expect(invite.getByText(/l'hôte enchaîne/i)).toBeHidden({ timeout: 20_000 });
});

/**
 * « Devine qui je suis » : l'écran de celui qui devine n'est pas celui des
 * autres. C'est l'archétype « tour », et le multi le rend enfin jouable — plus
 * de téléphone sur le front.
 */
test("dans « Devine qui je suis », le mot ne s'affiche que chez les autres", async ({
  browser,
}) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Devine qui je suis/i);

  // Un des deux devine, l'autre voit le mot. On ne sait pas lequel — l'ordre
  // est tiré au lancement — donc on vérifie que les deux écrans DIFFÈRENT, et
  // que celui qui devine a bien ses deux boutons.
  const devineHote = hote.getByRole("button", { name: /^trouvé$/i });
  const devineInvite = invite.getByRole("button", { name: /^trouvé$/i });
  await expect
    .poll(async () => (await devineHote.count()) + (await devineInvite.count()), {
      timeout: 25_000,
    })
    .toBe(1);

  const acteur = (await devineHote.count()) === 1 ? hote : invite;
  const spectateur = acteur === hote ? invite : hote;
  await expect(spectateur.getByText(/fais deviner à/i)).toBeVisible();
  await expect(acteur.getByRole("button", { name: /^passer$/i })).toBeVisible();

  // L'acteur dit « trouvé », et les deux écrans passent à la révélation. Ce
  // geste est le SEUL qui termine la manche : personne d'autre n'a de bouton,
  // et l'hôte doit verser la réponse de l'acteur dans la phase pour que le
  // dépouillement la voie.
  await acteur.getByRole("button", { name: /^trouvé$/i }).click();
  await expect(acteur.getByText(/trouvé —/i)).toBeVisible({ timeout: 20_000 });
  await expect(spectateur.getByText(/trouvé —/i)).toBeVisible({ timeout: 20_000 });
});

/**
 * « Le plus rapide », l'archétype « réflexe », et le seul jeu où la latence
 * changerait le vainqueur.
 *
 * Ce test vérifie ce qui le rend honnête : le passage au vert arrive **en même
 * temps** sur les deux téléphones, parce qu'il est calculé à partir d'un
 * instant absolu annoncé à l'avance et non d'un signal envoyé au moment voulu ;
 * et c'est l'horodatage du serveur qui départage, pas l'ordre d'arrivée.
 */
test("dans « Le plus rapide », les deux écrans passent au vert ensemble", async ({ browser }) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Le plus rapide/i);

  // Les deux écrans passent au vert. Le délai est tiré entre deux et cinq
  // secondes par l'hôte et annoncé aux deux en **instant absolu** : c'est le
  // compte à rebours local qui fait basculer chaque écran, pas un signal envoyé
  // au moment voulu.
  //
  // On ne cherche pas à appuyer AVANT le vert dans ce test. Le délai est tiré
  // au hasard, l'écran apparaît quand la page veut bien, et un clic qui part
  // une milliseconde après la bascule mesure la chance du harnais, pas le jeu.
  // La règle du départ brûlé se vérifie sur le dépouillement, en Vitest, où
  // l'horloge est à nous.
  const vertInvite = invite.getByText("MAINTENANT");
  const vertHote = hote.getByText("MAINTENANT");
  await expect(vertInvite).toBeVisible({ timeout: 30_000 });
  await expect(vertHote).toBeVisible({ timeout: 10_000 });

  // L'invité appuie le premier, et c'est l'horodatage du SERVEUR qui le dit.
  await vertInvite.click();
  await expect(invite.getByText("Enregistré.")).toBeVisible({ timeout: 15_000 });
  await vertHote.click();

  // Le verdict nomme celui qui a appuyé le premier, et c'est le MÊME texte sur
  // les deux écrans : c'est tout ce que le multi promet, et c'est tout ce qu'il
  // doit tenir.
  const verdict = hote.getByText(/d'abord\./);
  await expect(verdict).toBeVisible({ timeout: 20_000 });
  await expect(verdict).toContainText("Sam");
  expect(await invite.getByText(/d'abord\./).innerText()).toBe(await verdict.innerText());

  // Et les deux appuis sont au classement, dans l'ordre, chez les deux.
  await expect(invite.getByRole("listitem")).toHaveCount(2);
  await expect(invite.getByRole("listitem").first()).toContainText("1. Sam");
});

/**
 * L'hôte s'en va, et la partie continue.
 *
 * C'est l'exigence N4 dans sa forme la plus dure : « une partie ne doit jamais
 * se retrouver bloquée sans issue ». L'hôte est celui qui fait avancer les
 * phases — s'il ferme son téléphone, plus personne ne révèle rien, et les deux
 * autres regardent une carte qui ne bougera plus.
 *
 * Le test ferme vraiment l'onglet de l'hôte. Trois délais s'enchaînent alors :
 * vingt secondes avant qu'un silence compte comme une absence, le temps que le
 * flux s'en aperçoive, puis dix secondes avant qu'un autre tente la reprise.
 * D'où la minute et demie accordée — c'est le prix d'éprouver une horloge pour
 * de vrai plutôt que de la simuler.
 */
test("l'hôte ferme son téléphone, et quelqu'un d'autre reprend la main", async ({ browser }) => {
  test.setTimeout(120_000);
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Je n'ai jamais/i);

  // On attend que la première manche soit **distribuée** avant de couper l'hôte.
  // Sinon on éprouve un autre cas — l'hôte qui s'en va avant d'avoir distribué —
  // et celui-là se règle aussi, mais par la reprise de main seule : les boutons
  // de vote ne sont même pas là.
  const jamais = invite.getByRole("button", { name: /^jamais$/i });
  await expect(jamais).toBeVisible({ timeout: 25_000 });
  // Tant que l'hôte est là, l'invité n'a aucun bouton d'hôte : c'est le point
  // de départ, et sans lui la suite ne prouverait rien.
  await expect(invite.getByRole("button", { name: /manche suivante/i })).toHaveCount(0);

  await hote.close();

  // L'invité répond chez lui, comme si de rien n'était.
  await jamais.click();
  await expect(invite.getByText(/c'est envoyé/i)).toBeVisible({ timeout: 15_000 });

  // Puis il devient seul présent, reprend la main, et la manche se révèle : le
  // bouton d'hôte apparaît chez lui, ce qui n'arrive que si le serveur lui a
  // bien donné le rôle.
  await expect(invite.getByRole("button", { name: /manche suivante/i })).toBeVisible({
    timeout: 75_000,
  });
});

/**
 * « Le jugement » : les autres répondent, et c'est l'acteur qui tranche.
 *
 * Une partie se jouait ici sur un détail d'architecture. L'écran du juge
 * publiait lui-même la phase de résultat — or **seul l'hôte a le droit de
 * publier**, et l'appel échouait en silence dès que le juge n'était pas l'hôte :
 * la partie restait figée sur le choix du juge, sans échéance pour la relever.
 * Le juge envoie donc une action, comme tout le monde, et l'hôte en tire la
 * révélation. Ce test existe parce que le bogue n'apparaît qu'une fois sur deux,
 * selon le tirage de l'ordre de passage.
 */
test("dans « Le jugement », le juge tranche et les deux écrans l'apprennent", async ({
  browser,
}) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Le jugement/i);

  // Un seul des deux écrit : l'autre juge. L'ordre est tiré au lancement.
  const champHote = hote.getByPlaceholder("Ta réponse…");
  const champInvite = invite.getByPlaceholder("Ta réponse…");
  await expect
    .poll(async () => (await champHote.count()) + (await champInvite.count()), {
      timeout: 25_000,
    })
    .toBe(1);

  const temoin = (await champHote.count()) === 1 ? hote : invite;
  const juge = temoin === hote ? invite : hote;
  await expect(juge.getByText(/tu juges/i)).toBeVisible();
  await expect(juge.getByText(/ils réfléchissent/i)).toBeVisible();

  const plaidoirie = "Parce que c'est comme ça, voilà.";
  const envoyer = temoin.getByRole("button", { name: /^envoyer$/i });
  await taper(temoin.getByPlaceholder("Ta réponse…"), envoyer, plaidoirie);
  await envoyer.click();
  await expect(temoin.getByText(/c'est envoyé/i)).toBeVisible({ timeout: 15_000 });

  // Le juge voit la réponse arriver chez lui, et la touche.
  const choix = juge.getByRole("button", { name: plaidoirie });
  await expect(choix).toBeVisible({ timeout: 20_000 });
  await choix.click();

  // Le verdict arrive aux deux écrans.
  await expect(juge.getByText(/l'emporte\./)).toBeVisible({ timeout: 20_000 });
  await expect(temoin.getByText(/l'emporte\./)).toBeVisible({ timeout: 20_000 });
});

/**
 * « Menteur » : une phase de plus, et un écran que l'acteur ne partage pas.
 *
 * C'est la quatrième forme, et la seule qui commence par une PRÉPARATION :
 * l'acteur écrit ses trois affirmations chez lui — personne ne lit par-dessus
 * son épaule, ce qui était impossible à un seul téléphone — puis l'hôte verse ce
 * qu'il a écrit dans la phase de vote. Les autres cherchent alors laquelle est
 * fausse, sans voir le vote du voisin.
 */
test("dans « Menteur », l'acteur écrit chez lui et les autres votent", async ({ browser }) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Menteur/i);

  // Un seul des deux écrit. L'autre attend, et son écran le dit.
  const champHote = hote.getByPlaceholder("Affirmation 1");
  const champInvite = invite.getByPlaceholder("Affirmation 1");
  await expect
    .poll(async () => (await champHote.count()) + (await champInvite.count()), {
      timeout: 25_000,
    })
    .toBe(1);

  const menteur = (await champHote.count()) === 1 ? hote : invite;
  const chercheur = menteur === hote ? invite : hote;
  await expect(chercheur.getByText(/écrit ses trois affirmations/i)).toBeVisible();

  const dits = ["J'ai déjà dormi dans un aéroport", "Je sais siffler avec deux doigts", "J'ai un tatouage"];
  for (const [i, texte] of dits.entries()) {
    await menteur.getByPlaceholder(`Affirmation ${i + 1}`).fill(texte);
  }
  // La fausse se désigne AVANT d'envoyer : sans elle, le bouton reste éteint.
  const envoyer = menteur.getByRole("button", { name: /^envoyer$/i });
  await expect(envoyer).toBeDisabled();
  await menteur.getByRole("button", { name: /affirmation 3 comme fausse/i }).click();
  await expect(envoyer).toBeEnabled();
  await envoyer.click();

  // Les trois affirmations arrivent chez l'autre, en options de vote. L'acteur,
  // lui, n'a rien à voter : il les a écrites.
  const option = chercheur.getByRole("button", { name: dits[2] });
  await expect(option).toBeVisible({ timeout: 25_000 });
  await expect(menteur.getByText(/cherchent le mensonge/i)).toBeVisible();
  await option.click();

  // Le verdict arrive aux deux écrans, et il nomme celui qui a vu clair.
  await expect(chercheur.getByText(/ont vu clair/i)).toBeVisible({ timeout: 20_000 });
  await expect(menteur.getByText(/ont vu clair/i)).toBeVisible({ timeout: 20_000 });
});
