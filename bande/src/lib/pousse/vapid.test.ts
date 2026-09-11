import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { audienceDe, clesAccordees, enteteAutorisation, fabriquerCles } from "./vapid";

/**
 * On ne peut pas comparer un jeton VAPID à une valeur publiée : ECDSA tire un
 * aléa à chaque signature, donc deux jetons du même contenu diffèrent. Ce qui se
 * vérifie, c'est que la signature **se vérifie** — avec la clé publique, et par
 * le même chemin qu'un serveur de pousse.
 */
function verifier(entete: string, publiqueBase64: string): boolean {
  const jeton = /t=([^,]+)/.exec(entete)?.[1] ?? "";
  const [tete, charge, signature] = jeton.split(".");

  // Reconstruire une clé publique à partir du point brut : le préfixe SPKI d'une
  // clé P-256 est constant, et le coller évite d'embarquer un décodeur ASN.1
  // dans un test.
  const prefixe = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");
  const cle = createPublicKey({
    key: Buffer.concat([prefixe, Buffer.from(publiqueBase64, "base64url")]),
    format: "der",
    type: "spki",
  });

  return verify(null, Buffer.from(`${tete}.${charge}`), { key: cle, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"));
}

describe("VAPID", () => {
  const cles = fabriquerCles();

  it("fabrique une paire dont les deux moitiés se répondent", () => {
    expect(Buffer.from(cles.publique, "base64url")).toHaveLength(65);
    expect(clesAccordees(cles.privee, cles.publique)).toBe(true);
  });

  it("repère deux moitiés dépareillées", () => {
    // Sans ça, chaque envoi se fait refuser par un message qui ne dit pas
    // pourquoi — et on cherche le défaut du mauvais côté pendant une heure.
    expect(clesAccordees(cles.privee, fabriquerCles().publique)).toBe(false);
    expect(clesAccordees("pas une clé", cles.publique)).toBe(false);
  });

  it("signe un jeton que la clé publique vérifie", () => {
    const entete = enteteAutorisation(
      "https://fcm.googleapis.com/fcm/send/abcdef",
      "mailto:bande@example.org",
      cles.privee,
      cles.publique,
    );
    expect(entete.startsWith("vapid t=")).toBe(true);
    expect(entete).toContain(`k=${cles.publique}`);
    expect(verifier(entete, cles.publique)).toBe(true);
  });

  it("met l'ORIGINE du serveur de pousse en audience, pas l'adresse entière", () => {
    // Un `aud` qui porterait le chemin trahirait l'abonnement visé à qui lit le
    // jeton, et serait refusé : la RFC 8292 demande l'origine.
    expect(audienceDe("https://updates.push.services.mozilla.com/wpush/v2/gAAA")).toBe(
      "https://updates.push.services.mozilla.com",
    );

    const entete = enteteAutorisation(
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "mailto:bande@example.org",
      cles.privee,
      cles.publique,
    );
    const charge = JSON.parse(
      Buffer.from(/t=[^.]+\.([^.]+)\./.exec(entete)![1], "base64url").toString("utf8"),
    ) as { aud: string; exp: number; sub: string };
    expect(charge.aud).toBe("https://updates.push.services.mozilla.com");
    expect(charge.sub).toBe("mailto:bande@example.org");
  });

  it("date le jeton à douze heures, jamais au-delà des vingt-quatre permises", () => {
    const maintenant = 1_800_000_000_000;
    const entete = enteteAutorisation("https://x.test/a", "mailto:a@b.c", cles.privee, cles.publique, maintenant);
    const charge = JSON.parse(
      Buffer.from(/t=[^.]+\.([^.]+)\./.exec(entete)![1], "base64url").toString("utf8"),
    ) as { exp: number };
    expect(charge.exp - maintenant / 1000).toBe(12 * 60 * 60);
  });
});
