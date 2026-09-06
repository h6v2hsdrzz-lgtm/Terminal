import { expect, test } from "@playwright/test";

import { join } from "node:path";

import { imageFactice } from "../prisma/image-factice";

/**
 * Le test de fumée : une bande neuve, tout le rituel, puis on efface.
 *
 * Il ne dépend d'aucune base peuplée et ne touche à aucune donnée existante :
 * il crée sa propre bande, y travaille, puis la quitte — et le dernier membre
 * qui part emporte le groupe avec lui. C'est ce qui le rend exécutable contre
 * la production sans rien y abîmer :
 *
 *   ADRESSE=https://journal-de-joie-v2.vercel.app npx playwright test e2e/production
 *
 * Ce qu'il ne couvre pas : l'enregistrement au micro et à la caméra. Ils
 * demandent du vrai matériel, et le WebKit de Playwright n'a même pas
 * `MediaRecorder`. Le stockage et la lecture du son sont éprouvés par
 * `lot1.spec.ts` sur la base locale, et la route qui le sert est vérifiée ici —
 * elle doit refuser sans session.
 */

/**
 * Une vraie image, engendrée par l'encodeur PNG du dépôt.
 *
 * La première version portait un PNG de 2×2 écrit à la main en base64. WebKit
 * l'acceptait, Chromium le refusait : « the source image could not be decoded ».
 * Un fichier d'essai qui n'est pas un vrai fichier ne teste rien — autant se
 * servir de l'encodeur qui peuple déjà la base de démonstration.
 */
const PNG = Buffer.from(imageFactice(64, 48, [210, 120, 90]));

