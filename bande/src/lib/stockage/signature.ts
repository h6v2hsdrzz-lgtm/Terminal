import { createHash, createHmac } from "node:crypto";

/**
 * La signature AWS Signature V4, écrite à la main.
 *
 * Cloudflare R2 parle le protocole S3, et S3 exige cette signature sur chaque
 * requête. Le SDK officiel d'AWS la calcule très bien — et pèse plusieurs
 * méga-octets pour trois verbes : lire un objet, en écrire un, en effacer un.
 * Le calcul tient en une centaine de lignes de `node:crypto`, il est entièrement
 * déterministe, et il se teste. C'est un cas où écrire vaut mieux qu'installer.
 *
 * Rien ici ne touche au réseau : ce fichier ne fabrique que des chaînes. C'est
 * ce qui le rend vérifiable.
 */

export const ALGORITHME = "AWS4-HMAC-SHA256";

export function sha256(donnees: string | Uint8Array): string {
  return createHash("sha256").update(donnees).digest("hex");
}

function hmac(cle: Buffer | string, message: string): Buffer {
  return createHmac("sha256", cle).update(message, "utf8").digest();
}

/**
 * L'encodage d'URI de S3, qui n'est pas celui de `encodeURIComponent`.
 *
 * Deux écarts, et les deux font échouer la signature sans rien expliquer :
 * `encodeURIComponent` laisse passer `!'()*` alors que S3 les veut encodés, et
 * la barre oblique doit rester telle quelle dans un chemin de clé — sinon
 * `photos/2026/x.jpg` devient un seul segment et la signature porte sur une
 * autre ressource que celle qu'on demande.
 */
export function encoderUri(valeur: string, gardeLesBarres = false): string {
  const encode = encodeURIComponent(valeur).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return gardeLesBarres ? encode.replace(/%2F/g, "/") : encode;
}

/** « 20260911T073000Z », et sa date seule « 20260911 ». */
export function horodatage(instant: Date): { long: string; court: string } {
  const long = instant.toISOString().replace(/[-:]|\.\d{3}/g, "");
  return { long, court: long.slice(0, 8) };
}

export type RequeteASigner = {
  methode: "GET" | "PUT" | "DELETE" | "HEAD";
  /** Le chemin, barres comprises, non encodé. Commence par « / ». */
  chemin: string;
  /** Les paramètres de requête, triés par la fonction. */
  parametres?: Record<string, string>;
  /** Les en-têtes à signer. `host` est obligatoire. */
  entetes: Record<string, string>;
  /** L'empreinte du corps, déjà calculée. */
  empreinteCorps: string;
};

/**
 * La requête canonique : la forme normalisée sur laquelle porte la signature.
 *
 * L'ordre et la casse comptent partout. Les noms d'en-tête passent en
 * minuscules et sont triés, leurs valeurs sont rognées, et la liste des
 * en-têtes signés est répétée à la fin — c'est ce qui empêche un intermédiaire
 * d'en ajouter un.
 */
export function requeteCanonique(requete: RequeteASigner): {
  texte: string;
  entetesSignes: string;
} {
  const parametres = Object.entries(requete.parametres ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cle, valeur]) => `${encoderUri(cle)}=${encoderUri(valeur)}`)
    .join("&");

  const normalises = Object.entries(requete.entetes)
    .map(([cle, valeur]) => [cle.toLowerCase(), valeur.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const entetesSignes = normalises.map(([cle]) => cle).join(";");

  const texte = [
    requete.methode,
    encoderUri(requete.chemin, true),
    parametres,
    normalises.map(([cle, valeur]) => `${cle}:${valeur}`).join("\n") + "\n",
    entetesSignes,
    requete.empreinteCorps,
  ].join("\n");

  return { texte, entetesSignes };
}

export type Portee = { date: string; region: string; service: string };

export function portee({ date, region, service }: Portee): string {
  return `${date}/${region}/${service}/aws4_request`;
}

/** La chaîne à signer : l'algorithme, l'instant, la portée, et l'empreinte. */
export function chaineASigner(
  instantLong: string,
  p: Portee,
  requeteCanoniqueTexte: string,
): string {
  return [ALGORITHME, instantLong, portee(p), sha256(requeteCanoniqueTexte)].join("\n");
}

/**
 * La clé de signature, dérivée en quatre tours.
 *
 * Chaque tour ajoute une dimension — la date, la région, le service, le
 * protocole — de sorte qu'une clé dérivée ne vaut que pour un jour, une région
 * et un service. C'est ce qui rend une signature interceptée inutilisable
 * ailleurs.
 */
export function cleDeSignature(secret: string, p: Portee): Buffer {
  const parDate = hmac(`AWS4${secret}`, p.date);
  const parRegion = hmac(parDate, p.region);
  const parService = hmac(parRegion, p.service);
  return hmac(parService, "aws4_request");
}

export function signer(
  secret: string,
  p: Portee,
  chaine: string,
): string {
  return createHmac("sha256", cleDeSignature(secret, p)).update(chaine, "utf8").digest("hex");
}

/** L'en-tête `Authorization` complet, prêt à partir. */
export function enteteAutorisation(options: {
  identifiant: string;
  secret: string;
  portee: Portee;
  instantLong: string;
  requete: RequeteASigner;
}): string {
  const { texte, entetesSignes } = requeteCanonique(options.requete);
  const chaine = chaineASigner(options.instantLong, options.portee, texte);
  const signature = signer(options.secret, options.portee, chaine);
  return (
    `${ALGORITHME} Credential=${options.identifiant}/${portee(options.portee)}, ` +
    `SignedHeaders=${entetesSignes}, Signature=${signature}`
  );
}
