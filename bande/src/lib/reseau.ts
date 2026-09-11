"use client";

/**
 * L'état du réseau, et ce qui n'est pas passé.
 *
 * ## Pourquoi un magasin, et pas un état React
 *
 * Le bandeau est **unique** et vit dans la disposition du repaire ; ce qui
 * échoue, lui, arrive n'importe où — un cœur dans le fil, une journée qu'on
 * retire, un scellé qu'on supprime. Faire descendre un `setState` du haut
 * jusqu'à chacun de ces endroits voudrait dire un contexte traversé par tous
 * les écrans, ou pire, un bandeau par composant.
 *
 * Une valeur qui vit dehors et qu'on lit avec `useSyncExternalStore` dit
 * exactement ce qui se passe : le sondage écrit « hors ligne », les appels
 * écrivent « ça n'est pas passé », et un seul composant les affiche.
 *
 * ## La règle que ce fichier fait respecter
 *
 * **Rien n'échoue en silence.** Une action serveur qui rend une erreur et
 * qu'on jette, c'est un cœur qui ne s'affiche pas, une journée qu'on croit
 * retirée et qui ne l'est pas. Le droit de retrait est la règle numéro un du
 * produit : il ne peut pas dépendre d'un `await` dont personne ne lit le
 * retour.
 */

export type Panne = {
  /** Ce qu'on montre à la personne. En français, et sans jargon. */
  message: string;
  /** Refaire exactement ce qui a raté. Le bandeau en fait un bouton. */
  reessayer?: () => void;
};

export type EtatReseau = {
  horsLigne: boolean;
  panne: Panne | null;
  /** Vrai quelques secondes après un retour du réseau, pour le dire. */
  deRetour: boolean;
};

const abonnes = new Set<() => void>();

/**
 * L'instantané est GARDÉ entre deux lectures.
 *
 * `useSyncExternalStore` compare les instantanés par référence : en fabriquer
 * un neuf à chaque lecture ferait boucler le rendu jusqu'à l'erreur « getSnapshot
 * should be cached ». On ne remplace donc cet objet que lorsqu'une valeur change
 * vraiment.
 */
let instantane: EtatReseau = { horsLigne: false, panne: null, deRetour: false };

const VIDE: EtatReseau = { horsLigne: false, panne: null, deRetour: false };

let minuteurRetour: ReturnType<typeof setTimeout> | null = null;

function poser(suite: EtatReseau) {
  instantane = suite;
  for (const rappel of abonnes) rappel();
}

export function sAbonnerReseau(rappel: () => void): () => void {
  abonnes.add(rappel);
  return () => {
    abonnes.delete(rappel);
  };
}

export function lireReseau(): EtatReseau {
  return instantane;
}

/** Le serveur ne sait rien du réseau du téléphone : tout va bien, par défaut. */
export function lireReseauServeur(): EtatReseau {
  return VIDE;
}

/**
 * Le sondage dit ce qu'il voit.
 *
 * Le retour en ligne s'annonce trois secondes puis se tait : un bandeau
 * permanent « tout va bien » est du bruit, mais ne rien dire du tout laisse
 * penser que c'est toujours coupé.
 */
export function signalerReseau(enLigne: boolean) {
  if (!enLigne) {
    if (instantane.horsLigne) return;
    if (minuteurRetour) clearTimeout(minuteurRetour);
    poser({ ...instantane, horsLigne: true, deRetour: false });
    return;
  }

  if (!instantane.horsLigne) return;
  poser({ ...instantane, horsLigne: false, deRetour: true });
  if (minuteurRetour) clearTimeout(minuteurRetour);
  minuteurRetour = setTimeout(() => {
    poser({ ...instantane, deRetour: false });
  }, 3000);
}

export function signalerPanne(message: string, reessayer?: () => void) {
  poser({ ...instantane, panne: { message, reessayer } });
}

export function oublierPanne() {
  if (!instantane.panne) return;
  poser({ ...instantane, panne: null });
}

/**
 * Lancer une action serveur **en regardant ce qu'elle rend**.
 *
 * Les actions de ce dépôt rendent `{ erreur }` plutôt que de lever : c'est ce
 * qui permet d'afficher « Ta session a expiré » au lieu d'un écran blanc. Mais
 * un appelant qui ne lit pas ce retour annule tout le bénéfice, et c'était le
 * cas de sept d'entre eux — dont le retrait d'une journée.
 *
 * `quoi` complète la phrase « … n'a pas pu partir », au cas où l'échec soit un
 * échec de transport et n'ait donc aucun message à lui.
 */
export async function sansSilence(
  travail: () => Promise<{ erreur: string | null }>,
  quoi: string,
): Promise<boolean> {
  try {
    const reponse = await travail();
    if (!reponse.erreur) {
      oublierPanne();
      return true;
    }
    signalerPanne(reponse.erreur, () => void sansSilence(travail, quoi));
    return false;
  } catch {
    // Pas de réponse du tout : c'est le réseau, pas la règle métier.
    signalerPanne(`${quoi} n'a pas pu partir — le réseau a lâché.`, () => {
      void sansSilence(travail, quoi);
    });
    return false;
  }
}
