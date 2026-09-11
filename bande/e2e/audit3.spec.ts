import { expect, test, type Page } from "@playwright/test";

import {
  aller,
  entrer,
  passerLesNouveautes,
  libererLaBande,
  nouveauTelephone,
  ouvrirSalonDe,
  rejoindreParCode,
} from "./aide-jeux";

/**
 * Lot R, audit n° 3 — le parcours réel, à **trois** téléphones.
 *
 * Les lots N et O éprouvent le moteur à deux contextes de navigateur. Deux
 * suffisent pour prouver qu'un écran dépend du rôle ; ils ne prouvent pas qu'une
 * partie à trois se déroule, ni qu'un troisième écran qui arrive en retard
 * retrouve la bonne manche. Ce fichier ouvre donc trois contextes — trois
 * téléphones — et joue pour de vrai.
 *
 * ## Ce qui ne peut PAS être éprouvé ici, et pourquoi
 *
 * Le WebKit de Playwright n'est pas Safari iOS. Il n'a **ni `MediaRecorder`, ni
 * `PushManager`, ni `Notification`**, et le sélecteur de fichiers d'iOS ne s'y
 * ouvre pas. Donc :
 *
 * · « La théorie du complot » et « Le tribunal des idées » ne se jouent pas ici
 *   — ils sont faits d'un enregistrement audio ;
 * · la notification qui ARRIVE ne se teste pas. Ce qui se teste, et qui est
 *   testé plus bas, c'est que l'écran qu'elle ouvre existe et affiche la bonne
 *   chose ;
 * · la photo prise à la caméra ne se teste pas. L'envoi, si.
 *
 * Ces trois-là sont la raison d'être de l'essai à la main sur un vrai iPhone,
 * et ils sont écrits comme tels dans `ETAT.md`.
 */
test.describe.configure({ mode: "serial" });

type Bande = { momo: Page; sam: Page; samy: Page };

async function troisTelephones(browser: Parameters<typeof nouveauTelephone>[0]): Promise<Bande> {
  const momo = await nouveauTelephone(browser);
  const sam = await nouveauTelephone(browser);
  const samy = await nouveauTelephone(browser);
  await entrer(momo, "Momo");
  await entrer(sam, "Sam");
  await entrer(samy, "Samy");
  return { momo, sam, samy };
}

async function fermer(bande: Bande) {
  await libererLaBande(bande.momo).catch(() => {});
  for (const page of [bande.momo, bande.sam, bande.samy]) {
    await page.context().close().catch(() => {});
  }
}

/** Les trois dans le même salon, partie lancée. */
async function partieATrois(bande: Bande, jeu: RegExp) {
  const code = await ouvrirSalonDe(bande.momo, jeu);
  for (const invite of [bande.sam, bande.samy]) {
    await aller(invite, "/jeux");
    await rejoindreParCode(invite, code);
  }
  // Trois points de présence allumés, pas deux : c'est la seule preuve que le
  // troisième écran est vu par l'hôte.
  await expect(bande.momo.getByLabel("connecté")).toHaveCount(3, { timeout: 20_000 });
  await bande.momo.getByRole("button", { name: /lancer la partie/i }).click();
}

test.afterAll(async ({ browser }) => {
  const page = await nouveauTelephone(browser);
  await entrer(page, "Momo");
  await libererLaBande(page);
  await page.context().close();
});

