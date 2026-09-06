/**
 * Le brouillon du check-in, gardé pendant qu'on écrit.
 *
 * Ce n'est pas la même chose que la journée en attente (`attente.ts`), et les
 * confondre serait une erreur : l'attente est une journée **validée** qui n'a
 * pas pu partir faute de réseau ; le brouillon est une journée **pas encore
 * validée**, celle qu'on est en train d'écrire quand on part répondre à un
 * message.
 *
 * Sur un téléphone, quitter l'application au milieu d'un formulaire est le cas
 * NORMAL, pas l'accident. Sans brouillon, on retrouve l'écran vide et on ne
 * réécrit pas — on se dit qu'on le fera plus tard, et on ne le fait pas.
 *
 * Le brouillon meurt à l'envoi, et il expire au changement de jour : relire
 * demain ce qu'on écrivait hier soir n'aide personne.
 */
const CLE = "bande.brouillon";

export type Brouillon = {
  jour: string;
  joie: number;
  titre: string;
  note: string;
  lieu: string;
  energie: number | null;
  rire: number | null;
  declencheurs: string[];
};

/** Un brouillon vide n'est pas un brouillon : on n'écrase rien pour rien. */
export function vide(b: Omit<Brouillon, "jour">): boolean {
  return (
    b.titre.trim() === "" &&
    b.note.trim() === "" &&
    b.lieu.trim() === "" &&
    b.declencheurs.length === 0
  );
}

export function lireBrouillon(jour: string): Brouillon | null {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return null;
    const range = JSON.parse(brut) as Brouillon;
    // Un brouillon d'hier ne se propose pas : la journée dont il parlait est
    // finie, et le reproposer ferait poster hier sous la date d'aujourd'hui.
    return range.jour === jour ? range : null;
  } catch {
    // Stockage refusé (navigation privée, réglages), JSON abîmé : on écrit
    // sans filet plutôt que de faire échouer l'écran.
    return null;
  }
}

export function garderBrouillon(brouillon: Brouillon): void {
  try {
    if (vide(brouillon)) {
      localStorage.removeItem(CLE);
      return;
    }
    localStorage.setItem(CLE, JSON.stringify(brouillon));
  } catch {
    // Idem : perdre un brouillon est ennuyeux, planter l'écran est pire.
  }
}

export function oublierBrouillon(): void {
  try {
    localStorage.removeItem(CLE);
  } catch {
    /* rien à faire */
  }
}
