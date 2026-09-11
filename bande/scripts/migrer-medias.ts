/**
 * Déménager les octets de PostgreSQL vers Cloudflare R2.
 *
 *   npx tsx scripts/migrer-medias.ts            # migre ce qui reste
 *   npx tsx scripts/migrer-medias.ts --verifier # ne migre rien, contrôle tout
 *   npx tsx scripts/migrer-medias.ts --limite 50
 *   npx tsx scripts/migrer-medias.ts --garder   # migre sans vider la base
 *
 * Trois règles, et elles viennent toutes de la même peur : perdre une photo.
 *
 * 1. **On vérifie avant de vider.** Chaque objet écrit est relu depuis R2 et
 *    son empreinte SHA-256 comparée à celle des octets d'origine. Tant que les
 *    deux ne coïncident pas, la colonne `octets` ne bouge pas.
 * 2. **Une ligne à la fois, et c'est reprenable.** Le script peut être coupé
 *    à n'importe quel moment : ce qui est fait est marqué par sa clé, le reste
 *    sera repris au prochain passage. Rien n'est global, rien n'est atomique.
 * 3. **`--garder` existe pour le premier passage.** On migre, on vérifie, on
 *    laisse les octets en base, on vit avec pendant quelques jours, et on
 *    repasse pour libérer la place seulement quand R2 a fait ses preuves.
 */
import { createHash } from "node:crypto";

import { prisma } from "../src/lib/db";
import { cleAudio, cleMedia } from "../src/lib/stockage/cles";
import { configurationR2, ecrireR2, lireR2 } from "../src/lib/stockage/r2";

const arguments_ = process.argv.slice(2);
const VERIFIER = arguments_.includes("--verifier");
const GARDER = arguments_.includes("--garder");
const LIMITE = Number(arguments_[arguments_.indexOf("--limite") + 1]) || Infinity;

const empreinte = (octets: Uint8Array) =>
  createHash("sha256").update(octets).digest("hex");

function poids(octets: number): string {
  return octets > 1_048_576
    ? `${(octets / 1_048_576).toFixed(1)} Mo`
    : `${Math.round(octets / 1024)} Ko`;
}

const config = configurationR2();
if (!config) {
  console.error(
    "Rien à faire : R2_COMPTE, R2_SEAU, R2_CLE et R2_SECRET ne sont pas tous là.\n" +
      "C'est volontaire — sans ces quatre valeurs, l'application garde les octets\n" +
      "en base, et ce script n'a pas d'endroit où les mettre.",
  );
  process.exit(1);
}

let deplaces = 0;
let verifies = 0;
let octetsLiberes = 0;
const echecs: string[] = [];

/** Écrit un objet, le relit, compare. Rend vrai quand tout concorde. */
async function deposer(cle: string, octets: Uint8Array, mime: string): Promise<boolean> {
  await ecrireR2(config!, cle, octets, mime);
  const relu = await lireR2(config!, cle);
  if (!relu || empreinte(relu) !== empreinte(octets)) {
    echecs.push(`${cle} — relecture différente de l'original`);
    return false;
  }
  return true;
}

/** Contrôle qu'un objet déjà migré est toujours là et toujours intact. */
async function controler(cle: string, attendue: string | null): Promise<void> {
  const relu = await lireR2(config!, cle);
  if (!relu) {
    echecs.push(`${cle} — absent du seau`);
    return;
  }
  if (attendue && empreinte(relu) !== attendue) {
    echecs.push(`${cle} — empreinte différente de celle de la base`);
    return;
  }
  verifies += 1;
}

async function migrerMedias() {
  const lignes = await prisma.media.findMany({
    where: VERIFIER ? { cle: { not: null } } : { octets: { not: null }, cle: null },
    select: { id: true, mime: true, octets: true, vignette: true, cle: true, cleVignette: true },
    orderBy: { creeLe: "asc" },
    take: Number.isFinite(LIMITE) ? LIMITE : undefined,
  });

  console.log(`${lignes.length} média${lignes.length > 1 ? "s" : ""} à traiter.`);

  for (const ligne of lignes) {
    if (VERIFIER) {
      if (ligne.cle) await controler(ligne.cle, ligne.octets ? empreinte(ligne.octets) : null);
      if (ligne.cleVignette) {
        await controler(ligne.cleVignette, ligne.vignette ? empreinte(ligne.vignette) : null);
      }
      continue;
    }

    if (!ligne.octets) continue;
    const cle = cleMedia(ligne.id);
    if (!(await deposer(cle, ligne.octets, ligne.mime))) continue;

    let cleVignette: string | null = null;
    if (ligne.vignette) {
      const c = cleMedia(ligne.id, true);
      cleVignette = (await deposer(c, ligne.vignette, "image/jpeg")) ? c : null;
      if (!cleVignette) continue;
    }

    await prisma.media.update({
      where: { id: ligne.id },
      data: {
        cle,
        cleVignette,
        // C'est ici, et seulement ici, que la place se libère — après l'écriture
        // ET la relecture.
        ...(GARDER ? {} : { octets: null, vignette: null }),
      },
    });

    deplaces += 1;
    if (!GARDER) octetsLiberes += ligne.octets.byteLength + (ligne.vignette?.byteLength ?? 0);
    if (deplaces % 25 === 0) console.log(`  … ${deplaces} déplacés`);
  }
}

async function migrerAudios() {
  const lignes = await prisma.audio.findMany({
    where: VERIFIER ? { cle: { not: null } } : { octets: { not: null }, cle: null },
    select: { entreeId: true, mime: true, octets: true, cle: true },
    orderBy: { creeLe: "asc" },
    take: Number.isFinite(LIMITE) ? LIMITE : undefined,
  });

  console.log(`${lignes.length} son${lignes.length > 1 ? "s" : ""} à traiter.`);

  for (const ligne of lignes) {
    if (VERIFIER) {
      if (ligne.cle) await controler(ligne.cle, ligne.octets ? empreinte(ligne.octets) : null);
      continue;
    }
    if (!ligne.octets) continue;

    const cle = cleAudio(ligne.entreeId);
    if (!(await deposer(cle, ligne.octets, ligne.mime))) continue;

    await prisma.audio.update({
      where: { entreeId: ligne.entreeId },
      data: { cle, ...(GARDER ? {} : { octets: null }) },
    });
    deplaces += 1;
    if (!GARDER) octetsLiberes += ligne.octets.byteLength;
  }
}

async function principal() {
  console.log(
    VERIFIER
      ? `Contrôle du seau « ${config!.seau} ».`
      : `Déménagement vers le seau « ${config!.seau} »${GARDER ? " (sans vider la base)" : ""}.`,
  );

  await migrerMedias();
  await migrerAudios();

  console.log("");
  if (VERIFIER) {
    console.log(`${verifies} objet${verifies > 1 ? "s" : ""} relu${verifies > 1 ? "s" : ""} et conforme${verifies > 1 ? "s" : ""}.`);
  } else {
    console.log(`${deplaces} déplacé${deplaces > 1 ? "s" : ""}, ${poids(octetsLiberes)} libéré${octetsLiberes > 1 ? "s" : ""} en base.`);
  }

  if (echecs.length > 0) {
    console.error(`\n${echecs.length} problème${echecs.length > 1 ? "s" : ""} :`);
    for (const e of echecs) console.error(`  · ${e}`);
    console.error("\nRien n'a été effacé pour ces objets-là. Relance après avoir corrigé.");
    process.exitCode = 1;
  }
}

principal()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
