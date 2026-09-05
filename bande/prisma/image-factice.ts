/**
 * Une image de démonstration, fabriquée sans dépendance.
 *
 * Le peuplement a besoin de vraies photos : un fil sans image ne permet pas de
 * juger la carte, le carrousel ni la mise en page. Plutôt qu'embarquer une
 * bibliothèque d'encodage ou committer des binaires, on écrit le PNG à la
 * main — c'est un format assez simple pour ça : une signature, trois blocs, et
 * un CRC par bloc.
 */
import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Table CRC-32 standard, calculée une fois.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(donnees: Buffer): number {
  let c = 0xffffffff;
  for (const octet of donnees) c = TABLE[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type: string, contenu: Buffer): Buffer {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(contenu.length);
  const corps = Buffer.concat([Buffer.from(type, "ascii"), contenu]);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, somme]);
}

/**
 * Un dégradé diagonal, avec une bande plus claire pour donner du relief.
 *
 * La teinte vient de la personne : sur le fil, on doit pouvoir dire d'un coup
 * d'œil que deux photos ne sont pas la même.
 */
export function imageFactice(
  largeur: number,
  hauteur: number,
  teinte: [number, number, number],
): Uint8Array<ArrayBuffer> {
  const [r0, v0, b0] = teinte;
  const lignes: Buffer[] = [];

  for (let y = 0; y < hauteur; y += 1) {
    // Un octet de filtre par ligne : 0, aucun filtrage. Le fichier est plus
    // gros qu'il pourrait l'être, et c'est sans importance ici.
    const ligne = Buffer.alloc(1 + largeur * 3);
    for (let x = 0; x < largeur; x += 1) {
      const part = (x / largeur) * 0.6 + (y / hauteur) * 0.4;
      const bande = Math.abs(((x + y) % 160) - 80) / 80 > 0.86 ? 26 : 0;
      const i = 1 + x * 3;
      ligne[i] = Math.min(255, Math.round(r0 * (1 - part * 0.55)) + bande);
      ligne[i + 1] = Math.min(255, Math.round(v0 * (1 - part * 0.55)) + bande);
      ligne[i + 2] = Math.min(255, Math.round(b0 * (1 - part * 0.55)) + bande);
    }
    lignes.push(ligne);
  }

  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;   // 8 bits par canal
  entete[9] = 2;   // couleur vraie, sans canal alpha
  entete[10] = 0;  // compression standard
  entete[11] = 0;  // filtrage standard
  entete[12] = 0;  // pas d'entrelacement

  const png = Buffer.concat([
    SIGNATURE,
    bloc("IHDR", entete),
    bloc("IDAT", deflateSync(Buffer.concat(lignes), { level: 9 })),
    bloc("IEND", Buffer.alloc(0)),
  ]);
  // Une copie sur un tampon possédé : Prisma refuse une vue sur un
  // `SharedArrayBuffer` possible.
  return new Uint8Array(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
}
