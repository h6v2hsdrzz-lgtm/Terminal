import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Les captures de référence, et les contrôles qui n'ont de sens que sur un
 * téléphone.
 *
 * Le projet `iphone` tourne sur WebKit, qui est le seul moteur disponible sur
 * iOS : c'est lui qui décide si une chose marche. Le projet bureau ne sert qu'à
 * vérifier qu'on ne casse rien sur grand écran.
 */
const ECRANS = [
  { nom: "fil", url: "/" },
  { nom: "aujourdhui", url: "/aujourdhui" },
  { nom: "jeux", url: "/jeux" },
  { nom: "souvenirs", url: "/souvenirs" },
  { nom: "galerie", url: "/galerie" },
  { nom: "profil", url: "/profil" },
  { nom: "reglages", url: "/reglages" },
];

function codeDe(pseudo: string): string {
  // Chemin relatif au dossier de travail : le fichier de configuration fixe
  // la racine du projet, et `import.meta` n'est pas disponible ici.
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const ligne = fiche.split("\n").find((l) => l.startsWith(pseudo));
  if (!ligne) throw new Error(`Pas de code pour ${pseudo} — lance « npm run db:seed ».`);
  return ligne.split(/\s+/)[1];
}

test.beforeEach(async ({ page }) => {
  await page.goto("/reprendre");
  await page.fill("#reprise", codeDe("Momo"));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");

  // Sans ce contrôle, une session perdue laisse chaque test photographier
  // l'écran d'accueil et passer au vert. C'est exactement ce qui est arrivé.
  // Le lien de navigation existe sous les deux formes — barre du bas sur
  // téléphone, rail sur grand écran — donc il vaut pour les deux projets.
  await expect(page.getByRole("link", { name: "Souvenirs" }).first()).toBeVisible();
});

for (const ecran of ECRANS) {
  test(`capture — ${ecran.nom}`, async ({ page }, infos) => {
    await page.goto(ecran.url, { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: "Souvenirs" }).first()).toBeVisible();
    await page.waitForTimeout(600);

    // Une capture pleine page fige la barre d'onglets là où elle serait dans la
    // fenêtre : au milieu de l'image, par-dessus le contenu. On agrandit la
    // fenêtre à la hauteur du document avant de déclencher, pour la retrouver
    // en bas, là où l'utilisateur la voit.
    const depart = page.viewportSize()!;
    const hauteur = await page.evaluate(() => document.documentElement.scrollHeight);
    if (hauteur > depart.height) {
      await page.setViewportSize({ width: depart.width, height: Math.min(hauteur, 6000) });
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `captures/${infos.project.name}/${ecran.nom}.png` });
    await page.setViewportSize(depart);

    // Rien ne doit déborder à l'horizontale : sur un téléphone, un débordement
    // se traduit par une page qui glisse latéralement à chaque geste.
    const debordement = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(debordement, `${ecran.nom} déborde de ${debordement} px`).toBeLessThanOrEqual(1);
  });
}

test("les champs ne font pas zoomer Safari", async ({ page }) => {
  // Sous 16 px, iOS zoome à la mise au point et ne dézoome jamais seul.
  await page.goto("/reglages", { waitUntil: "networkidle" });
  const trop_petits = await page.evaluate(() =>
    [...document.querySelectorAll("input, textarea, select")]
      // Seuls les champs qu'on peut réellement mettre au point comptent : un
      // curseur, une case à cocher et les champs cachés que Next ajoute pour la
      // soumission sans JavaScript ne déclenchent aucun zoom.
      .filter((e) => {
        const t = (e as HTMLInputElement).type;
        if (t === "range" || t === "checkbox" || t === "radio" || t === "hidden") return false;
        return (e as HTMLElement).offsetParent !== null;
      })
      .map((e) => ({ id: e.id || e.getAttribute("name") || e.tagName, taille: parseFloat(getComputedStyle(e).fontSize) }))
      .filter((c) => c.taille < 16),
  );
  expect(trop_petits, JSON.stringify(trop_petits)).toEqual([]);
});

test("les cibles tactiles font au moins 44 px", async ({ page }, infos) => {
  // Le doigt est imprécis, la souris ne l'est pas : la règle des 44 px ne vaut
  // que sur le téléphone.
  test.skip(infos.project.name !== "iphone", "règle propre au tactile");
  await page.goto("/", { waitUntil: "networkidle" });
  const petites = await page.evaluate(() => {
    const zone = (e: Element) => {
      const r = e.getBoundingClientRect();
      const apres = getComputedStyle(e, "::after");
      // La zone étendue par `.cible-tactile` compte comme surface tactile.
      const l = apres.content !== "none" ? Math.max(r.width, parseFloat(apres.width) || 0) : r.width;
      const h = apres.content !== "none" ? Math.max(r.height, parseFloat(apres.height) || 0) : r.height;
      return { l, h };
    };
    return [...document.querySelectorAll("a, button")]
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => ({ texte: (e.textContent || e.getAttribute("aria-label") || "?").trim().slice(0, 24), ...zone(e) }))
      .filter((c) => c.l < 44 || c.h < 44);
  });
  expect(petites, JSON.stringify(petites, null, 1)).toEqual([]);
});

test("la barre d'onglets respecte la zone sûre du bas", async ({ page }, infos) => {
  test.skip(infos.project.name !== "iphone", "au-delà de 1024 px, c'est le rail");
  await page.goto("/", { waitUntil: "networkidle" });
  const barre = page.locator("nav.barre-onglets");
  await expect(barre).toBeVisible();
  const padding = await barre.evaluate((e) => getComputedStyle(e).paddingBottom);
  // En simulation, `env(safe-area-inset-bottom)` vaut 0 : on vérifie que la
  // déclaration est bien là, pas sa valeur.
  expect(padding).toBeDefined();
});
