import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La vidéo, de bout en bout, dans le moteur qui décide.
 *
 * Le test fabrique une vraie vidéo H.264 avec WebCodecs, la dépose dans le
 * champ de fichier, et vérifie qu'elle traverse tout : réencodage, vignette,
 * envoi, stockage, service, lecture, galerie.
 *
 * Une réserve, et elle compte : le WebKit de Playwright n'est pas Safari sur
 * iPhone. Il n'a même pas `MediaRecorder`. Ce qu'il partage avec la cible, ce
 * sont WebCodecs, le décodage vidéo et la mise en page — soit tout ce que ce
 * test touche. Ce qu'il ne peut pas prouver, c'est le comportement du
 * sélecteur de fichiers d'iOS et de sa pellicule ; ça reste dans la liste des
 * vérifications à la main du README.
 */
function codeDe(pseudo: string): string {
  const fiche = readFileSync(join(process.cwd(), ".codes-demo.txt"), "utf8");
  const ligne = fiche.split("\n").find((l) => l.startsWith(pseudo));
  if (!ligne) throw new Error(`Pas de code pour ${pseudo} — lance « npm run db:seed ».`);
  return ligne.split(/\s+/)[1];
}

async function entrer(page: import("@playwright/test").Page, pseudo: string) {
  await page.goto("/reprendre");
  await page.fill("#reprise", codeDe(pseudo));
  await page.getByRole("button", { name: /reconnecter/i }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("link", { name: "Souvenirs" }).first()).toBeVisible();
}

async function ouvrirFormulaire(page: import("@playwright/test").Page) {
  const deja = page.getByRole("button", { name: /corriger ta journée/i });
  if (await deja.isVisible().catch(() => false)) await deja.click();
  await expect(page.locator("#titre")).toBeVisible();
}

/**
 * Fabrique un MP4 dans la page, avec les mêmes outils que l'application.
 *
 * On ne peut pas commiter un fichier binaire d'essai : autant le produire, et
 * ça éprouve au passage que WebCodecs répond comme attendu dans ce moteur.
 *
 * Le muxeur est injecté depuis `node_modules` sous forme de script classique :
 * un navigateur ne résout pas un nom de module nu comme « mp4-muxer », et le
 * paquet fournit justement une version qui pose un objet global.
 */
async function fabriquerVideo(
  page: import("@playwright/test").Page,
  secondes: number,
  cote = 240,
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  await page.addScriptTag({
    path: join(process.cwd(), "node_modules", "mp4-muxer", "build", "mp4-muxer.js"),
  });
  const octets = await page.evaluate(
    async ({ secondes, cote }) => {
      const { Muxer, ArrayBufferTarget } = (window as unknown as {
        Mp4Muxer: { Muxer: new (o: object) => never; ArrayBufferTarget: new () => never };
      }).Mp4Muxer as unknown as typeof import("mp4-muxer");
      const ips = 24;
      const muxeur = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: cote, height: cote },
        fastStart: "in-memory",
      });
      const enc = new VideoEncoder({
        output: (c, m) => muxeur.addVideoChunk(c, m),
        error: (e) => { throw e; },
      });
      enc.configure({ codec: "avc1.42001f", width: cote, height: cote, bitrate: 500_000, framerate: ips });

      const toile = document.createElement("canvas");
      toile.width = cote; toile.height = cote;
      const ctx = toile.getContext("2d")!;
      const total = Math.round(secondes * ips);
      for (let i = 0; i < total; i += 1) {
        ctx.fillStyle = `hsl(${(i * 360) / total} 65% 50%)`;
        ctx.fillRect(0, 0, cote, cote);
        const image = new VideoFrame(toile, {
          timestamp: Math.round((i * 1e6) / ips),
          duration: Math.round(1e6 / ips),
        });
        enc.encode(image, { keyFrame: i % (ips * 2) === 0 });
        image.close();
      }
      await enc.flush();
      enc.close();
      muxeur.finalize();
      return [...new Uint8Array((muxeur.target as InstanceType<typeof ArrayBufferTarget>).buffer)];
    },
    { secondes, cote },
  );
  return { name: "essai.mp4", mimeType: "video/mp4", buffer: Buffer.from(octets) };
}

test.describe.configure({ mode: "serial" });

// Le réencodage lit la vidéo à vitesse réelle : ces tests sont lents par nature.
test.setTimeout(180_000);

// Les erreurs du navigateur remontent dans la sortie du test : sans ça, un
// transcodage qui échoue se manifeste par une absence, ce qui n'apprend rien.
test.beforeEach(({ page }) => {
  page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
});

test("le moteur fabrique bien un MP4 lisible", async ({ page }) => {
  await entrer(page, "Momo");
  const video = await fabriquerVideo(page, 1.5);
  // Une vidéo d'une seconde et demie pèse quelques kilo-octets, pas zéro.
  expect(video.buffer.byteLength).toBeGreaterThan(2000);
  // La signature d'un MP4 : la boîte « ftyp » aux octets 4 à 8.
  expect(video.buffer.subarray(4, 8).toString("latin1")).toBe("ftyp");
});

