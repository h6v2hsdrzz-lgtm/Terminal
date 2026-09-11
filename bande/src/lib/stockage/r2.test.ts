import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ecrireR2, lireR2, supprimerR2, type ConfigurationR2 } from "./r2";

/**
 * Un faux S3, en mémoire.
 *
 * Le client R2 ne se teste pas autrement sans un compte Cloudflare, et un test
 * qui a besoin d'un compte n'est pas un test. Celui-ci vérifie ce qui se vérifie
 * sans le vrai service : que le client envoie la bonne méthode sur la bonne
 * clé, qu'il signe chaque requête, qu'il rend les octets exacts, et qu'il
 * distingue « absent » de « en panne ».
 *
 * Ce qu'il ne prouve PAS : que Cloudflare acceptera la signature. Ça, seul un
 * vrai seau le dira — voir `ETAT.md`.
 */
const objets = new Map<string, { octets: Buffer; mime: string }>();
const signatures: string[] = [];
let serveur: Server;
let config: ConfigurationR2;

beforeAll(async () => {
  serveur = createServer((requete, reponse) => {
    const chemin = decodeURIComponent(requete.url ?? "");
    const signature = requete.headers.authorization ?? "";
    signatures.push(signature);

    // Un vrai S3 refuse une requête non signée ; le faux aussi, sinon le test
    // passerait même si le client oubliait de signer.
    if (!signature.startsWith("AWS4-HMAC-SHA256 ")) {
      reponse.writeHead(403).end();
      return;
    }

    if (requete.method === "PUT") {
      const morceaux: Buffer[] = [];
      requete.on("data", (m) => morceaux.push(m as Buffer));
      requete.on("end", () => {
        objets.set(chemin, {
          octets: Buffer.concat(morceaux),
          mime: requete.headers["content-type"] ?? "",
        });
        reponse.writeHead(200).end();
      });
      return;
    }

    if (requete.method === "GET") {
      const objet = objets.get(chemin);
      if (!objet) {
        reponse.writeHead(404).end();
        return;
      }
      reponse.writeHead(200, { "content-type": objet.mime }).end(objet.octets);
      return;
    }

    if (requete.method === "DELETE") {
      reponse.writeHead(objets.delete(chemin) ? 204 : 404).end();
      return;
    }

    reponse.writeHead(405).end();
  });

  await new Promise<void>((pret) => serveur.listen(0, "127.0.0.1", pret));
  const port = (serveur.address() as { port: number }).port;
  process.env.R2_ENDPOINT = `http://127.0.0.1:${port}`;
  config = { compte: "compte", seau: "bande", identifiant: "cle", secret: "secret" };
});

afterAll(async () => {
  delete process.env.R2_ENDPOINT;
  await new Promise<void>((fini) => serveur.close(() => fini()));
});

describe("le client R2", () => {
  it("écrit puis relit les mêmes octets", async () => {
    const octets = new Uint8Array([1, 2, 3, 250, 0, 128]);
    await ecrireR2(config, "medias/abc", octets, "image/webp");
    expect(await lireR2(config, "medias/abc")).toEqual(octets);
  });

  it("range l'objet sous le seau et la clé", () => {
    expect([...objets.keys()]).toContain("/bande/medias/abc");
  });

  it("signe chaque requête", () => {
    expect(signatures.length).toBeGreaterThan(0);
    for (const s of signatures) expect(s).toMatch(/^AWS4-HMAC-SHA256 Credential=cle\//);
  });

  it("garde le type déclaré", () => {
    expect(objets.get("/bande/medias/abc")?.mime).toBe("image/webp");
  });

  it("rend null sur un objet absent, et ne lève pas", async () => {
    // « Absent » et « en panne » ne se traitent pas pareil : le premier est un
    // média effacé, le second mérite de remonter.
    expect(await lireR2(config, "medias/jamais-vu")).toBeNull();
  });

  it("efface, et accepte d'effacer deux fois", async () => {
    await ecrireR2(config, "medias/temporaire", new Uint8Array([9]), "image/png");
    await supprimerR2(config, "medias/temporaire");
    expect(await lireR2(config, "medias/temporaire")).toBeNull();
    await expect(supprimerR2(config, "medias/temporaire")).resolves.toBeUndefined();
  });

  it("traite les clés à barres comme un chemin, pas comme un nom", async () => {
    await ecrireR2(config, "vignettes/2026/09/x", new Uint8Array([7]), "image/jpeg");
    expect([...objets.keys()]).toContain("/bande/vignettes/2026/09/x");
  });
});
