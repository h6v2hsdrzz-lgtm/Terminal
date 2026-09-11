import { describe, expect, it } from "vitest";

import { crc32, ecrireZip, lireZip } from "./archive";

const texte = (valeur: string) => new TextEncoder().encode(valeur);

describe("crc32", () => {
  it("rend les valeurs publiées", () => {
    // Les deux vecteurs que tout le monde cite. Un CRC juste sur ses propres
    // données ne prouve rien : il faut des valeurs venues d'ailleurs.
    expect(crc32(texte(""))).toBe(0);
    expect(crc32(texte("123456789"))).toBe(0xcbf43926);
    expect(crc32(texte("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("le ZIP", () => {
  it("commence par PK\\x03\\x04 et finit par le répertoire central", () => {
    const archive = ecrireZip([{ nom: "a.txt", octets: texte("bonjour") }]);
    expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // La signature de fin est à 22 octets de la fin quand il n'y a pas de
    // commentaire.
    expect([...archive.subarray(archive.length - 22, archive.length - 18)]).toEqual([
      0x50, 0x4b, 0x05, 0x06,
    ]);
  });

  it("déclare la BONNE taille de répertoire central", () => {
    // Le défaut qui a coûté un aller-retour avec `unzip` : la taille était
    // calculée en argument d'une écriture, donc après que cinq champs avaient
    // déjà fait avancer le curseur. Douze octets de trop, une archive refusée
    // par tous les outils du monde — et un aller-retour maison parfaitement
    // vert, puisqu'il lit le NOMBRE d'entrées et pas leur taille.
    const archive = ecrireZip([
      { nom: "a.txt", octets: texte("bonjour") },
      { nom: "b/c.bin", octets: new Uint8Array([1, 2, 3]) },
    ]);
    const fin = archive.length - 22;
    const vue = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const taille = vue.getUint32(fin + 12, true);
    const debut = vue.getUint32(fin + 16, true);
    expect(debut + taille).toBe(fin);
  });

  it("fait l'aller-retour, octet pour octet", () => {
    const fichiers = [
      { nom: "journal.json", octets: texte('{"bande":"Les Trois Fromages"}') },
      { nom: "medias/été.jpg", octets: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) },
      { nom: "vide.txt", octets: new Uint8Array(0) },
    ];
    const relu = lireZip(ecrireZip(fichiers));
    expect(relu.map((f) => f.nom)).toEqual(fichiers.map((f) => f.nom));
    relu.forEach((fichier, rang) => {
      expect([...fichier.octets]).toEqual([...fichiers[rang].octets]);
    });
  });

  it("garde les accents dans les noms", () => {
    const relu = lireZip(ecrireZip([{ nom: "médias/août.jpg", octets: texte("x") }]));
    expect(relu[0].nom).toBe("médias/août.jpg");
  });

  it("tient sur des octets quelconques", () => {
    const bruit = new Uint8Array(5000);
    for (let i = 0; i < bruit.length; i += 1) bruit[i] = (i * 31 + 7) % 256;
    const relu = lireZip(ecrireZip([{ nom: "bruit.bin", octets: bruit }]));
    expect(crc32(relu[0].octets)).toBe(crc32(bruit));
  });

  it("refuse ce qui n'est pas une archive", () => {
    expect(() => lireZip(texte("ceci est un texte"))).toThrow(/pas une archive/i);
  });

  it("refuse une archive abîmée plutôt que de rendre des octets faux", () => {
    const archive = ecrireZip([{ nom: "a.txt", octets: texte("bonjour") }]);
    // Un octet retourné au milieu des données : le CRC doit le voir. Une
    // sauvegarde à moitié restaurée serait pire qu'une restauration refusée.
    const abimee = archive.slice();
    abimee[40] ^= 0xff;
    expect(() => lireZip(abimee)).toThrow(/abîmé/i);
  });
});