test("une bande neuve, de bout en bout, puis effacée", async ({ page, request }) => {
  page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
  // Un nom unique : deux exécutions simultanées ne doivent pas se gêner, et un
  // nom fixe finirait par laisser des bandes fantômes si le test s'interrompt.
  const nomBande = `Fumée ${Date.now().toString(36)}`;

  await page.goto("/bienvenue/creer");
  await page.fill("#bande", nomBande);
  await page.fill("#pseudo", "Testeur");
  await page.getByRole("button", { name: /créer/i }).click();

  // L'écran du code de reprise : on le note et on entre.
  await page.waitForURL(/\/bienvenue\/code/);
  await page.getByRole("button", { name: /c'est noté/i }).click();
  await page.waitForURL("/");

  // ── La figure du jour, avant d'avoir rien posé ─────────────────────────
  await expect(
    page.getByRole("img", { name: /figure du jour|Personne n'a encore posé/i }).first(),
  ).toBeVisible();

  // ── Le check-in enrichi ────────────────────────────────────────────────
  await page.fill("#titre", "Premier jour");
  await page.fill("#note", "On essaie tout.");

  const lieux = page.getByLabel("Ajouter un lieu");
  await lieux.fill("Essai");
  await lieux.press("Enter");

  await page.getByText("Énergie et calme").click();
  await page.locator("#energie").fill("8");
  await page.locator("#calme").fill("3");

  await page.getByRole("button", { name: /poser ma joie/i }).click();
  await expect(page.getByText("C'est posé pour aujourd'hui.")).toBeVisible();

  // Le serveur a bien écrit : on recharge plutôt que de croire l'écran.
  await page.reload();
  await expect(page.getByText("Premier jour").first()).toBeVisible();
  await expect(page.getByText("Essai", { exact: true }).first()).toBeVisible();

  // ── Une photo ──────────────────────────────────────────────────────────
  await page.setInputFiles('input[type="file"][accept="image/*,video/*"]', {
    name: "essai.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  const image = page.locator('img[src^="/api/vignette/"]').first();
  await expect(image).toBeVisible({ timeout: 20_000 });

  // Elle se sert vraiment, et pas à n'importe qui. On demande l'original :
  // c'est lui qui compte pour le contrôle d'accès.
  const adressePhoto = (await image.getAttribute("src"))!.replace("/api/vignette/", "/api/photo/");
  const servie = await page.request.get(adressePhoto);
  expect(servie.status()).toBe(200);
  expect(servie.headers()["content-type"]).toMatch(/^image\//);
  // `request` est un contexte neuf, sans les cookies de la page.
  expect((await request.get(new URL(adressePhoto, page.url()).href)).status()).toBe(401);

  // ── Une vidéo, réencodée sur place et envoyée ──────────────────────────
  //
  // C'est la vérification qui compte le plus de cette liste : le réencodage
  // fait tout le travail dans le navigateur, et rien de ce qui se passe en
  // local ne garantit qu'il traverse le réseau et la base de production.
  await page.addScriptTag({
    path: join(process.cwd(), "node_modules", "mp4-muxer", "build", "mp4-muxer.js"),
  });
  const clip = await page.evaluate(async () => {
    const { Muxer, ArrayBufferTarget } = (window as unknown as {
      Mp4Muxer: typeof import("mp4-muxer");
    }).Mp4Muxer;
    const cote = 240, ips = 24, total = 48;
    const muxeur = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: cote, height: cote },
      fastStart: "in-memory",
    });
    const enc = new VideoEncoder({
      output: (c, m) => muxeur.addVideoChunk(c, m),
      error: (e) => { throw e; },
    });
    enc.configure({ codec: "avc1.42001f", width: cote, height: cote, bitrate: 400_000, framerate: ips });
    const toile = document.createElement("canvas");
    toile.width = cote; toile.height = cote;
    const ctx = toile.getContext("2d")!;
    for (let i = 0; i < total; i += 1) {
      ctx.fillStyle = `hsl(${(i * 360) / total} 65% 50%)`;
      ctx.fillRect(0, 0, cote, cote);
      const image = new VideoFrame(toile, {
        timestamp: Math.round((i * 1e6) / ips),
        duration: Math.round(1e6 / ips),
      });
      enc.encode(image, { keyFrame: i === 0 });
      image.close();
    }
    await enc.flush();
    enc.close();
    muxeur.finalize();
    return [...new Uint8Array((muxeur.target as InstanceType<typeof ArrayBufferTarget>).buffer)];
  });

  await page.setInputFiles('input[type="file"][accept="image/*,video/*"]', {
    name: "clip.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from(clip),
  });

  // La pastille de durée n'apparaît que pour le genre « video » : elle prouve
  // que le serveur a rangé une vidéo, et pas une image.
  await expect(page.getByText(/▶\s*\d+ s/).first()).toBeVisible({ timeout: 90_000 });

  await page.reload();
  // La tuile vidéo se reconnaît à sa pastille, pas à sa position : la journée
  // est aussi affichée plus bas dans le fil, et compter les vignettes de la
  // page entière donnerait un nombre qui dépend de la mise en page.
  const tuileVideo = page.locator("li").filter({ hasText: /▶\s*\d+ s/ }).first();
  await expect(tuileVideo).toBeVisible();

  // Le fichier stocké est bien une vidéo, et bien réduite.
  const adresseClip = (await tuileVideo.locator("img").first().getAttribute("src"))!
    .replace("/api/vignette/", "/api/photo/");
  const servieVideo = await page.request.get(adresseClip);
  expect(servieVideo.status()).toBe(200);
  expect(servieVideo.headers()["content-type"]).toMatch(/^video\//);
  expect((await servieVideo.body()).byteLength).toBeLessThan(4 * 1024 * 1024);

  // ── La route du vocal existe et se garde ───────────────────────────────
  expect((await request.get(new URL("/api/audio/inexistant", page.url()).href)).status()).toBe(401);

  // ── Les autres écrans tiennent debout avec une seule journée ───────────
  for (const chemin of ["/fil", "/stats", "/souvenirs", "/profil"]) {
    await page.goto(chemin, { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: "Souvenirs" }).first()).toBeVisible();
    const debordement = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(debordement, `${chemin} déborde`).toBeLessThanOrEqual(1);
  }

  // ── On efface : le dernier membre qui part emporte la bande ────────────
  await page.goto("/reglages", { waitUntil: "networkidle" });
  await page.getByText("Quitter la bande", { exact: true }).click();
  // Le nom se recopie à la main : un bouton se clique par erreur, pas une phrase.
  await page.locator("#confirmation").fill(nomBande);
  await page.getByRole("button", { name: /partir pour de bon/i }).click();

  await page.waitForURL(/\/bienvenue/);
  // Et la session est bien fermée : revenir à l'accueil renvoie au portail.
  await page.goto("/");
  await page.waitForURL(/\/bienvenue/);
});
