import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * L'audit technique du plan, sa partie la plus importante : **essayer vraiment
 * d'atteindre les données d'une autre bande, et prouver que ça échoue**.
 *
 * Le plan supposait Supabase et sa RLS ; ici l'autorisation est côté serveur,
 * ce qui veut dire qu'elle est écrite à la main dans chaque route et chaque
 * fonction de dépôt — donc qu'elle peut être oubliée. Un test qui vérifie
 * seulement qu'une page s'affiche ne le verrait jamais.
 *
 * L'attaquant a **une vraie session valide**, celle d'une autre bande. C'est le
 * cas dangereux : sans session, tout refuse déjà ; avec une session d'ailleurs,
 * il faut que chaque lecture ait pensé à filtrer par `groupeId`.
 *
 * La bande visée est celle de démonstration (`npm run db:seed`), qui a du
 * contenu de chaque sorte. La bande attaquante est créée pour l'occasion et
 * repart à la fin — le dernier membre qui quitte emporte le groupe.
 */
function codeDe(pseudo: string): string {
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const ligne = fiche.split("\n").find((l) => l.startsWith(pseudo));
  if (!ligne) throw new Error(`Pas de code pour ${pseudo} — lance « npm run db:seed ».`);
  return ligne.split(/\s+/)[1];
}

async function quitter(page: Page, nom: string) {
  await page.goto("/reglages", { waitUntil: "domcontentloaded" });
  await page.getByText("Quitter la bande", { exact: true }).click();
  await page.locator("#confirmation").fill(nom);
  await page.getByRole("button", { name: /partir pour de bon/i }).click();
  await page.waitForURL(/\/bienvenue/);
}

test("une bande ne peut rien lire d'une autre, même avec une session valide", async ({
  browser,
  request,
}) => {
  // Deux navigateurs, une bande de démonstration lourde et une bande créée de
  // zéro : c'est long, et c'est le prix d'un test qui attaque pour de vrai.
  test.slow();
  const nomIntrus = `Cloison ${Date.now().toString(36)}`;

  // Deux contextes : deux cookies, aucun partage.
  const contexteCible: BrowserContext = await browser.newContext();
  const contexteIntrus: BrowserContext = await browser.newContext();
  const cible = await contexteCible.newPage();
  const intrus = await contexteIntrus.newPage();

  try {
    // ── La bande visée : ses adresses privées ─────────────────────────────
    await cible.goto("/reprendre");
    await cible.fill("#reprise", codeDe("Momo"));
    await cible.getByRole("button", { name: /reconnecter/i }).click();
    await cible.waitForURL("/");

    await cible.goto("/", { waitUntil: "domcontentloaded" });
    const premiereVignette = cible.locator('img[src^="/api/vignette/"]').first();
    await premiereVignette.waitFor({ state: "attached" });
    const vignette = (await premiereVignette.getAttribute("src"))!;
    expect(vignette, "la bande de démonstration doit avoir un média").toBeTruthy();

    await cible.goto("/souvenirs", { waitUntil: "domcontentloaded" });
    /**
     * Les deux adresses facultatives.
     *
     * `getAttribute` ATTEND que l'élément existe, et l'attente est bornée par
     * le délai du test entier : un `.catch(() => null)` sur un locator absent
     * ne rend pas `null`, il bloque trois minutes. On compte d'abord.
     */
    const premier = async (selecteur: string) => {
      const noeud = cible.locator(selecteur).first();
      return (await noeud.count()) > 0 ? noeud.getAttribute("src") : null;
    };
    const apercu = await premier('img[src^="/api/scelle/"]');
    const avatar = await premier('img[src^="/api/avatar/"]');

    // Une partie en cours, pour éprouver aussi l'écran de jeu.
    await cible.goto("/jeux", { waitUntil: "domcontentloaded" });
    const reprendre = cible.getByRole("link", { name: "Reprendre" });
    if (!(await reprendre.isVisible().catch(() => false))) {
      await cible.getByRole("button", { name: /Je n'ai jamais/ }).first().click();
      await cible.getByRole("button", { name: /^Lancer Je n'ai jamais$/ }).click();
    } else {
      await reprendre.click();
    }
    await cible.waitForURL(/\/jeux\/.+/);
    const adressePartie = new URL(cible.url()).pathname;

    const privees = [
      vignette,
      vignette.replace("/api/vignette/", "/api/photo/"),
      apercu,
      apercu?.replace(/\/apercu$/, "") ?? null,
      avatar,
    ].filter((c): c is string => typeof c === "string" && c.length > 0);
    expect(privees.length).toBeGreaterThanOrEqual(3);

    // ── L'intrus : une bande à lui, une session parfaitement valide ───────
    await intrus.goto("/bienvenue/creer");
    await intrus.fill("#bande", nomIntrus);
    await intrus.fill("#pseudo", "Curieux");
    await intrus.getByRole("button", { name: /créer/i }).click();
    await intrus.waitForURL(/\/bienvenue\/code/);
    await intrus.getByRole("button", { name: /c'est noté/i }).click();
    await intrus.waitForURL("/");

    for (const adresse of privees) {
      const avecSession = await intrus.request.get(adresse);
      expect(avecSession.status(), `${adresse} servie à une autre bande`).toBeGreaterThanOrEqual(400);
      // Et rien ne sort avec l'erreur : un refus qui rend les octets ne refuse rien.
      expect((await avecSession.body()).byteLength, `${adresse} a rendu des octets`).toBeLessThan(200);

      // `request` est un contexte neuf, sans cookie : le cas sans session.
      const anonyme = await request.get(new URL(adresse, intrus.url()).href);
      expect(anonyme.status(), `${adresse} servie sans session`).toBeGreaterThanOrEqual(400);
    }

    // L'écran d'une partie d'une autre bande : **introuvable**, pas « interdit ».
    // La différence dirait qu'elle existe.
    await intrus.goto(adressePartie);
    await expect(intrus.getByRole("heading", { name: "Introuvable" })).toBeVisible();

    // Le fil de l'intrus est vide : aucune journée de la bande visée.
    await intrus.goto("/", { waitUntil: "domcontentloaded" });
    await expect(intrus.getByText("Momo")).toHaveCount(0);

    // Et son export n'emporte que ses propres lignes.
    const csv = await intrus.request.get("/api/export");
    expect(csv.status()).toBe(200);
    const texte = await csv.text();
    expect(texte).not.toContain("Momo");
    expect(texte).not.toContain("Samy");
  } finally {
    await quitter(intrus, nomIntrus).catch(() => {});
    await contexteCible.close();
    await contexteIntrus.close();
  }
});
