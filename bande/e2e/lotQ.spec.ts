import { expect, test, type Page } from "@playwright/test";

import { aller, codeDe as codeLu, entrer, nouveauTelephone, passerLesNouveautes } from "./aide-jeux";
import { TYPES } from "../src/lib/pousse/types";
import { ecrireZip, lireZip } from "../src/lib/archive";

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

/**
 * Taper dans le champ de recherche, jusqu'à ce que React l'ait vu.
 *
 * Le même piège que le code d'une partie, payé une deuxième fois : React
 * compare la valeur du nœud à celle du dernier événement, pas à son état. Un
 * `fill` qui arrive avant l'hydratation ne déclenche donc aucun `onChange`, la
 * carte d'accueil reste affichée, et le test attend un résultat qui ne viendra
 * jamais. On repasse par le vide, et on attend que l'écran réagisse.
 */
async function chercher(page: Page, mots: string) {
  const champ = page.locator("#recherche");
  await expect(champ).toBeVisible();
  const accueil = page.getByText(/deux lettres suffisent/i);
  await expect
    .poll(
      async () => {
        await champ.fill("");
        await champ.fill(mots);
        return accueil.isHidden();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
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

  // On lit l'état AVANT de toucher, et on le remet à la fin.
  //
  // La première version supposait les valeurs par défaut. Ça tient tant que le
  // test finit bien ; un échec au milieu laisse les réglages de Sam à l'envers,
  // et le test suivant rougit pour une raison qui n'a rien à voir avec lui. Un
  // test qui écrit une donnée durable ne suppose jamais son point de départ.
  const commentaires = ligne(page, /les commentaires/i);
  const reactions = ligne(page, /les réactions/i);
  const auDepart = {
    commentaires: await commentaires.isChecked(),
    reactions: await reactions.isChecked(),
  };

  try {
    // Les deux coup sur coup, SANS rien attendre entre les deux : c'est le
    // geste de quelqu'un qui règle ses notifications. L'écriture côté serveur
    // est une fusion JSONB atomique, justement pour que deux réglages qui se
    // croisent ne s'écrasent pas — ce test ne les envoie pas assez près l'un de
    // l'autre pour le prouver, et c'est écrit dans `reglerPreference`.
    await commentaires.click();
    await reactions.click();
    await expect(commentaires).toBeChecked({ checked: !auDepart.commentaires });
    await expect(reactions).toBeChecked({ checked: !auDepart.reactions });

    // Le seul témoin qui compte : la base. Un état React qui survit à un clic
    // ne prouve rien du tout.
    await page.reload();
    await expect(ligne(page, /les commentaires/i)).toBeChecked({
      checked: !auDepart.commentaires,
    });
    await expect(ligne(page, /les réactions/i)).toBeChecked({ checked: !auDepart.reactions });

    // Et les deux cases ont bien été retenues toutes les deux : elles partent
    // coup sur coup, et l'écriture était une lecture-modification-écriture —
    // la seconde écrasait la première. C'est du JSONB fusionné par PostgreSQL
    // depuis l'audit du lot R.
  } finally {
    await page.goto("/reglages");
    for (const [champ, valeur] of [
      [ligne(page, /les commentaires/i), auDepart.commentaires],
      [ligne(page, /les réactions/i), auDepart.reactions],
    ] as const) {
      if ((await champ.isChecked()) !== valeur) await champ.click();
      await expect(champ).toBeChecked({ checked: valeur });
    }
  }
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

  await chercher(page, "pluie");
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
  await chercher(page, "journee");
  await expect(page.getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });

  // Deux mots dont un introuvable ne rendent rien : la recherche est un ET.
  await chercher(page, "journee xyzzyx");
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
  await passerLesNouveautes(premier);

  await aller(premier, "/reglages");
  const invitation = await premier.locator(".chiffres").first().innerText();

  await second.goto("/bienvenue/rejoindre");
  await second.fill("#invitation", invitation.replace(/\s+/g, ""));
  await second.fill("#pseudo", "Cherche");
  await second.getByRole("button", { name: /rejoindre/i }).click();
  await second.waitForURL(/\/bienvenue\/code/);
  await second.getByRole("button", { name: /c'est noté/i }).click();
  await second.waitForURL("/");
  await passerLesNouveautes(second);

  // ── Le premier pose une journée avec un mot qu'on ne trouve nulle part ────
  await aller(premier, "/aujourdhui");
  await premier.fill("#titre", marque);
  await premier.getByRole("button", { name: /poser ma joie du jour/i }).click();
  await expect(premier.getByRole("button", { name: /corriger ta journée/i })).toBeVisible({
    timeout: 15_000,
  });

  // ── Le second n'a rien posé : il ne doit RIEN trouver ─────────────────────
  await aller(second, "/recherche");
  await chercher(second, marque);
  await expect(second.getByText(/rien pour/i)).toBeVisible({ timeout: 15_000 });

  // ── Il pose la sienne : le voile tombe, la journée apparaît ───────────────
  await aller(second, "/aujourdhui");
  await second.fill("#note", "Posée pour lever le voile.");
  await second.getByRole("button", { name: /poser ma joie du jour/i }).click();
  await expect(second.getByRole("button", { name: /corriger ta journée/i })).toBeVisible({
    timeout: 15_000,
  });

  await aller(second, "/recherche");
  await chercher(second, marque);
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

/**
 * Q4 — la sauvegarde complète, et l'import qui va avec.
 *
 * L'archive est écrite à la main (`src/lib/archive.ts`). Le relire avec son
 * propre lecteur ne prouve pas grand-chose : la première version déclarait un
 * répertoire central douze octets trop long, l'aller-retour maison passait, et
 * `unzip` parlait de « composants qui se chevauchent ». Ce test appelle donc le
 * `unzip` du système — un avis qui ne vient pas de nous.
 */
test("la sauvegarde complète est un vrai ZIP, avec les photos dedans", async ({ page }) => {
  test.slow();
  await entrer(page, "Momo");

  const reponse = await page.request.get("/api/export?format=zip");
  expect(reponse.status()).toBe(200);
  expect(reponse.headers()["content-type"]).toContain("application/zip");

  const octets = new Uint8Array(await reponse.body());
  const dedans = lireZip(octets);
  const noms = dedans.map((f) => f.nom);
  expect(noms).toContain("journal.json");
  expect(noms).toContain("journal.csv");
  expect(noms).toContain("LISEZ-MOI.txt");
  // Une sauvegarde qui dit « 3 photos » sans les photos est un inventaire.
  expect(noms.filter((n) => n.startsWith("medias/")).length).toBeGreaterThan(0);

  const journal = JSON.parse(
    new TextDecoder().decode(dedans.find((f) => f.nom === "journal.json")!.octets),
  ) as { journees: { medias: { fichier: string }[] }[] };
  // Chaque fichier annoncé par le JSON est réellement dans l'archive : c'est ce
  // qui fait la différence entre une sauvegarde et une liste de courses.
  for (const journee of journal.journees) {
    for (const media of journee.medias) expect(noms).toContain(media.fichier);
  }

  // L'avis extérieur.
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const chemin = join(mkdtempSync(join(tmpdir(), "joie-")), "sauvegarde.zip");
  writeFileSync(chemin, octets);
  try {
    const sortie = execFileSync("unzip", ["-t", chemin], { encoding: "utf8" });
    expect(sortie).toContain("No errors detected");
  } catch (erreur) {
    // Pas d'`unzip` sur cette machine : on ne fait pas échouer la suite pour
    // un outil manquant, mais on le dit.
    if (!/ENOENT/.test(String(erreur))) throw erreur;
    test.info().annotations.push({ type: "sauté", description: "unzip absent de la machine" });
  }
});

test("restaurer une sauvegarde remet les journées, et n'écrase rien", async ({ browser }) => {
  test.slow();
  const nom = `Restau ${Date.now().toString(36)}`;
  const page = await nouveauTelephone(browser);

  await page.goto("/bienvenue/creer");
  await page.fill("#bande", nom);
  await page.fill("#pseudo", "Gardien");
  await page.getByRole("button", { name: /créer/i }).click();
  await page.waitForURL(/\/bienvenue\/code/);
  await page.getByRole("button", { name: /c'est noté/i }).click();
  await page.waitForURL("/");
  await passerLesNouveautes(page);

  // Une petite archive faite ici : restaurer les quatre cents journées de la
  // bande de démonstration prendrait des minutes et ne prouverait rien de plus.
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);
  const journal = {
    bande: nom,
    exporteLe: "2026-01-02T10:00:00.000Z",
    membres: [{ pseudo: "Gardien", teinte: 1, arriveLe: "2026-01-01T00:00:00.000Z" }],
    declencheurs: [],
    journees: [
      {
        jour: "2026-01-01",
        qui: "Gardien",
        joie: 8,
        titre: "Le premier jour",
        note: "Retrouvé dans une sauvegarde.",
        declencheurs: [],
        etiquettes: ["Chez moi"],
        energie: null,
        calme: null,
        photos: 1,
        vocal: false,
        reactions: [],
        commentaires: [{ de: "Gardien", texte: "Note pour plus tard.", quand: "2026-01-01T21:00:00.000Z" }],
        posteLe: "2026-01-01T20:00:00.000Z",
        medias: [
          {
            fichier: "medias/abc.jpg",
            mime: "image/jpeg",
            genre: "photo",
            largeur: 100,
            hauteur: 100,
            duree: null,
            legende: "Une photo de sauvegarde",
          },
        ],
        audio: null,
      },
      {
        jour: "2026-01-02",
        qui: "Inconnue",
        joie: 5,
        titre: "Journée de quelqu'un d'autre",
        note: null,
        declencheurs: [],
        etiquettes: [],
        energie: null,
        calme: null,
        photos: 0,
        vocal: false,
        reactions: [],
        commentaires: [],
        posteLe: "2026-01-02T20:00:00.000Z",
        medias: [],
        audio: null,
      },
    ],
  };

  const archive = ecrireZip([
    { nom: "journal.json", octets: new TextEncoder().encode(JSON.stringify(journal)) },
    { nom: "medias/abc.jpg", octets: photo },
  ]);

  await aller(page, "/reglages");
  // Le champ natif est caché derrière son libellé : c'est le seul moyen
  // d'avoir un bouton en français. `setInputFiles` s'en accommode.
  const champ = page.getByLabel("Choisir un fichier");
  await champ.setInputFiles({
    name: "sauvegarde.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });

  const rapport = page.getByRole("status").filter({ hasText: /journée/i });
  await expect(rapport).toBeVisible({ timeout: 30_000 });
  await expect(rapport).toContainText("1 journée remise en place");
  await expect(rapport).toContainText(/1 photo/i);
  await expect(rapport).toContainText(/1 commentaire/i);
  // Le pseudo qu'on n'a pas su placer est DIT, pas deviné.
  await expect(rapport).toContainText(/Inconnue/);

  // La journée est vraiment là, photo comprise.
  await aller(page, "/jour/2026-01-01");
  await expect(page.getByText("Le premier jour")).toBeVisible();
  await expect(page.getByText("Retrouvé dans une sauvegarde.")).toBeVisible();

  // La même sauvegarde une deuxième fois : rien n'est écrasé, rien n'est doublé.
  await aller(page, "/reglages");
  await page.getByLabel("Choisir un fichier").setInputFiles({
    name: "sauvegarde.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });
  const deuxieme = page.getByRole("status").filter({ hasText: /déjà/i });
  await expect(deuxieme).toBeVisible({ timeout: 30_000 });
  await expect(deuxieme).toContainText(/tout y était déjà/i);

  await aller(page, "/reglages");
  await page.getByText("Quitter la bande", { exact: true }).click();
  await page.locator("#confirmation").fill(nom);
  await page.getByRole("button", { name: /partir pour de bon/i }).click();
  await page.waitForURL(/\/bienvenue/);
});

/**
 * Q7 — les nouveautés.
 *
 * Elles sont refermées par `passerLesNouveautes` dans tous les autres tests,
 * pour que le voile n'intercepte pas les clics. Ici, on les regarde vraiment :
 * sinon on aurait un produit qui affiche un écran que personne n'a jamais
 * éprouvé, et un helper qui cache un bogue au lieu de contourner un voile.
 */
test("les nouveautés s'ouvrent une fois, défilent, et ne reviennent pas", async ({ browser }) => {
  const page = await nouveauTelephone(browser);
  await page.goto("/reprendre");
  await page.fill("#reprise", codeLu("Momo"));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
  // Surtout PAS `passerLesNouveautes` ici : c'est le seul test qui les
  // regarde, et le helper les refermerait avant qu'on ait rien vu.

  const feuille = page.getByRole("dialog", { name: "Les nouveautés" });
  await expect(feuille).toBeVisible({ timeout: 15_000 });
  await expect(feuille.getByRole("heading").first()).toBeVisible();

  // Cinq écrans, cinq pastilles, et un bouton qui change de mot au dernier.
  const defilant = feuille.locator("div").first();
  await expect(feuille.getByRole("button", { name: "Passer" })).toBeVisible();
  await defilant.evaluate((element) => {
    element.scrollTo({ left: element.scrollWidth });
  });
  await expect(feuille.getByRole("button", { name: /c'est parti/i })).toBeVisible({
    timeout: 10_000,
  });

  await feuille.getByRole("button", { name: /c'est parti/i }).click();
  await expect(feuille).toBeHidden();

  // Et au rechargement, plus rien : c'est une fois par version, pas une fois
  // par ouverture.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Le fil" })).toBeVisible();
  await expect(feuille).toBeHidden();
});

/**
 * Le réveil du matin — les deux dettes que les notifications débloquaient.
 *
 * On ne peut pas éprouver ici qu'une notification ARRIVE : ce WebKit n'a pas
 * `PushManager` (mesuré), et de toute façon il faudrait un service de pousse.
 * Ce qui s'éprouve, et qui est le plus important : que la route **refuse** tout
 * le monde sans le secret. Une route de réveil ouverte laisserait n'importe qui
 * faire sonner trois téléphones à trois heures du matin.
 */
test("le réveil du matin ne s'ouvre pas sans son secret", async ({ page }) => {
  await entrer(page, "Momo");

  // Une session valide ne suffit PAS : ce n'est pas une route de l'application,
  // c'est une route du planificateur.
  expect((await page.request.get("/api/reveil")).status()).toBe(401);
  expect(
    (await page.request.get("/api/reveil", { headers: { authorization: "Bearer faux" } })).status(),
  ).toBe(401);

  // Et rien ne sort avec le refus.
  const refus = await page.request.get("/api/reveil");
  expect((await refus.body()).byteLength).toBeLessThan(200);
});
