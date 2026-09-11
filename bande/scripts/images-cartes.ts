/**
 * Les images de « Devine qui je suis », récupérées chez Wikipédia.
 *
 * ## Ce que ce script fabrique
 *
 * Un fichier engendré, `src/lib/jeux/contenu/images.ts`, qui associe à chaque
 * carte l'adresse d'une vignette Wikimedia, ses dimensions, et son attribution.
 * Les OCTETS ne sont pas rapatriés : cinq cents images de bonne qualité pèsent
 * plus de trente mégaoctets, et les mettre dans le dépôt les ferait voyager à
 * chaque déploiement pour une soirée par mois. C'est la route `/api/carte`,
 * côté serveur, qui va les chercher — le téléphone de la bande ne parle qu'à
 * nous.
 *
 * ## Ce qu'il vérifie
 *
 * Une recherche Wikipédia rend toujours QUELQUE CHOSE, et c'est le piège : une
 * carte « Jul » qui ramène la photo d'un juriste allemand du XIXe est pire que
 * pas d'image du tout. Trois garde-fous, donc :
 *
 * · les pages d'homonymie sont refusées d'emblée ;
 * · le titre rendu doit **recouper** le texte de la carte, une fois les accents,
 *   la casse et les articles retirés ;
 * · tout ce qui passe quand même est listé dans le rapport avec le titre
 *   résolu, pour qu'un humain puisse relire les cas tordus.
 *
 * ## L'attribution
 *
 * Le résumé REST ne donne pas la licence, contrairement à ce qu'on croit en
 * lisant le plan : il faut une deuxième requête, chez Commons, pour l'auteur et
 * la licence. Deux requêtes par carte, une pause entre chaque — on est invités
 * chez eux, on ne défonce pas la porte.
 *
 * Usage :
 *   npm run cartes:images              # tout, en gardant ce qui est déjà résolu
 *   npm run cartes:images -- --rejouer # tout refaire
 *   npm run cartes:images -- --paquet foot --limite 5
 *   npm run cartes:verifier            # chaque adresse rend-elle vraiment une image ?
 *
 * La vérification n'est pas du luxe : une adresse de vignette peut être refusée
 * pour une raison qui ne se devine pas depuis le résumé — demander une vignette
 * exactement à la taille de l'original rend un 400, et ça concernait la moitié
 * du paquet « Foot » sans que rien ne le dise.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { PAQUETS } from "../src/lib/jeux/contenu/paquets";

const AGENT =
  "JournalDeJoie/1.0 (application privée de trois amis ; contact via le dépôt) node-fetch";
const PAUSE_MS = 350;
const LARGEUR = 800;
const SORTIE = join(process.cwd(), "src/lib/jeux/contenu/images.ts");

type ImageCarte = {
  url: string;
  largeur: number;
  hauteur: number;
  page: string;
  auteur: string;
  licence: string;
};

const args = process.argv.slice(2);
const optionnel = (nom: string): string | null => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const rejouer = args.includes("--rejouer");
const verifier = args.includes("--verifier");
const paquetVoulu = optionnel("--paquet");
const limite = Number(optionnel("--limite") ?? "0");

/** Sans accents, sans casse, sans ponctuation : de quoi comparer deux titres. */
function aplatir(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Le titre à demander à Wikipédia.
 *
 * Les cartes sont écrites pour être LUES à voix haute (« Le coup de boule de
 * Zidane »), pas pour être cherchées. On enlève l'article de tête, qui ne sert
 * qu'à la phrase, et on laisse le reste tel quel : Wikipédia suit les
 * redirections mieux que n'importe quelle heuristique qu'on écrirait ici.
 */
function requete(carte: string): string {
  return carte.replace(/^(le|la|les|l'|l’|un|une|des|du|de la)\s+/i, "").trim();
}

/** Les mots signifiants d'un titre : ceux de plus de deux lettres. */
function motsForts(texte: string): string[] {
  return aplatir(texte)
    .split(" ")
    .filter((m) => m.length > 2);
}

/**
 * Le titre rendu parle-t-il bien de la carte ?
 *
 * On exige qu'un mot fort au moins soit commun aux deux. C'est volontairement
 * large : « La VAR » rend « Assistance vidéo à l'arbitrage », qui est la bonne
 * page et ne partage aucun mot — ces cas-là passent par la liste des titres
 * résolus, en bas du rapport, plutôt que par une règle impossible à écrire.
 */
function correspond(carte: string, titre: string): boolean {
  const a = new Set(motsForts(carte));
  if (a.size === 0) return true;
  return motsForts(titre).some((m) => a.has(m));
}

const dormir = (ms: number) => new Promise((suite) => setTimeout(suite, ms));

/**
 * Une requête, avec de la patience.
 *
 * Wikimedia limite le débit, et un refus de débit ressemble à une page absente
 * si on ne regarde que « ça a marché ou pas » : la première version de ce
 * script a annoncé « aucune page » pour onze footballeurs d'affilée, tous
 * parfaitement présents dans l'encyclopédie. On distingue donc les cas, et on
 * attend quand on nous le demande.
 */
async function json(
  url: string,
): Promise<{ donnees: Record<string, unknown> } | { statut: number | "reseau" }> {
  for (let essai = 0; essai < 4; essai += 1) {
    try {
      const reponse = await fetch(url, { headers: { "User-Agent": AGENT } });
      if (reponse.ok) {
        return { donnees: (await reponse.json()) as Record<string, unknown> };
      }
      if (reponse.status === 429 || reponse.status >= 500) {
        await dormir(2_000 * 2 ** essai);
        continue;
      }
      return { statut: reponse.status };
    } catch {
      await dormir(2_000 * 2 ** essai);
    }
  }
  return { statut: "reseau" };
}

/** L'auteur et la licence, chez Commons. Sans eux, on n'affiche pas l'image. */
async function attribution(fichier: string): Promise<{ auteur: string; licence: string } | null> {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    "&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist%7CLicenseShortName" +
    `&titles=${encodeURIComponent(`File:${fichier}`)}`;
  const reponse = await json(url);
  if (!("donnees" in reponse)) return null;
  const pages = (reponse.donnees.query as { pages?: Record<string, unknown> } | undefined)?.pages;
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    const infos = (page as { imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] })
      .imageinfo?.[0]?.extmetadata;
    if (!infos) continue;
    const brut = infos.Artist?.value ?? "";
    // L'auteur arrive en HTML — souvent un lien vers la page utilisateur.
    const auteur = brut
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    // Un champ « auteur » vide arrive : vieux versements, photos d'agence
    // reversées, fichiers hébergés sur la Wikipédia francophone plutôt que sur
    // Commons. Refuser l'image pour autant serait absurde — on crédite ce qu'on
    // sait, et on nomme la source.
    return { auteur, licence: infos.LicenseShortName?.value ?? "" };
  }
  return null;
}

async function resoudre(carte: string): Promise<{ image: ImageCarte } | { echec: string }> {
  const titre = requete(carte);

  // **Une seule requête, et c'est celle de l'API classique.**
  //
  // Le résumé REST rend une vignette de 330 px et l'adresse de l'original ;
  // fabriquer soi-même une adresse de vignette à partir de là ne marche plus.
  // Wikimedia ne génère plus de vignette à la demande pour un visiteur anonyme :
  // « Use thumbnail sizes listed on… », et un 400 à la place de l'image. Seules
  // les tailles DÉJÀ fabriquées répondent, et on ne peut pas les deviner —
  // mesuré sur un fichier au hasard, 330, 500 et 1280 passaient, 320, 400, 640,
  // 800 et 1024 non.
  //
  // L'API, elle, a le droit de fabriquer. On lui demande donc « une vignette
  // d'au plus huit cents pixels » et on garde l'adresse qu'elle rend — quitte à
  // ce qu'elle arrondisse à neuf cent soixante, ce qu'elle fait.
  const url =
    "https://fr.wikipedia.org/w/api.php?action=query&format=json&redirects=1" +
    `&prop=pageimages%7Cpageprops&ppprop=disambiguation&piprop=thumbnail%7Coriginal%7Cname&pithumbsize=${LARGEUR}` +
    `&titles=${encodeURIComponent(titre)}`;

  const reponse = await json(url);
  if (!("donnees" in reponse)) return { echec: `refus ${reponse.statut}` };

  const pages = (reponse.donnees.query as { pages?: Record<string, unknown> } | undefined)?.pages;
  const page = pages ? (Object.values(pages)[0] as Record<string, unknown> | undefined) : undefined;
  if (!page || "missing" in page) return { echec: "aucune page" };
  if ((page.pageprops as Record<string, unknown> | undefined)?.disambiguation !== undefined) {
    return { echec: "page d'homonymie" };
  }

  const rendu = String(page.title ?? "");
  if (!correspond(carte, rendu)) return { echec: `titre sans rapport : « ${rendu} »` };

  const vignette = page.thumbnail as
    | { source: string; width: number; height: number }
    | undefined;
  if (!vignette) return { echec: "pas d'image" };

  const fichier = typeof page.pageimage === "string" ? page.pageimage : null;
  const credit = fichier ? await attribution(fichier) : null;
  if (!credit) return { echec: "attribution introuvable" };

  return {
    image: {
      // Les paramètres de suivi que l'API colle à l'adresse ne servent qu'à
      // elle : on garde l'adresse nue.
      url: vignette.source.split("?")[0],
      largeur: vignette.width,
      hauteur: vignette.height,
      page: rendu,
      auteur: credit.auteur,
      licence: credit.licence,
    },
  };
}

/** Ce qui a déjà été résolu, pour ne pas tout refaire à chaque essai. */
function dejaConnues(): Record<string, ImageCarte> {
  if (rejouer || !existsSync(SORTIE)) return {};
  const texte = readFileSync(SORTIE, "utf8");
  // Le marqueur est la DÉCLARATION de la table, pas le premier « = { » venu :
  // le fichier engendré commence par un `export type ImageCarte = {`, et couper
  // là rendait une table vide. Résultat : « déjà connues » ne connaissait
  // jamais rien, et chaque relance refaisait les cinq cents requêtes.
  const marque = "export const IMAGES: Record<string, ImageCarte> = {";
  const debut = texte.indexOf(marque);
  const fin = texte.lastIndexOf("};");
  if (debut < 0 || fin < 0) return {};
  try {
    // La virgule finale est légale en TypeScript et interdite en JSON : sans ce
    // retrait, `JSON.parse` lève et la table revient vide — silencieusement,
    // puisque l'échec est rattrapé plus bas.
    const corps = texte.slice(debut + marque.length, fin).trim().replace(/,$/, "");
    return JSON.parse(`{${corps}}`) as Record<string, ImageCarte>;
  } catch {
    return {};
  }
}

async function principal() {
  const paquets = paquetVoulu ? PAQUETS.filter((p) => p.cle === paquetVoulu) : PAQUETS;
  const connues = dejaConnues();
  const images: Record<string, ImageCarte> = { ...connues };
  const echecs: { carte: string; raison: string }[] = [];
  const resolus: { carte: string; page: string }[] = [];
  let faites = 0;

  for (const paquet of paquets) {
    for (const carte of paquet.cartes) {
      if (limite && faites >= limite) break;
      if (images[carte] && !rejouer) continue;
      faites += 1;

      const issue = await resoudre(carte);
      if ("echec" in issue) {
        echecs.push({ carte, raison: issue.echec });
        process.stdout.write(`· ${carte} — ${issue.echec}\n`);
      } else {
        images[carte] = issue.image;
        if (aplatir(issue.image.page) !== aplatir(requete(carte))) {
          resolus.push({ carte, page: issue.image.page });
        }
        process.stdout.write(`✓ ${carte}\n`);
      }
      await dormir(PAUSE_MS);
    }
  }

  const entrees = Object.keys(images)
    .sort()
    .map((cle) => `  ${JSON.stringify(cle)}: ${JSON.stringify(images[cle])},`)
    .join("\n");

  writeFileSync(
    SORTIE,
    `/**
 * Les images de « Devine qui je suis ». **Fichier engendré, ne pas modifier à la main.**
 *
 * Fabriqué par \`npm run cartes:images\`, qui interroge Wikipédia et Commons.
 * On garde l'adresse et l'attribution, pas les octets : c'est la route
 * \`/api/carte\` qui va chercher l'image, pour que le téléphone de la bande ne
 * parle qu'à nous.
 *
 * Une carte absente de cette table s'affiche en texte, et c'est très bien : la
 * moitié des cartes de « Trucs qu'on trouve chez mamie » n'a pas de photo
 * d'illustration, et une carte écrite en grand se lit aussi à deux mètres.
 */
export type ImageCarte = {
  /** Vignette Wikimedia, ${LARGEUR} px de large. */
  url: string;
  largeur: number;
  hauteur: number;
  /** Le titre de la page d'où elle vient, pour pouvoir vérifier. */
  page: string;
  auteur: string;
  licence: string;
};

export const IMAGES: Record<string, ImageCarte> = {
${entrees}
};

export function imageDeCarte(carte: string): ImageCarte | null {
  return IMAGES[carte] ?? null;
}
`,
    "utf8",
  );

  const total = paquets.reduce((n, p) => n + p.cartes.length, 0);
  process.stdout.write(
    `\n${Object.keys(images).length} images sur ${total} cartes. ${echecs.length} sans image cette fois.\n`,
  );
  if (resolus.length > 0) {
    process.stdout.write(`\nÀ relire — le titre rendu n'est pas celui de la carte :\n`);
    for (const r of resolus) process.stdout.write(`  ${r.carte} → ${r.page}\n`);
  }
}

/**
 * Toutes les adresses rendent-elles vraiment une image ?
 *
 * On demande les en-têtes seulement : cinq cents images téléchargées pour
 * vérifier qu'elles existent, ce serait payer trente méga-octets pour une
 * question à laquelle un code de statut répond.
 */
async function verification() {
  const table = dejaConnues();
  const entrees = Object.entries(table);
  const casses: { carte: string; statut: string }[] = [];

  for (const [carte, image] of entrees) {
    let statut = "réseau";
    // Quatre essais, comme pour les requêtes d'API : un refus de débit ressemble
    // à une image cassée, et croire le premier 429 fait condamner dix cartes
    // parfaitement saines.
    for (let essai = 0; essai < 4; essai += 1) {
      try {
        const reponse = await fetch(image.url, {
          method: "HEAD",
          headers: { "User-Agent": AGENT },
        });
        const type = reponse.headers.get("Content-Type") ?? "";
        if (reponse.ok && type.startsWith("image/")) {
          statut = "ok";
          break;
        }
        statut = `${reponse.status} ${type}`;
        if (reponse.status !== 429 && reponse.status < 500) break;
      } catch {
        statut = "réseau";
      }
      await dormir(2_000 * 2 ** essai);
    }

    if (statut !== "ok") {
      casses.push({ carte, statut });
      process.stdout.write(`· ${carte} — ${statut}\n`);
    }
    await dormir(80);
  }

  process.stdout.write(
    `\n${entrees.length - casses.length} adresses sur ${entrees.length} rendent une image.\n`,
  );
  if (casses.length > 0) process.exitCode = 1;
}

void (verifier ? verification() : principal());
