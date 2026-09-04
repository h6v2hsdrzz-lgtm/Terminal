import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * L'identité, sans compte.
 *
 * Pas d'email, pas de mot de passe, pas de lien magique : on rejoint une bande
 * avec un code qu'un ami vous dicte, et le navigateur garde ensuite un cookie
 * signé. C'est le strict nécessaire pour que l'application sache qui écrit, et
 * rien de plus — ce qui veut aussi dire qu'il n'y a aucune donnée personnelle
 * à perdre.
 *
 * Le cookie porte l'identifiant du membre et une signature HMAC. Il n'est pas
 * chiffré : son contenu n'est pas secret, il doit seulement être infalsifiable.
 * Sans la signature, n'importe qui pourrait se déclarer n'importe qui en
 * changeant une valeur dans les outils du navigateur.
 */
const NOM_COOKIE = "bande_membre";
const UN_AN = 60 * 60 * 24 * 365;

function secret(): string {
  const valeur = process.env.SECRET_SESSION;
  if (!valeur) throw new Error("SECRET_SESSION manquante — voir bande/README.md.");
  return valeur;
}

const signer = (charge: string) =>
  createHmac("sha256", secret()).update(charge).digest("base64url");

function verifier(charge: string, signature: string): boolean {
  const attendue = Buffer.from(signer(charge));
  const fournie = Buffer.from(signature);
  if (attendue.length !== fournie.length) return false;
  return timingSafeEqual(attendue, fournie);
}

/** L'identifiant du membre connecté, ou null. Ne touche jamais la base. */
export async function membreConnecte(): Promise<string | null> {
  const jeton = (await cookies()).get(NOM_COOKIE)?.value;
  if (!jeton) return null;

  const separateur = jeton.lastIndexOf(".");
  if (separateur < 1) return null;

  const id = jeton.slice(0, separateur);
  return verifier(id, jeton.slice(separateur + 1)) ? id : null;
}

/** Uniquement depuis une action serveur : HTTP interdit d'écrire un cookie une fois le flux commencé. */
export async function ouvrirSession(membreId: string): Promise<void> {
  (await cookies()).set(NOM_COOKIE, `${membreId}.${signer(membreId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: UN_AN,
  });
}

export async function fermerSession(): Promise<void> {
  (await cookies()).delete(NOM_COOKIE);
}

/**
 * Le code de reprise, le temps de le noter.
 *
 * Il ne passe pas par l'URL : une adresse se retrouve dans l'historique du
 * navigateur, dans les journaux du serveur et dans le champ `Referer` de la
 * requête suivante. Un cookie court, invisible au JavaScript, ne va nulle part.
 */
const NOM_REPRISE = "bande_reprise";
const CINQ_MINUTES = 300;

export async function garderCodeReprise(code: string): Promise<void> {
  (await cookies()).set(NOM_REPRISE, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CINQ_MINUTES,
  });
}

export async function lireCodeReprise(): Promise<string | null> {
  return (await cookies()).get(NOM_REPRISE)?.value ?? null;
}

export async function oublierCodeReprise(): Promise<void> {
  (await cookies()).delete(NOM_REPRISE);
}