test("une vidéo traverse tout : réencodage, vignette, envoi, lecture", async ({ page, request }) => {
  await entrer(page, "Samy");
  await ouvrirFormulaire(page);
  await page.fill("#titre", "Essai vidéo");
  await page.getByRole("button", { name: /poser ma joie|^Corriger$/i }).click();
  await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

  // Une vidéo plus longue que le plafond : elle doit être coupée à huit
  // secondes, pas refusée.
  const video = await fabriquerVideo(page, 10, 360);
  await page.setInputFiles('input[type="file"][accept="image/*,video/*"]', video);

  // Le réencodage lit la vidéo à vitesse normale : huit secondes au moins.
  const vignette = page.locator('img[src^="/api/vignette/"]').first();
  await expect(vignette).toBeVisible({ timeout: 60_000 });

  // La pastille de durée dit que le serveur a bien reçu une vidéo, et pas une
  // image : elle ne s'affiche que pour le genre « video ».
  await expect(page.getByText(/▶\s*\d+ s/).first()).toBeVisible();

  await page.reload();
  const apres = page.locator('img[src^="/api/vignette/"]').first();
  await expect(apres).toBeVisible();

  // ── La vignette et l'original se servent, et pas sans session ──────────
  const adresseVignette = await apres.getAttribute("src");
  const rVignette = await page.request.get(adresseVignette!);
  expect(rVignette.status()).toBe(200);
  expect(rVignette.headers()["content-type"]).toBe("image/jpeg");

  const adresseOriginale = adresseVignette!.replace("/api/vignette/", "/api/photo/");
  const rOriginal = await page.request.get(adresseOriginale);
  expect(rOriginal.status()).toBe(200);
  expect(rOriginal.headers()["content-type"]).toMatch(/^video\//);

  const octets = (await rOriginal.body()).byteLength;
  // Réduite, mais pas vide : dix secondes de couleurs pleines à 360 px.
  expect(octets).toBeGreaterThan(5_000);
  expect(octets).toBeLessThan(4 * 1024 * 1024);
  // Et la vignette pèse beaucoup moins que l'original — c'est toute sa raison.
  expect((await rVignette.body()).byteLength).toBeLessThan(octets);

  // `request` est un contexte neuf, sans les cookies de la page.
  const nu = new URL(adresseOriginale, page.url()).href;
  expect((await request.get(nu)).status()).toBe(401);
  expect((await request.get(new URL(adresseVignette!, page.url()).href)).status()).toBe(401);
});

test("la vidéo est lisible dans le fil, muette et en boucle", async ({ page }) => {
  await entrer(page, "Samy");
  await page.goto("/fil", { waitUntil: "networkidle" });

  const video = page.locator('video[src^="/api/photo/"]').first();
  await expect(video).toBeVisible();
  // Muette et `playsInline` : sans les deux, iOS refuse de lire sans geste et
  // bascule en plein écran au milieu du fil.
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.loop)).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.playsInline)).toBe(true);
  // `metadata` : sinon six vidéos se téléchargent dès l'apparition de la carte.
  expect(await video.evaluate((v: HTMLVideoElement) => v.preload)).toBe("metadata");

  // Le moteur sait vraiment la décoder — dimensions non nulles.
  const taille = await video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<{ l: number; h: number }>((ok) => {
        if (v.readyState >= 1) return ok({ l: v.videoWidth, h: v.videoHeight });
        v.onloadedmetadata = () => ok({ l: v.videoWidth, h: v.videoHeight });
        setTimeout(() => ok({ l: 0, h: 0 }), 15_000);
      }),
  );
  expect(taille.l, "la vidéo réencodée doit être décodable").toBeGreaterThan(0);
  // Ramenée sous le plafond de 720 px de côté long.
  expect(Math.max(taille.l, taille.h)).toBeLessThanOrEqual(720);
});

test("la galerie montre le média et l'ouvre en grand", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/galerie", { waitUntil: "networkidle" });

  const cases = page.locator('img[src^="/api/vignette/"]');
  expect(await cases.count()).toBeGreaterThan(0);

  await cases.first().click();
  const plein = page.getByRole("dialog", { name: /galerie de la bande/i });
  await expect(plein).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(plein).toBeHidden();
});

test("une légende se pose et se relit", async ({ page }) => {
  await entrer(page, "Samy");
  await ouvrirFormulaire(page);
  await page.getByRole("button", { name: /^Corriger$/ }).click();
  await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

  await page.getByRole("button", { name: "Légender" }).first().click();
  await page.locator("#legende").fill("Le test l'a filmé");
  await page.getByRole("button", { name: "Garder" }).click();

  await expect(page.getByText("Le test l'a filmé").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Le test l'a filmé").first()).toBeVisible();
});

test("la galerie est bornée, et le reste tient dans un lien", async ({ page }) => {
  await entrer(page, "Momo");
  await page.goto("/galerie", { waitUntil: "networkidle" });

  // Cent vingt cases au plus : la base de démonstration en a davantage, et un
  // document de plusieurs milliers de cases met le téléphone à genoux.
  const cases = page.locator('img[src^="/api/vignette/"]');
  const affichees = await cases.count();
  expect(affichees).toBeLessThanOrEqual(120);

  const reste = page.getByRole("link", { name: /Voir les \d+ plus ancien/ });
  await expect(reste).toBeVisible();

  // Le lien marche sans JavaScript : c'est une navigation, pas un bouton.
  await reste.click();
  await expect(page).toHaveURL(/tout=1/);
  expect(await cases.count()).toBeGreaterThan(affichees);
  await expect(reste).toHaveCount(0);
});
