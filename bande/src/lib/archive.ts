/**
 * Un fichier ZIP, écrit et relu à la main.
 *
 * ## Pourquoi pas une bibliothèque
 *
 * Parce qu'un ZIP **sans compression** tient en cent lignes, et que les cent
 * lignes en question sont un format figé depuis 1989 : trois structures, un
 * CRC-32, et des entiers en petit-boutien. Une dépendance de plus pour ça
 * coûterait plus cher à auditer qu'à écrire — c'est le même raisonnement que la
 * signature AWS du lot M et que les notifications du lot Q.
 *
 * ## Pourquoi sans compression
 *
 * Une sauvegarde de cette application, c'est du JSON (qui se compresse bien) et
 * des JPEG, des MP4, des WebM (qui ne se compressent pas du tout, et qui font
 * 99 % du poids). `deflate` demanderait `node:zlib` en flux, une taille
 * inconnue à l'avance, et rendrait peut-être cinq pour cent. La méthode
 * « stocké » est lisible par tous les systèmes, y compris le Finder et
 * l'Explorateur.
 *
 * ## Les limites, assumées
 *
 * Pas de ZIP64 : au-delà de quatre gigaoctets ou de 65 535 fichiers, il
 * faudrait les enregistrements étendus. Le plafond de stockage de la bande est
 * à un demi-gigaoctet, et `ecrireZip` refuse plutôt que de produire une
 * archive silencieusement fausse.
 */

const SIGNATURE_LOCALE = 0x04034b50;
const SIGNATURE_CENTRALE = 0x02014b50;
const SIGNATURE_FIN = 0x06054b50;

/** Le drapeau « le nom de fichier est en UTF-8 ». Sans lui, « été.jpg » s'abîme. */
const DRAPEAU_UTF8 = 0x0800;

const TAILLE_MAX = 4 * 1024 * 1024 * 1024 - 1;
const FICHIERS_MAX = 0xffff;

/**
 * `Uint8Array<ArrayBuffer>` et pas `Uint8Array` tout court : le second accepte
 * aussi un `SharedArrayBuffer`, que Prisma refuse pour une colonne `Bytes`.
 * Sans cette précision, chaque octet rangé en base demanderait une copie.
 */
export type FichierArchive = { nom: string; octets: Uint8Array<ArrayBuffer> };

/**
 * La table du CRC-32, calculée une fois.
 *
 * Le polynôme inversé `0xedb88320` est celui de tout le monde : zlib, PNG,
 * Ethernet, et ZIP. Le calculer plutôt que de coller 256 constantes rend le
 * code vérifiable à l'œil.
 */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let valeur = i;
    for (let bit = 0; bit < 8; bit += 1) {
      valeur = valeur & 1 ? (valeur >>> 1) ^ 0xedb88320 : valeur >>> 1;
    }
    table[i] = valeur >>> 0;
  }
  return table;
})();

export function crc32(octets: Uint8Array<ArrayBufferLike>): number {
  let reste = 0xffffffff;
  for (let i = 0; i < octets.length; i += 1) {
    reste = (reste >>> 8) ^ TABLE[(reste ^ octets[i]) & 0xff];
  }
  return (reste ^ 0xffffffff) >>> 0;
}

/**
 * L'heure au format MS-DOS : deux secondes de résolution, et l'an 1980 pour
 * origine. C'est ce que le format demande, et personne ne le regarde.
 */
function horodatageDos(quand: Date): { heure: number; date: number } {
  return {
    heure:
      (quand.getHours() << 11) | (quand.getMinutes() << 5) | Math.floor(quand.getSeconds() / 2),
    date:
      ((Math.max(1980, quand.getFullYear()) - 1980) << 9) |
      ((quand.getMonth() + 1) << 5) |
      quand.getDate(),
  };
}

