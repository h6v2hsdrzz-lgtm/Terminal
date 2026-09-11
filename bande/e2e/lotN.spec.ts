import { expect, test } from "@playwright/test";

import {
  attendreDeuxPresents,
  aller,
  deuxTelephonesEnPartie,
  entrer,
  libererLaBande,
  nouveauTelephone,
  ouvrirSalon,
  rejoindreParCode,
  taper,
} from "./aide-jeux";

/**
 * Le lot N : une partie sur trois téléphones.
 *
 * Les fonctions qui ouvrent deux téléphones vivent dans `aide-jeux.ts` — le lot
 * O s'en sert aussi.
 */

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
  // Par `taper` comme partout ailleurs : remplir le champ à la main marchait
  // une fois sur dix, et échouait le reste du temps sur un bouton resté
  // désactivé — React n'avait pas vu la saisie, arrivée avant l'hydratation.
  const bouton = page.getByRole("button", { name: /entrer/i });
  await taper(page.locator("#code-partie"), bouton, "1111");
  await bouton.click();
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
test("dans « Le plus rapide », le décompte puis le vert arrivent ensemble", async ({ browser }) => {
  const { hote, invite } = await deuxTelephonesEnPartie(browser, /Le plus rapide/i);

  // Le décompte 3-2-1 arrive aux deux écrans. Il est calculé à partir d'un
  // instant absolu annoncé à l'avance, pas d'un signal envoyé au moment voulu.
  await expect(hote.getByText("Prépare-toi.")).toBeVisible({ timeout: 30_000 });
  await expect(invite.getByText("Prépare-toi.")).toBeVisible({ timeout: 10_000 });

  // Puis l'attente — d'une à cinq secondes, pour qu'on ne parte pas sur le
  // « 1 » — puis le vert.
  //
  // On ne cherche pas à appuyer AVANT le vert dans ce test : le délai est tiré
  // au hasard, et un clic qui part une milliseconde après la bascule mesure la
  // chance du harnais, pas le jeu. La règle du départ brûlé se vérifie sur le
  // dépouillement, en Vitest, où l'horloge est à nous.
  const vertInvite = invite.getByText("MAINTENANT");
  const vertHote = hote.getByText("MAINTENANT");
  await expect(vertInvite).toBeVisible({ timeout: 30_000 });
  await expect(vertHote).toBeVisible({ timeout: 10_000 });

  // L'invité appuie le premier. Son temps s'affiche chez lui, en millisecondes.
  await vertInvite.click();
  await expect(invite.getByText(/^\d+ ms$/)).toBeVisible({ timeout: 15_000 });
  await vertHote.click();

  // Le verdict nomme celui qui a appuyé le premier ET son temps, et c'est le
  // MÊME texte sur les deux écrans : c'est tout ce que le multi promet.
  const verdict = hote.getByText(/, \d+ ms\./);
  await expect(verdict).toBeVisible({ timeout: 20_000 });
  await expect(verdict).toContainText("Sam");
  expect(await invite.getByText(/, \d+ ms\./).innerText()).toBe(await verdict.innerText());

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
