import { createCipheriv, createECDH, createHmac, randomBytes, type ECDH } from "node:crypto";

/**
 * Le chiffrement d'une notification poussée, à la main.
 *
 * ## Pourquoi à la main
 *
 * `web-push` fait ça très bien, et c'est une dépendance de plus pour trois
 * personnes qui s'envoient deux notifications par jour. Surtout : le contenu
 * d'une notification, ce sont les mots de la bande. On ne les confie pas à un
 * paquet qu'on n'a pas lu, alors que la spécification tient en deux RFC et que
 * Node a toutes les primitives.
 *
 * C'est le même raisonnement que pour la signature S3 du lot M, et la même
 * contrepartie : **ça doit être vérifié contre les vecteurs publiés**, pas
 * contre « ça a l'air de marcher ». Les tests reprennent l'exemple complet de
 * la RFC 8291, section 5 — mêmes clés, même sel, même sortie au caractère près.
 *
 * ## Ce que ça fait
 *
 * · **RFC 8291** — un secret partagé par ECDH P-256 entre une paire de clés
 *   jetable (une par message) et la clé publique du navigateur, mélangé au
 *   secret d'authentification de l'abonné. Ce mélange est ce qui empêche le
 *   serveur de pousse — qui voit passer les deux clés publiques — de fabriquer
 *   un message valide ;
 * · **RFC 8188** — l'emballage `aes128gcm` : un en-tête qui porte le sel, la
 *   taille d'enregistrement et notre clé publique, puis un enregistrement
 *   chiffré.
 *
 * Un seul enregistrement : une notification fait deux cents octets, la limite
 * est de quatre kilo-octets, et découper n'ajouterait qu'un chemin de code que
 * rien n'exercerait jamais.
 */

/** Un point P-256 non compressé : 0x04, puis X et Y. */
const LONGUEUR_POINT = 65;
/** L'en-tête de la RFC 8188 : sel, taille d'enregistrement, longueur de clé, clé. */
const LONGUEUR_ENTETE = 16 + 4 + 1 + LONGUEUR_POINT;
/** La taille d'enregistrement annoncée. Un message tient toujours dedans. */
const TAILLE_ENREGISTREMENT = 4096;

/**
 * HKDF, extraction et expansion.
 *
 * Écrit plutôt que pris dans `crypto.hkdfSync` : celui de Node veut et rend des
 * `ArrayBuffer`, et les allers-retours brouillaient la lecture plus qu'ils ne
 * l'aidaient. Une seule itération d'expansion suffit — on ne tire jamais plus
 * de trente-deux octets, et le compteur vaut donc toujours 1.
 */
function hkdf(sel: Buffer, matiere: Buffer, info: Buffer, longueur: number): Buffer {
  const prk = createHmac("sha256", sel).update(matiere).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, longueur);
}

/**
 * Les clés dérivées pour un message.
 *
 * Sorties à part pour une seule raison : les tests les comparent une par une
 * aux valeurs que la RFC 8291 publie. Un chiffrement écrit à la main qui « a
 * l'air de marcher » ne vaut rien ; celui-ci tombe sur les six valeurs
 * intermédiaires de l'exemple officiel, et le message se relit avec la clé
 * privée que la RFC donne.
 */
export function deriver(
  partage: Buffer,
  authSecret: Buffer,
  clientPub: Buffer,
  serveurPub: Buffer,
  sel: Buffer,
): { matiere: Buffer; cle: Buffer; nonce: Buffer } {
  const matiere = hkdf(
    authSecret,
    partage,
    Buffer.concat([Buffer.from("WebPush: info\0", "ascii"), clientPub, serveurPub]),
    32,
  );
  return {
    matiere,
    cle: hkdf(sel, matiere, Buffer.from("Content-Encoding: aes128gcm\0", "ascii"), 16),
    nonce: hkdf(sel, matiere, Buffer.from("Content-Encoding: nonce\0", "ascii"), 12),
  };
}

export type Abonne = {
  /** La clé publique du navigateur, en base64url (`p256dh`). */
  p256dh: string;
  /** Le secret d'authentification, en base64url (`auth`). */
  auth: string;
};

/**
 * Chiffre un message pour un abonné.
 *
 * `sel` et `jetable` ne sont là que pour les tests : en production ils sont
 * tirés au hasard à chaque message. Réutiliser un sel ou une paire de clés,
 * c'est perdre l'essentiel de ce que le chiffrement apporte.
 */
export function chiffrer(
  message: string,
  abonne: Abonne,
  sel: Buffer = randomBytes(16),
  jetable?: ECDH,
): Buffer {
  const clientPub = Buffer.from(abonne.p256dh, "base64url");
  const authSecret = Buffer.from(abonne.auth, "base64url");
  if (clientPub.length !== LONGUEUR_POINT) {
    throw new Error("La clé publique de l'abonné n'est pas un point P-256.");
  }

  const paire = jetable ?? createECDH("prime256v1");
  if (!jetable) paire.generateKeys();
  const serveurPub = paire.getPublicKey();
  const partage = paire.computeSecret(clientPub);

  // Le secret partagé passe d'abord par le secret d'authentification, avec un
  // contexte qui lie les DEUX clés publiques : sans ce lien, un intermédiaire
  // pourrait substituer la sienne.
  const { cle, nonce } = deriver(partage, authSecret, clientPub, serveurPub, sel);

  // Le remplissage de la RFC 8188. L'octet 0x02 dit « dernier enregistrement » ;
  // 0x01 dirait qu'il en reste, et un navigateur refuserait le message.
  const contenu = Buffer.concat([Buffer.from(message, "utf8"), Buffer.from([2])]);

  const chiffreur = createCipheriv("aes-128-gcm", cle, nonce);
  const corps = Buffer.concat([
    chiffreur.update(contenu),
    chiffreur.final(),
    chiffreur.getAuthTag(),
  ]);

  const entete = Buffer.alloc(LONGUEUR_ENTETE);
  sel.copy(entete, 0);
  entete.writeUInt32BE(TAILLE_ENREGISTREMENT, 16);
  entete.writeUInt8(LONGUEUR_POINT, 20);
  serveurPub.copy(entete, 21);

  return Buffer.concat([entete, corps]);
}
