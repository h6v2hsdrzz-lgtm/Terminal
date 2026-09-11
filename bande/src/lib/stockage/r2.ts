import { enteteAutorisation, horodatage, sha256, encoderUri } from "./signature";

/**
 * Cloudflare R2, en trois verbes.
 *
 * R2 parle le protocole S3 ; on n'en utilise qu'une fraction minuscule : écrire
 * un objet, le lire, l'effacer. Pas de versions, pas de multipart, pas de
 * listing — les clés sont déduites des identifiants en base, jamais découvertes.
 *
 * **Le seau est privé.** Aucune adresse publique n'est fabriquée ici : les
 * routes de l'application lisent les octets et les servent elles-mêmes, après
 * avoir vérifié la session et l'appartenance à la bande. Un seau public
 * rendrait chaque photo lisible par quiconque devine une clé, ce qui annulerait
 * tout ce que fait `lireMedia`.
 *
 * Pas de `server-only` ici, et ce n'est pas un oubli : `node:crypto` rend ce
 * fichier serveur de fait, et le script de migration doit pouvoir l'importer
 * hors de Next, là où `server-only` lève.
 */
export type ConfigurationR2 = {
  compte: string;
  seau: string;
  identifiant: string;
  secret: string;
};

/** La configuration, si et seulement si les quatre valeurs sont là. */
export function configurationR2(
  env: NodeJS.ProcessEnv = process.env,
): ConfigurationR2 | null {
  const compte = env.R2_COMPTE?.trim();
  const seau = env.R2_SEAU?.trim();
  const identifiant = env.R2_CLE?.trim();
  const secret = env.R2_SECRET?.trim();
  if (!compte || !seau || !identifiant || !secret) return null;
  return { compte, seau, identifiant, secret };
}

/**
 * L'adresse d'un objet.
 *
 * `R2_ENDPOINT` existe pour les tests : ils font tourner un faux S3 en mémoire
 * et vérifient que le client parle correctement. Sans cette porte, la seule
 * façon d'éprouver le client serait d'avoir un compte Cloudflare — et un test
 * qui a besoin d'un compte n'est pas un test, c'est une manipulation.
 */
function adresse(config: ConfigurationR2, cle: string, env = process.env): URL {
  const base = env.R2_ENDPOINT?.trim() || `https://${config.compte}.r2.cloudflarestorage.com`;
  return new URL(`${base}/${config.seau}/${encoderUri(cle, true)}`);
}

async function requete(
  config: ConfigurationR2,
  methode: "GET" | "PUT" | "DELETE" | "HEAD",
  cle: string,
  corps?: Uint8Array,
  mime?: string,
): Promise<Response> {
  const url = adresse(config, cle);
  const { long, court } = horodatage(new Date());
  const empreinteCorps = sha256(corps ?? new Uint8Array());

  const entetes: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": empreinteCorps,
    "x-amz-date": long,
  };
  if (corps) {
    entetes["content-length"] = String(corps.byteLength);
    if (mime) entetes["content-type"] = mime;
  }

  entetes.authorization = enteteAutorisation({
    identifiant: config.identifiant,
    secret: config.secret,
    // R2 ignore la région mais exige qu'elle soit dans la signature : « auto »
    // est la valeur que Cloudflare documente.
    portee: { date: court, region: "auto", service: "s3" },
    instantLong: long,
    requete: {
      methode,
      chemin: url.pathname,
      entetes,
      empreinteCorps,
    },
  });

  // `host` est signé mais jamais envoyé à la main : c'est `fetch` qui le pose,
  // et le fixer soi-même est refusé par la plateforme.
  const envoyables = Object.fromEntries(
    Object.entries(entetes).filter(([cle]) => cle !== "host"),
  );
  return fetch(url, {
    method: methode,
    headers: envoyables,
    body: corps ? (corps as BodyInit) : undefined,
    // Un média ne se met jamais en cache entre nous et R2 : c'est la route de
    // l'application qui décide de ce que voit le navigateur.
    cache: "no-store",
  });
}

export async function ecrireR2(
  config: ConfigurationR2,
  cle: string,
  octets: Uint8Array,
  mime: string,
): Promise<void> {
  const reponse = await requete(config, "PUT", cle, octets, mime);
  if (!reponse.ok) {
    throw new Error(`R2 a refusé l'écriture de ${cle} : ${reponse.status}`);
  }
}

export async function lireR2(
  config: ConfigurationR2,
  cle: string,
): Promise<Uint8Array | null> {
  const reponse = await requete(config, "GET", cle);
  if (reponse.status === 404) return null;
  if (!reponse.ok) throw new Error(`R2 a refusé la lecture de ${cle} : ${reponse.status}`);
  return new Uint8Array(await reponse.arrayBuffer());
}

export async function supprimerR2(config: ConfigurationR2, cle: string): Promise<void> {
  const reponse = await requete(config, "DELETE", cle);
  // 404 sur une suppression n'est pas une erreur : l'objet n'est plus là, ce
  // qui est exactement le résultat demandé.
  if (!reponse.ok && reponse.status !== 404) {
    throw new Error(`R2 a refusé la suppression de ${cle} : ${reponse.status}`);
  }
}
