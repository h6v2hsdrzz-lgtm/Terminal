import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configuree, envoyer } from "./envoi";
import { fabriquerCles } from "./vapid";

/**
 * L'envoi, éprouvé contre un faux serveur de pousse.
 *
 * Le vrai ne peut pas servir : il faudrait un navigateur, un abonnement réel et
 * un téléphone. Celui-ci fait ce qu'un vrai fait — il vérifie la signature
 * VAPID, puis **déchiffre le corps avec la clé privée du navigateur** — et il a
 * l'avantage de pouvoir dire ce qu'il a trouvé.
 *
 * C'est la même méthode qu'au lot M avec le faux S3 : un serveur complaisant ne
 * prouve rien, un serveur qui refuse ce qui devrait être refusé prouve beaucoup.
 */
type Recu = {
  autorisation: string;
  encodage: string;
  ttl: string;
  corps: Buffer;
};

let serveur: Server;
let adresse: string;
let dernier: Recu | null = null;
/** Le code que le faux serveur rendra au prochain appel. */
let prochainCode = 201;

const cles = fabriquerCles();
/** La paire du « navigateur » : c'est elle qui déchiffrera. */
const navigateur = createECDH("prime256v1");
navigateur.generateKeys();
const authSecret = randomBytes(16);

const ABONNEMENT = {
  endpoint: "",
  p256dh: navigateur.getPublicKey().toString("base64url"),
  auth: authSecret.toString("base64url"),
};

function hkdf(sel: Buffer, matiere: Buffer, info: Buffer, longueur: number): Buffer {
  const prk = createHmac("sha256", sel).update(matiere).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, longueur);
}

/** Ce que fait un navigateur en recevant le message. */
function dechiffrer(corps: Buffer): string {
  const sel = corps.subarray(0, 16);
  const serveurPub = corps.subarray(21, 86);
  const partage = navigateur.computeSecret(serveurPub);
  const matiere = hkdf(
    authSecret,
    partage,
    Buffer.concat([
      Buffer.from("WebPush: info\0", "ascii"),
      navigateur.getPublicKey(),
      serveurPub,
    ]),
    32,
  );
  const cle = hkdf(sel, matiere, Buffer.from("Content-Encoding: aes128gcm\0", "ascii"), 16);
  const nonce = hkdf(sel, matiere, Buffer.from("Content-Encoding: nonce\0", "ascii"), 12);

  const chiffre = corps.subarray(86);
  const d = createDecipheriv("aes-128-gcm", cle, nonce);
  d.setAuthTag(chiffre.subarray(chiffre.length - 16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
  return clair.subarray(0, clair.length - 1).toString("utf8");
}

/** Ce que fait un serveur de pousse : vérifier que le jeton est bien signé. */
function signatureValide(autorisation: string): boolean {
  const jeton = /t=([^,]+)/.exec(autorisation)?.[1] ?? "";
  const clePubliee = /k=([^,\s]+)/.exec(autorisation)?.[1] ?? "";
  const [tete, charge, signature] = jeton.split(".");
  const prefixe = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");
  const cle = createPublicKey({
    key: Buffer.concat([prefixe, Buffer.from(clePubliee, "base64url")]),
    format: "der",
    type: "spki",
  });
  return verify(
    null,
    Buffer.from(`${tete}.${charge}`),
    { key: cle, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
}

beforeAll(async () => {
  process.env.VAPID_PUBLIQUE = cles.publique;
  process.env.VAPID_PRIVEE = cles.privee;
  process.env.VAPID_CONTACT = "mailto:bande@example.org";

  serveur = createServer((requete, reponse) => {
    const morceaux: Buffer[] = [];
    requete.on("data", (m: Buffer) => morceaux.push(m));
    requete.on("end", () => {
      dernier = {
        autorisation: String(requete.headers.authorization ?? ""),
        encodage: String(requete.headers["content-encoding"] ?? ""),
        ttl: String(requete.headers.ttl ?? ""),
        corps: Buffer.concat(morceaux),
      };
      reponse.writeHead(prochainCode).end();
    });
  });

  await new Promise<void>((suite) => serveur.listen(0, "127.0.0.1", suite));
  const port = (serveur.address() as { port: number }).port;
  adresse = `http://127.0.0.1:${port}`;
  ABONNEMENT.endpoint = `${adresse}/pousse/abcdef`;
});

afterAll(() => {
  serveur.close();
  delete process.env.VAPID_PUBLIQUE;
  delete process.env.VAPID_PRIVEE;
});

const NOTIFICATION = {
  type: "commentaire" as const,
  titre: "Sam",
  corps: "t'as vu ce qu'il a écrit",
  vers: "/",
  etiquette: "commentaire-xyz",
};

describe("l'envoi d'une notification", () => {
  it("se sait configurée quand les deux moitiés se répondent", () => {
    expect(configuree()).toBe(true);
  });

  it("arrive signée, chiffrée, et se relit du côté du navigateur", async () => {
    prochainCode = 201;
    const issue = await envoyer(ABONNEMENT, NOTIFICATION);

    expect(issue).toBe("envoyee");
    expect(dernier).not.toBeNull();
    expect(dernier!.encodage).toBe("aes128gcm");
    expect(Number(dernier!.ttl)).toBeGreaterThan(0);
    expect(signatureValide(dernier!.autorisation)).toBe(true);
    expect(JSON.parse(dechiffrer(dernier!.corps))).toEqual(NOTIFICATION);
  });

  it("distingue un abonnement PÉRIMÉ d'un incident", async () => {
    // C'est la distinction qui compte : confondre les deux, c'est soit garder
    // pour toujours des abonnements morts, soit supprimer un abonnement valide
    // au premier hoquet du réseau.
    for (const code of [404, 410]) {
      prochainCode = code;
      expect(await envoyer(ABONNEMENT, NOTIFICATION), String(code)).toBe("perimee");
    }
    for (const code of [429, 500, 503]) {
      prochainCode = code;
      expect(await envoyer(ABONNEMENT, NOTIFICATION), String(code)).toBe("ratee");
    }
  });

  it("ne pousse rien tant que les clés ne sont pas posées", async () => {
    const garde = process.env.VAPID_PRIVEE;
    delete process.env.VAPID_PRIVEE;
    dernier = null;
    expect(await envoyer(ABONNEMENT, NOTIFICATION)).toBe("ratee");
    // Et surtout : RIEN n'est parti. Une fonctionnalité qui attend sa
    // configuration ne doit pas envoyer des requêtes dans le vide.
    expect(dernier).toBeNull();
    process.env.VAPID_PRIVEE = garde;
  });

  it("ne lève pas quand le serveur de pousse est injoignable", async () => {
    // Une notification perdue ne doit jamais faire échouer le geste qui l'a
    // déclenchée : celui qui a commenté a bien commenté.
    expect(
      await envoyer({ ...ABONNEMENT, endpoint: "http://127.0.0.1:1/pousse" }, NOTIFICATION),
    ).toBe("ratee");
  });
});
