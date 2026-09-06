/**
 * Le cadre des jeux qui font boire. Non négociable, et dans le moteur — pas
 * dans chaque jeu, sinon un jeu finira par l'oublier.
 *
 * Le plan est explicite, et il a raison : « un jeu qui finit à l'hôpital est un
 * jeu raté ». Quatre règles, toutes appliquées ici :
 *
 * 1. **L'unité est la gorgée**, jamais le verre, jamais le cul sec. Aucun
 *    texte de l'application ne dit « bois ton verre ».
 * 2. **Un plafond par manche.** Trois gorgées, quoi qu'il arrive. Un jeu où
 *    l'on peut prendre huit gorgées d'un coup est un jeu qu'on a mal compté.
 * 3. **« Je passe » est toujours là, sans pénalité** — pas de gage de
 *    remplacement, pas de moquerie de l'app, rien. Un refus qui coûte quelque
 *    chose n'est pas un refus.
 * 4. **Celui qui conduit est marqué sobre** et reçoit un gage à la place. Ce
 *    n'est pas un lot de consolation : c'est le même tour, autrement.
 *
 * Et l'application ne compte rien : ni les gorgées prises, ni qui en a pris le
 * plus. Un compteur transforme la soirée en score, et le score en défi.
 */

/** Le plafond, par manche et par personne. */
export const MAX_GORGEES = 3;

export function gorgees(nombre: number): string {
  const n = Math.max(0, Math.min(MAX_GORGEES, Math.round(nombre)));
  if (n === 0) return "rien du tout";
  return n === 1 ? "une gorgée" : `${n} gorgées`;
}

/**
 * Les gages, pour celui qui conduit.
 *
 * Ils sont faits pour être drôles à faire, pas humiliants : le sobre est celui
 * qui rend la soirée possible, ce n'est pas lui qu'on punit.
 */
export const GAGES = [
  "Raconte ton pire souvenir de collège, en trente secondes.",
  "Imite quelqu'un de la bande jusqu'à ce qu'on devine qui.",
  "Fais un compliment sincère à ta gauche. Sincère.",
  "Chante le refrain de la dernière chanson que tu as écoutée.",
  "Donne ton avis le plus clivant sur un sujet totalement anodin.",
  "Raconte la dernière fois que tu as menti, et à qui.",
  "Prends l'accent de ton choix jusqu'à la fin du tour.",
  "Montre la dernière photo de ta pellicule. Sans la choisir.",
  "Explique ton métier comme si on avait cinq ans.",
  "Dis la chose la plus gentille que tu penses de la personne à ta droite.",
  "Refais le dernier truc débile que tu as fait, en mieux.",
  "Trouve un surnom à chacun, là, maintenant.",
] as const;

/**
 * Ce qu'une personne doit faire pour cette manche.
 *
 * `sobre` décide, pas le jeu : c'est la seule chose qui doit être vraie partout
 * de la même façon. Le tirage du gage est passé en paramètre plutôt que tiré
 * ici, pour que la fonction reste pure et testable.
 */
export type Sanction =
  | { genre: "gorgees"; nombre: number; texte: string }
  | { genre: "gage"; texte: string }
  | { genre: "rien" };

export function sanction(options: {
  sobre: boolean;
  nombre: number;
  tirage: number;
}): Sanction {
  const nombre = Math.max(0, Math.min(MAX_GORGEES, Math.round(options.nombre)));
  if (nombre === 0) return { genre: "rien" };
  if (options.sobre) {
    const index = Math.abs(Math.floor(options.tirage)) % GAGES.length;
    return { genre: "gage", texte: GAGES[index] };
  }
  return { genre: "gorgees", nombre, texte: gorgees(nombre) };
}

/**
 * Le rappel d'eau, toutes les trente minutes.
 *
 * Il ne bloque rien et ne se répète pas : il apparaît une fois par palier
 * franchi. Un rappel qu'on doit fermer à chaque manche devient un rappel qu'on
 * ferme sans lire.
 */
export const PALIER_EAU = 30 * 60 * 1000;

export function rappelsDus(dureeMs: number): number {
  return Math.max(0, Math.floor(dureeMs / PALIER_EAU));
}
