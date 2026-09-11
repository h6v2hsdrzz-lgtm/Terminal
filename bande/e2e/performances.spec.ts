import { expect, test, type Page } from "@playwright/test";

import { aller, entrer } from "./aide-jeux";
import { MEDIAS_PAR_PAGE } from "../src/lib/media";

/**
 * Q6 — les performances, mesurées plutôt que promises.
 *
 * ## Pourquoi pas Lighthouse
 *
 * Parce qu'il n'est pas installé ici, et surtout parce qu'il mesurerait le
 * serveur de DÉVELOPPEMENT : pas de minification, pas de découpage de paquets,
 * une recompilation à la première visite de chaque route. Un score de 40 en
 * développement ne dit rien d'un score en production, et un score de 90 encore
 * moins. Lancer Lighthouse contre l'adresse en ligne reste à faire à la main,
 * et c'est écrit dans `ETAT.md`.
 *
 * ## Ce qui SE mesure ici, et qui ne dépend pas du mode
 *
 * · **le décalage de mise en page** (CLS). Il vient des images sans dimensions,
 *   des polices qui poussent le texte, des blocs qui apparaissent au-dessus de
 *   ce qu'on lit. Rien de tout ça ne change entre développement et production ;
 * · **la taille du document**. Mille éléments dans une liste, c'est mille
 *   éléments dans les deux modes ;
 * · **les dimensions déclarées des images**, qui sont la cause numéro un du
 *   premier point.
 */
const CLS_MAXIMAL = 0.1;

/**
 * Le décalage cumulé, mesuré comme le fait Lighthouse : la somme des décalages
 * qui n'ont pas suivi une interaction.
 *
 * L'observateur est posé **avant** la navigation, sinon on rate exactement les
 * décalages qui comptent : ceux du premier rendu.
 */
async function decalage(page: Page, adresse: string): Promise<number> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((liste) => {
      for (const entree of liste.getEntries()) {
        const decalage = entree as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!decalage.hadRecentInput) {
          (window as unknown as { __cls: number }).__cls += decalage.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto(adresse, { waitUntil: "networkidle" });
  // Les images arrivent après le réseau « au repos » sur un écran qui en porte
  // beaucoup : on laisse le temps aux dernières de se poser.
  await page.waitForTimeout(1500);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

test("les écrans ne sautent pas sous les doigts", async ({ page }) => {
  test.slow();
  await entrer(page, "Momo");

  for (const adresse of ["/", "/galerie", "/profil", "/souvenirs"]) {
    const mesure = await decalage(page, adresse);
    expect(mesure, `${adresse} décale de ${mesure.toFixed(3)}`).toBeLessThan(CLS_MAXIMAL);
  }
});

test("chaque image annonce sa taille avant d'arriver", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/galerie", { waitUntil: "networkidle" });

  // Une image sans dimensions déclarées occupe zéro pixel jusqu'à son
  // chargement, puis pousse tout ce qui la suit. C'est la première cause de
  // décalage, et elle se vérifie sans rien mesurer.
  const sansTaille = await page.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((image) => !image.getAttribute("width") || !image.getAttribute("height"))
      .map((image) => image.getAttribute("src") ?? "(sans source)"),
  );
  expect(sansTaille).toEqual([]);
});

test("la galerie ne dépose pas mille vignettes d'un coup", async ({ page }) => {
  test.slow();
  await entrer(page, "Momo");
  await page.goto("/galerie", { waitUntil: "networkidle" });

  const premiere = await page.locator("img").count();
  expect(premiere).toBeLessThanOrEqual(MEDIAS_PAR_PAGE + 10);

  // « Voir plus » ajoute UNE page, jamais tout le reste. Avec la bande de
  // démonstration la différence ne se voit pas — cent cinquante-huit médias
  // tiennent sous la borne des deux pages — alors la vraie preuve est en
  // Vitest (`borneGalerie`, éprouvée à cinq mille). Ici on vérifie que le
  // chemin existe et qu'il passe bien par une page.
  const suite = page.getByRole("link", { name: /de plus/i }).first();
  if (await suite.isVisible().catch(() => false)) {
    expect(await suite.getAttribute("href")).toMatch(/\/galerie\?page=\d+$/);
    await suite.click();
    // Attendre l'adresse AVANT de repartir : une navigation lancée pendant
    // qu'une autre se termine est annulée par Playwright, et c'est un piège
    // déjà payé deux fois dans cette suite.
    await page.waitForURL(/\/galerie\?page=\d+/);
    await page.waitForLoadState("networkidle");
    const apres = await page.locator("img").count();
    expect(apres - premiere).toBeLessThanOrEqual(MEDIAS_PAR_PAGE);
  }

  // Et l'adresse tapée à la main ne redevient pas « tout charger ».
  await aller(page, "/galerie?page=99999");
  await expect(page.getByRole("heading", { name: "La galerie" })).toBeVisible();
});
