import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

/**
 * VAPID : comment un serveur de pousse sait que c'est bien nous.
 *
 * Un navigateur donne à n'importe qui une adresse d'abonnement ; sans
 * signature, n'importe qui pourrait donc pousser des notifications sur le
 * téléphone de la bande. VAPID (RFC 8292) règle ça avec un jeton JWT signé en
 * ES256 par une clé dont seul notre serveur a la moitié privée — la moitié
 * publique voyage avec l'abonnement, et le serveur de pousse vérifie.
 *
 * Écrit à la main pour la même raison que le chiffrement : deux RFC, une
 * primitive de Node, et le contenu des notifications ne sort pas de chez nous.
 *
 * ## Le piège d'ES256
 *
 * Node signe en DER par défaut ; JWT veut la forme brute « ieee-p1363 »,
 * soixante-quatre octets. Une signature DER passe tous les tests locaux et se
 * fait refuser par tous les serveurs de pousse — d'où le `dsaEncoding`
 * explicite, qui n'a l'air de rien.
 */

/** Douze heures. La RFC 8292 plafonne à vingt-quatre ; on reste en dessous. */
const VIE_JETON_S = 12 * 60 * 60;

const base64url = (donnees: Buffer | string) =>
  Buffer.from(donnees as never).toString("base64url");

/**
 * Fabrique une paire VAPID.
 *
 * Sert une fois, à l'installation : `npm run pousse:cles` l'appelle et affiche
 * les deux moitiés à coller dans l'environnement.
 */
export function fabriquerCles(): { publique: string; privee: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  // La clé publique VAPID est le point non compressé, tel quel : c'est ce que
  // `applicationServerKey` attend dans le navigateur.
  const publique = publicKey.export({ type: "spki", format: "der" }).subarray(-65);
  const privee = privateKey.export({ type: "pkcs8", format: "der" });
  return { publique: base64url(publique), privee: base64url(Buffer.from(privee)) };
}

/** L'origine d'une adresse d'abonnement — c'est elle qu'on met en `aud`. */
export function audienceDe(endpoint: string): string {
  return new URL(endpoint).origin;
}

/**
 * L'en-tête `Authorization` d'un envoi.
 *
 * `sub` doit être une adresse de contact — un `mailto:` ou une URL — pour qu'un
 * opérateur de service de pousse puisse joindre quelqu'un si nos envois posent
 * problème. Ce n'est pas décoratif : certains serveurs refusent sans.
 */
export function enteteAutorisation(
  endpoint: string,
  contact: string,
  priveeBase64: string,
  publiqueBase64: string,
  maintenant: number = Date.now(),
): string {
  const entete = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const charge = base64url(
    JSON.stringify({
      aud: audienceDe(endpoint),
      exp: Math.floor(maintenant / 1000) + VIE_JETON_S,
      sub: contact,
    }),
  );

  const cle = createPrivateKey({
    key: Buffer.from(priveeBase64, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign(null, Buffer.from(`${entete}.${charge}`), {
    key: cle,
    dsaEncoding: "ieee-p1363",
  });

  return `vapid t=${entete}.${charge}.${base64url(signature)}, k=${publiqueBase64}`;
}

/**
 * La clé publique correspond-elle à la privée ?
 *
 * Deux moitiés dépareillées dans l'environnement, et chaque envoi se fait
 * refuser par un serveur de pousse avec un message qui ne dit pas pourquoi. La
 * vérification coûte une multiplication scalaire au démarrage.
 */
export function clesAccordees(priveeBase64: string, publiqueBase64: string): boolean {
  try {
    const privee = createPrivateKey({
      key: Buffer.from(priveeBase64, "base64url"),
      format: "der",
      type: "pkcs8",
    });
    const deduite = createPublicKey(privee)
      .export({ type: "spki", format: "der" })
      .subarray(-65);
    return (
      createHash("sha256").update(deduite).digest("hex") ===
      createHash("sha256").update(Buffer.from(publiqueBase64, "base64url")).digest("hex")
    );
  } catch {
    return false;
  }
}