export function ecrireZip(fichiers: FichierArchive[], quand = new Date()): Uint8Array<ArrayBuffer> {
  if (fichiers.length > FICHIERS_MAX) {
    throw new Error(`Une archive sans ZIP64 ne porte pas plus de ${FICHIERS_MAX} fichiers.`);
  }

  const encodeur = new TextEncoder();
  const { heure, date } = horodatageDos(quand);
  const entrees = fichiers.map((fichier) => ({
    nom: encodeur.encode(fichier.nom),
    octets: fichier.octets,
    crc: crc32(fichier.octets),
  }));

  const poidsTotal =
    entrees.reduce((somme, e) => somme + 30 + e.nom.length + e.octets.length, 0) +
    entrees.reduce((somme, e) => somme + 46 + e.nom.length, 0) +
    22;
  if (poidsTotal > TAILLE_MAX) {
    throw new Error("Une archive sans ZIP64 ne dépasse pas quatre gigaoctets.");
  }

  const sortie = new Uint8Array(poidsTotal);
  const vue = new DataView(sortie.buffer);
  let curseur = 0;
  const decalages: number[] = [];

  const u16 = (valeur: number) => {
    vue.setUint16(curseur, valeur, true);
    curseur += 2;
  };
  const u32 = (valeur: number) => {
    vue.setUint32(curseur, valeur, true);
    curseur += 4;
  };
  const brut = (octets: Uint8Array) => {
    sortie.set(octets, curseur);
    curseur += octets.length;
  };

  for (const entree of entrees) {
    decalages.push(curseur);
    u32(SIGNATURE_LOCALE);
    u16(20);
    u16(DRAPEAU_UTF8);
    u16(0); // stocké
    u16(heure);
    u16(date);
    u32(entree.crc);
    u32(entree.octets.length);
    u32(entree.octets.length);
    u16(entree.nom.length);
    u16(0);
    brut(entree.nom);
    brut(entree.octets);
  }

  const debutCentral = curseur;
  entrees.forEach((entree, rang) => {
    u32(SIGNATURE_CENTRALE);
    u16(20);
    u16(20);
    u16(DRAPEAU_UTF8);
    u16(0);
    u16(heure);
    u16(date);
    u32(entree.crc);
    u32(entree.octets.length);
    u32(entree.octets.length);
    u16(entree.nom.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(decalages[rang]);
    brut(entree.nom);
  });

  // La taille du répertoire se MESURE avant d'écrire quoi que ce soit de la
  // fin : `curseur - debutCentral` calculé en argument d'un `u32` vaut douze
  // octets de trop, parce que les cinq champs précédents l'ont déjà fait
  // avancer. L'aller-retour maison ne le voyait pas — il lit le nombre
  // d'entrées, pas la taille — et `unzip` refusait l'archive en parlant de
  // « composants qui se chevauchent ».
  const tailleCentral = curseur - debutCentral;

  u32(SIGNATURE_FIN);
  u16(0);
  u16(0);
  u16(entrees.length);
  u16(entrees.length);
  u32(tailleCentral);
  u32(debutCentral);
  u16(0);

  return sortie;
}

/**
 * Relire une archive.
 *
 * On part de la **fin**, comme le format le demande : c'est le répertoire
 * central qui fait foi, pas la suite des en-têtes locaux. Une archive
 * retouchée par un autre outil peut avoir des en-têtes locaux incomplets — le
 * drapeau 0x08 met la taille APRÈS les données — alors que le répertoire
 * central est toujours juste.
 *
 * Elle refuse ce qu'elle ne sait pas lire plutôt que de rendre des octets
 * faux : une sauvegarde à moitié restaurée serait pire qu'une restauration
 * refusée.
 */
export function lireZip(archive: Uint8Array<ArrayBuffer>): FichierArchive[] {
  const vue = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  // La fin porte un commentaire de longueur variable : on cherche sa signature
  // à rebours, sur les 64 kio possibles au maximum.
  let fin = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i -= 1) {
    if (vue.getUint32(i, true) === SIGNATURE_FIN) {
      fin = i;
      break;
    }
  }
  if (fin === -1) throw new Error("Ce fichier n'est pas une archive ZIP.");

  const combien = vue.getUint16(fin + 10, true);
  let curseur = vue.getUint32(fin + 16, true);
  const decodeur = new TextDecoder();
  const fichiers: FichierArchive[] = [];

  for (let rang = 0; rang < combien; rang += 1) {
    if (vue.getUint32(curseur, true) !== SIGNATURE_CENTRALE) {
      throw new Error("Le répertoire de l'archive est abîmé.");
    }
    const methode = vue.getUint16(curseur + 10, true);
    const taille = vue.getUint32(curseur + 24, true);
    const longueurNom = vue.getUint16(curseur + 28, true);
    const longueurExtra = vue.getUint16(curseur + 30, true);
    const longueurCommentaire = vue.getUint16(curseur + 32, true);
    const decalage = vue.getUint32(curseur + 42, true);
    const nom = decodeur.decode(archive.subarray(curseur + 46, curseur + 46 + longueurNom));

    if (methode !== 0) {
      throw new Error(`« ${nom} » est compressé, et on ne sait lire que le format stocké.`);
    }

    // L'en-tête local redonne les longueurs de nom et d'extra, qui peuvent
    // différer de celles du répertoire central. C'est celles-là qui disent où
    // commencent les octets.
    if (vue.getUint32(decalage, true) !== SIGNATURE_LOCALE) {
      throw new Error(`« ${nom} » ne commence pas là où l'archive le dit.`);
    }
    const debut =
      decalage + 30 + vue.getUint16(decalage + 26, true) + vue.getUint16(decalage + 28, true);
    const octets = archive.slice(debut, debut + taille);

    // Le CRC est la seule chose qui distingue une archive intacte d'une
    // archive tronquée par un transfert interrompu.
    const attendu = vue.getUint32(curseur + 16, true);
    if (crc32(octets) !== attendu) throw new Error(`« ${nom} » est abîmé.`);

    // Un dossier est une entrée de taille nulle dont le nom finit par « / ».
    if (!nom.endsWith("/")) fichiers.push({ nom, octets });
    curseur += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }

  return fichiers;
}
