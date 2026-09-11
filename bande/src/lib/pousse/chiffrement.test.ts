import { createDecipheriv, createECDH, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { chiffrer, deriver } from "./chiffrement";

/**
 * L'exemple complet de la RFC 8291, section 5.
 *
 * C'est le seul test qui compte pour ce fichier : du chiffrement écrit à la
 * main qui « a l'air de marcher » ne vaut rien. Toutes les entrées sont celles
 * de la RFC — y compris le sel et la paire jetable, normalement tirés au hasard
 * — et on compare **chaque valeur intermédiaire** à celle qu'elle publie.
 *
 * Puis on relit le message avec la clé privée du navigateur, que la RFC donne
 * aussi. Les deux vérifications ensemble disent la même chose que recopier le
 * corps chiffré attendu, sans dépendre d'une chaîne de cent quatre-vingt-douze
 * caractères recopiée à la main.
 */
const MESSAGE = "When I grow up, I want to be a watermelon";

const UA_PUBLIQUE =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const UA_PRIVEE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const AS_PRIVEE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const AS_PUBLIQUE =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const SEL = "DGv6ra1nlYgDCS1FRnbzlw";

/** Les valeurs intermédiaires publiées par la RFC, dans l'ordre du calcul. */
const ATTENDU = {
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  prkCle: "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
};

const ABONNE = { p256dh: UA_PUBLIQUE, auth: AUTH };

function paireDuServeur() {
  const as = createECDH("prime256v1");
  as.setPrivateKey(Buffer.from(AS_PRIVEE, "base64url"));
  return as;
}

describe("le chiffrement d'une notification", () => {
  it("retrouve chaque valeur intermédiaire de la RFC 8291", () => {
    const as = paireDuServeur();
    expect(as.getPublicKey().toString("base64url")).toBe(AS_PUBLIQUE);

    const clientPub = Buffer.from(UA_PUBLIQUE, "base64url");
    const partage = as.computeSecret(clientPub);
    expect(partage.toString("base64url")).toBe(ATTENDU.ecdhSecret);

    // L'extraction intermédiaire, que la RFC nomme `PRK_key`.
    const prkCle = createHmac("sha256", Buffer.from(AUTH, "base64url")).update(partage).digest();
    expect(prkCle.toString("base64url")).toBe(ATTENDU.prkCle);

    const { matiere, cle, nonce } = deriver(
      partage,
      Buffer.from(AUTH, "base64url"),
      clientPub,
      as.getPublicKey(),
      Buffer.from(SEL, "base64url"),
    );
    expect(matiere.toString("base64url")).toBe(ATTENDU.ikm);
    expect(cle.toString("base64url")).toBe(ATTENDU.cek);
    expect(nonce.toString("base64url")).toBe(ATTENDU.nonce);
  });

  it("produit un corps que le navigateur sait relire", () => {
    const corps = chiffrer(MESSAGE, ABONNE, Buffer.from(SEL, "base64url"), paireDuServeur());

    // L'en-tête de la RFC 8188 : sel, taille d'enregistrement, longueur de clé,
    // clé publique du serveur.
    expect(corps.subarray(0, 16).toString("base64url")).toBe(SEL);
    expect(corps.readUInt32BE(16)).toBe(4096);
    expect(corps.readUInt8(20)).toBe(65);
    expect(corps.subarray(21, 86).toString("base64url")).toBe(AS_PUBLIQUE);

    // Et le déchiffrement, du côté du navigateur, avec la clé privée publiée.
    const ua = createECDH("prime256v1");
    ua.setPrivateKey(Buffer.from(UA_PRIVEE, "base64url"));
    const { cle, nonce } = deriver(
      ua.computeSecret(corps.subarray(21, 86)),
      Buffer.from(AUTH, "base64url"),
      ua.getPublicKey(),
      corps.subarray(21, 86),
      corps.subarray(0, 16),
    );

    const chiffre = corps.subarray(86);
    const dechiffreur = createDecipheriv("aes-128-gcm", cle, nonce);
    dechiffreur.setAuthTag(chiffre.subarray(chiffre.length - 16));
    const clair = Buffer.concat([
      dechiffreur.update(chiffre.subarray(0, chiffre.length - 16)),
      dechiffreur.final(),
    ]);

    expect(clair.subarray(0, clair.length - 1).toString("utf8")).toBe(MESSAGE);
    // 0x02 : « dernier enregistrement ». Avec 0x01, un navigateur refuse le
    // message en attendant une suite qui ne vient jamais.
    expect(clair[clair.length - 1]).toBe(2);
  });

  it("refuse une clé publique qui n'est pas un point P-256", () => {
    // Une clé tronquée n'est pas une erreur de chiffrement : c'est un abonné
    // abîmé, et on veut le savoir ici plutôt que de pousser dans le vide.
    expect(() => chiffrer("x", { p256dh: "AAAA", auth: AUTH })).toThrow(/P-256/);
  });

  it("ne produit jamais deux fois le même corps", () => {
    // Le sel et la paire jetable sont tirés à chaque message : deux envois du
    // même texte au même abonné ne doivent pas se ressembler.
    expect(chiffrer(MESSAGE, ABONNE).equals(chiffrer(MESSAGE, ABONNE))).toBe(false);
  });
});
