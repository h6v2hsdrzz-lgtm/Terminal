import { describe, expect, it } from "vitest";

import {
  chaineASigner,
  cleDeSignature,
  encoderUri,
  enteteAutorisation,
  horodatage,
  requeteCanonique,
  signer,
} from "./signature";

/**
 * Le vecteur de référence d'AWS — « GET Object », suite de tests S3.
 *
 * Un test sur des chaînes fabriquées à la main ne prouverait que ma cohérence
 * avec moi-même. Celui-ci compare à une signature publiée par AWS, calculée par
 * leur implémentation : c'est la seule façon honnête de vérifier une signature
 * qu'on a écrite soi-même, et elle a attrapé deux erreurs d'encodage.
 */
const VECTEUR = {
  identifiant: "AKIAIOSFODNN7EXAMPLE",
  secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  portee: { date: "20130524", region: "us-east-1", service: "s3" },
  instant: "20130524T000000Z",
  vide: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  signature: "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
};

const REQUETE = {
  methode: "GET" as const,
  chemin: "/test.txt",
  entetes: {
    host: "examplebucket.s3.amazonaws.com",
    range: "bytes=0-9",
    "x-amz-content-sha256": VECTEUR.vide,
    "x-amz-date": VECTEUR.instant,
  },
  empreinteCorps: VECTEUR.vide,
};

describe("la signature v4", () => {
  it("retrouve la signature publiée par AWS", () => {
    const { texte } = requeteCanonique(REQUETE);
    const chaine = chaineASigner(VECTEUR.instant, VECTEUR.portee, texte);
    expect(signer(VECTEUR.secret, VECTEUR.portee, chaine)).toBe(VECTEUR.signature);
  });

  it("écrit un en-tête d'autorisation complet", () => {
    const entete = enteteAutorisation({
      identifiant: VECTEUR.identifiant,
      secret: VECTEUR.secret,
      portee: VECTEUR.portee,
      instantLong: VECTEUR.instant,
      requete: REQUETE,
    });
    expect(entete).toContain(`Credential=${VECTEUR.identifiant}/20130524/us-east-1/s3/aws4_request`);
    expect(entete).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
    expect(entete).toContain(`Signature=${VECTEUR.signature}`);
  });

  it("trie les en-têtes et les passe en minuscules", () => {
    const { entetesSignes } = requeteCanonique({
      ...REQUETE,
      entetes: { "X-Amz-Date": "x", Host: "h", "Content-Type": "t" },
    });
    expect(entetesSignes).toBe("content-type;host;x-amz-date");
  });

  it("dérive une clé différente par jour, par région et par service", () => {
    const base = cleDeSignature(VECTEUR.secret, VECTEUR.portee);
    const demain = cleDeSignature(VECTEUR.secret, { ...VECTEUR.portee, date: "20130525" });
    const ailleurs = cleDeSignature(VECTEUR.secret, { ...VECTEUR.portee, region: "auto" });
    expect(base.equals(demain)).toBe(false);
    expect(base.equals(ailleurs)).toBe(false);
  });
});

describe("l'encodage d'URI de S3", () => {
  it("encode ce que encodeURIComponent laisse passer", () => {
    // Ces cinq-là font échouer la signature sans rien expliquer.
    expect(encoderUri("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });

  it("garde les barres d'un chemin de clé", () => {
    expect(encoderUri("medias/2026/photo.jpg", true)).toBe("medias/2026/photo.jpg");
    expect(encoderUri("medias/2026/photo.jpg")).toBe("medias%2F2026%2Fphoto.jpg");
  });

  it("encode l'espace en %20, jamais en +", () => {
    // Un « + » est un espace pour un formulaire, et un plus littéral pour S3 :
    // la clé signée ne serait pas celle demandée.
    expect(encoderUri("deux mots")).toBe("deux%20mots");
  });
});

describe("l'horodatage", () => {
  it("rend la forme compacte attendue par la signature", () => {
    const { long, court } = horodatage(new Date("2026-09-11T07:30:00.000Z"));
    expect(long).toBe("20260911T073000Z");
    expect(court).toBe("20260911");
  });
});