test("« Je n'ai jamais » à trois, jusqu'au podium", async ({ browser }) => {
  test.slow();
  const bande = await troisTelephones(browser);
  try {
    await partieATrois(bande, /Je n'ai jamais/i);

    // La même carte sur les TROIS écrans, sans que personne ne rafraîchisse.
    const cartes = await Promise.all(
      [bande.momo, bande.sam, bande.samy].map(async (page) => {
        const carte = page.locator("[data-enonce]");
        await expect(carte).toBeVisible({ timeout: 30_000 });
        return carte.innerText();
      }),
    );
    expect(new Set(cartes).size, `trois cartes différentes : ${cartes.join(" | ")}`).toBe(1);

    // Deux manches complètes : chacun répond chez lui, l'hôte enchaîne.
    for (let manche = 0; manche < 2; manche += 1) {
      await bande.momo.getByRole("button", { name: /je l'ai fait/i }).click();
      await bande.sam.getByRole("button", { name: /^jamais$/i }).click();
      await bande.samy.getByRole("button", { name: /^jamais$/i }).click();

      const suivante = bande.momo.getByRole("button", { name: /manche suivante/i });
      await expect(suivante).toBeVisible({ timeout: 25_000 });
      // Les deux autres voient la révélation en même temps, et savent qu'ils
      // attendent l'hôte.
      await expect(bande.sam.getByText(/l'hôte enchaîne/i)).toBeVisible({ timeout: 20_000 });
      await expect(bande.samy.getByText(/l'hôte enchaîne/i)).toBeVisible({ timeout: 20_000 });
      await suivante.click();
      await expect(bande.sam.getByText(/l'hôte enchaîne/i)).toBeHidden({ timeout: 20_000 });
    }

    // Et la fin : le podium arrive aux trois écrans.
    await bande.momo.getByRole("button", { name: /^terminer$/i }).click();
    for (const page of [bande.momo, bande.sam, bande.samy]) {
      await expect(page.getByText("C'est fini")).toBeVisible({ timeout: 25_000 });
    }
  } finally {
    await fermer(bande);
  }
});

/**
 * « Devine qui je suis » à trois : l'archétype où les écrans diffèrent VRAIMENT.
 *
 * À deux, on prouve que celui qui devine ne voit pas le mot. À trois, on prouve
 * en plus que les DEUX autres le voient — c'est-à-dire que l'écran dépend du
 * rôle et non de « suis-je l'hôte ». C'est exactement ce que le lot N promettait
 * et que deux téléphones ne peuvent pas montrer.
 */
test("« Devine qui je suis » : un devine, les deux autres voient le mot", async ({ browser }) => {
  test.slow();
  const bande = await troisTelephones(browser);
  try {
    await partieATrois(bande, /Devine qui je suis/i);

    const ecrans = [bande.momo, bande.sam, bande.samy];
    // Qui devine ? L'ordre de passage est tiré au sort : on le découvre.
    const roles = await Promise.all(
      ecrans.map(async (page) => {
        await expect(
          page.getByText(/sur ton front|fais deviner|à toi de deviner/i).first(),
        ).toBeVisible({ timeout: 30_000 });
        return page
          .getByText(/fais deviner/i)
          .first()
          .isVisible()
          .catch(() => false);
      }),
    );

    const souffleurs = ecrans.filter((_, rang) => roles[rang]);
    const devineurs = ecrans.filter((_, rang) => !roles[rang]);
    expect(souffleurs, "deux écrans doivent souffler").toHaveLength(2);
    expect(devineurs, "un seul écran devine").toHaveLength(1);

    // Les deux souffleurs voient LE MÊME mot, et le devineur ne le voit pas.
    const mots = await Promise.all(
      souffleurs.map(async (page) => {
        const carte = page.locator("[data-enonce]").first();
        await expect(carte).toBeVisible({ timeout: 20_000 });
        return (await carte.getAttribute("data-enonce")) ?? "";
      }),
    );
    expect(new Set(mots).size, `mots différents : ${mots.join(" | ")}`).toBe(1);

    // Les trois ont « Trouvé » et « Passer » — le plan les demandait chez les
    // souffleurs, ils n'étaient que chez celui qui devine. Le premier qui
    // appuie termine la manche.
    for (const page of [...souffleurs, devineurs[0]]) {
      await expect(page.getByRole("button", { name: /trouvé/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /^passer$/i })).toBeVisible();
    }
    // Mais celui qui devine ne voit PAS le mot : c'est tout l'intérêt.
    await expect(devineurs[0].locator("[data-enonce]")).toHaveCount(0);

    // Et un souffleur peut vraiment terminer la manche : avant l'audit, seul
    // le geste de l'acteur était écouté, donc ces boutons-là n'auraient rien
    // fait du tout.
    await souffleurs[0].getByRole("button", { name: /trouvé/i }).click();
    for (const page of ecrans) {
      await expect(page.getByText(/manche suivante|l'hôte enchaîne/i).first()).toBeVisible({
        timeout: 25_000,
      });
    }
  } finally {
    await fermer(bande);
  }
});

test("un téléphone qui se recharge en pleine partie retrouve la même manche", async ({
  browser,
}) => {
  test.slow();
  const bande = await troisTelephones(browser);
  try {
    await partieATrois(bande, /Je n'ai jamais/i);
    const carte = bande.sam.locator("[data-enonce]");
    await expect(carte).toBeVisible({ timeout: 30_000 });
    const avant = await carte.innerText();

    // Verrouiller l'écran, changer d'application, perdre le réseau une seconde :
    // pour le navigateur, ça revient à repartir de zéro sur la même adresse.
    await bande.sam.reload();
    const apres = bande.sam.locator("[data-enonce]");
    await expect(apres).toBeVisible({ timeout: 30_000 });
    expect(await apres.innerText()).toBe(avant);

    // Et il peut encore répondre : l'état venait du serveur, pas de sa mémoire.
    await bande.sam.getByRole("button", { name: /^jamais$/i }).click();
    await expect(bande.sam.getByText(/c'est envoyé|l'hôte/i).first()).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await fermer(bande);
  }
});

test("« Le plus rapide » : le signal part au même instant pour les trois", async ({ browser }) => {
  test.slow();
  const bande = await troisTelephones(browser);
  try {
    await partieATrois(bande, /Le plus rapide/i);

    // Le décompte, puis l'attente. « MAINTENANT » en capitales est le signal,
    // et rien d'autre ne l'écrit : chercher « maintenant » sans distinction de
    // casse attrapait la consigne du décompte, les trois tapaient trop tôt, et
    // le jeu annonçait — correctement — que tout le monde avait brûlé le
    // départ. C'était le test qui avait tort.
    for (const page of [bande.momo, bande.sam, bande.samy]) {
      await expect(page.getByText("Attends…").or(page.getByText("Prépare-toi."))).toBeVisible({
        timeout: 30_000,
      });
    }

    // Le signal vient du serveur, en absolu, au même instant pour les trois.
    for (const page of [bande.momo, bande.sam, bande.samy]) {
      await expect(page.getByText("MAINTENANT", { exact: true })).toBeVisible({ timeout: 30_000 });
    }
    for (const page of [bande.momo, bande.sam, bande.samy]) {
      await page.locator("body").click({ position: { x: 190, y: 400 } });
    }

    // Chacun voit SON temps, en millisecondes — et personne n'a brûlé le départ.
    for (const page of [bande.momo, bande.sam, bande.samy]) {
      await expect(page.getByText(/\d+\s*ms/).first()).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText("Trop tôt.")).toHaveCount(0);
    }
  } finally {
    await fermer(bande);
  }
});

test("une journée posée arrive sur les deux autres téléphones toute seule", async ({ browser }) => {
  test.slow();
  const bande = await troisTelephones(browser);
  const marque = `audit3-${Date.now().toString(36)}`;
  try {
    // Les deux autres regardent le fil, sans rien toucher.
    await aller(bande.sam, "/");
    await aller(bande.samy, "/");

    await aller(bande.momo, "/aujourdhui");
    const corriger = bande.momo.getByRole("button", { name: /corriger ta journée/i });
    if (await corriger.isVisible().catch(() => false)) await corriger.click();
    await bande.momo.fill("#titre", marque);
    await bande.momo.getByRole("button", { name: /poser ma joie du jour|corriger/i }).click();
    await expect(bande.momo.getByRole("button", { name: /corriger ta journée/i })).toBeVisible({
      timeout: 20_000,
    });

    // Le sondage de version tourne toutes les trois secondes : l'arrivée doit
    // se faire sans que personne ne rafraîchisse.
    await expect(bande.sam.getByText(marque).first()).toBeVisible({ timeout: 30_000 });
    await expect(bande.samy.getByText(marque).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await fermer(bande);
  }
});

test("une journée coupée en plein réseau est gardée, et part toute seule après", async ({
  browser,
}) => {
  test.slow();
  const nom = `Coupure ${Date.now().toString(36)}`;
  const page = await nouveauTelephone(browser);
  try {
    // Une bande neuve : le scénario demande quelqu'un qui n'a **pas** encore
    // posé sa journée, et dans la bande de démonstration tout le monde a posé.
    // Un test qui dépend de ça rougit une exécution sur deux.
    await page.goto("/bienvenue/creer");
    await page.fill("#bande", nom);
    await page.fill("#pseudo", "Coupé");
    await page.getByRole("button", { name: /créer/i }).click();
    await page.waitForURL(/\/bienvenue\/code/);
    await page.getByRole("button", { name: /c'est noté/i }).click();
    await page.waitForURL("/");
    await passerLesNouveautes(page);

    await aller(page, "/aujourdhui");
    const marque = `coupé-${Date.now().toString(36)}`;
    await page.fill("#note", marque);

    // On abat l'action serveur, pas le réseau entier : `setOffline` casse
    // `createImageBitmap` dans ce WebKit, et c'est un artefact du harnais.
    await page.route("**/*", async (route) => {
      const requete = route.request();
      if (requete.method() === "POST" && requete.headers()["next-action"]) return route.abort();
      return route.fallback();
    });
    await page.getByRole("button", { name: /poser ma joie du jour/i }).click();

    // Rien n'est perdu, et l'écran le DIT — c'est la moitié qui compte.
    await expect(page.getByText(/gardée sur ce téléphone/i)).toBeVisible({ timeout: 20_000 });

    // Le réseau revient. On lève le blocage ET on annonce le retour : le
    // renvoi s'accroche à l'événement `online` du navigateur, et lever une
    // route Playwright n'en déclenche aucun. Sur un vrai téléphone qui sort du
    // métro, c'est le système qui l'envoie.
    await page.unroute("**/*");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("button", { name: /corriger ta journée/i })).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByText(/gardée sur ce téléphone/i)).toBeHidden();

    // Et elle est vraiment arrivée : le fil la porte.
    await aller(page, "/");
    await expect(page.getByText(marque).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await aller(page, "/reglages").catch(() => {});
    await page.getByText("Quitter la bande", { exact: true }).click().catch(() => {});
    await page.locator("#confirmation").fill(nom).catch(() => {});
    await page
      .getByRole("button", { name: /partir pour de bon/i })
      .click()
      .catch(() => {});
    await page.context().close().catch(() => {});
  }
});

test("le lien profond d'une notification ouvre la bonne journée", async ({ browser }) => {
  const bande = await troisTelephones(browser);
  try {
    // C'est exactement l'adresse que porte une notification « untel a posé sa
    // journée » : `/jour/<jour>`. Ce qui ne se teste pas ici, c'est l'arrivée
    // de la notification — ce WebKit n'a pas `Notification`.
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await aller(bande.sam, `/jour/${aujourdhui}`);
    await expect(bande.sam.getByRole("heading", { name: /aujourd'hui/i })).toBeVisible();
    await expect(bande.sam.getByRole("link", { name: /le fil/i })).toBeVisible();
  } finally {
    await fermer(bande);
  }
});
