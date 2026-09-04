/**
 * Les codes qu'on se dicte au téléphone.
 *
 * Un alphabet sans caractères ambigus : ni O ni 0, ni I ni 1, ni la paire
 * S/5. Personne ne devrait avoir à demander « c'est un i majuscule ou un un ? ».
 */
import { randomInt, scryptSync, timingSafeEqual } from "node:crypto";

export const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY2346789";

/** Longueur du code d'invitation d'une bande. */
const TAILLE_INVITATION = 6;
/** La moitié publique d'un code de reprise : elle sert à retrouver la ligne. */
const TAILLE_POIGNEE = 4;
/** La moitié secrète : elle est vérifiée contre une empreinte. */
const TAILLE_SECRET = 8;

function tirer(taille: number): string {
  let sortie = "";
  for (let i = 0; i < taille; i += 1) sortie += ALPHABET[randomInt(ALPHABET.length)];
  return sortie;
}

export const codeInvitation = () => tirer(TAILLE_INVITATION);

/**
 * Normalise ce qu'on a tapé : ni la casse, ni les espaces, ni les tirets ne
 * comptent.
 *
 * Tout ce qui n'appartient pas à l'alphabet est retiré plutôt que corrigé. La
 * tentation serait de rattraper un « O » en « Q » ou un « 1 » en « J », mais
 * ces caractères sont justement absents de l'alphabet : deviner reviendrait à
 * transformer une faute de frappe en une autre lettre valide, et donc à
 * chercher la mauvaise bande. Un caractère retiré fait échouer le contrôle de
 * longueur, et l'écran dit simplement que le code n'est pas reconnu.
 */
export function normaliserCode(saisi: string): string {
  return [...saisi.toUpperCase()].filter((c) => ALPHABET.includes(c)).join("");
}

/**
 * Un code de reprise, en deux moitiés.
 *
 * La poignée est stockée en clair et indexée : elle seule permet de retrouver
 * la personne sans balayer la table. Le secret est stocké haché — c'est un mot
 * de passe, il en mérite le traitement.
 *
 * L'utilisateur ne voit qu'une chaîne : `ABCD-EFGH-JKLM`.
 */
export function creerCodeReprise() {
  const poignee = tirer(TAILLE_POIGNEE);
  const secret = tirer(TAILLE_SECRET);
  return {
    poignee,
    empreinte: hacher(secret, poignee),
    /** À montrer une fois, et une seule. */
    enClair: `${poignee}-${secret.slice(0, 4)}-${secret.slice(4)}`,
  };
}

/** Découpe un code saisi en poignée + secret, ou null s'il n'a pas la bonne forme. */
export function decouperCodeReprise(saisi: string): { poignee: string; secret: string } | null {
  const propre = normaliserCode(saisi);
  if (propre.length !== TAILLE_POIGNEE + TAILLE_SECRET) return null;
  return { poignee: propre.slice(0, TAILLE_POIGNEE), secret: propre.slice(TAILLE_POIGNEE) };
}

// La poignée sert de sel : deux personnes au même secret n'auront pas la même
// empreinte, et le sel n'a pas besoin d'une colonne de plus.
function hacher(secret: string, poignee: string): string {
  return scryptSync(secret, poignee, 32).toString("hex");
}

export function verifierCodeReprise(secret: string, poignee: string, empreinte: string): boolean {
  const attendu = Buffer.from(empreinte, "hex");
  const propose = scryptSync(secret, poignee, 32);
  // Longueurs différentes : `timingSafeEqual` lèverait au lieu de répondre.
  if (attendu.length !== propose.length) return false;
  return timingSafeEqual(attendu, propose);
}
