/**
 * La journée écrite hors ligne, gardée jusqu'au retour du réseau.
 *
 * Le check-in est la seule chose qu'on fasse vraiment dans le métro : c'est le
 * soir, c'est court, et c'est précisément là qu'on n'a pas de réseau. Les
 * réactions et les commentaires, eux, peuvent attendre — les mettre en file
 * aussi ajouterait de la complexité pour un cas qui ne se présente pas.
 *
 * Le stockage local suffit : une seule entrée à la fois, celle du jour, sur cet
 * appareil. Une base indexée serait un marteau pour une punaise.
 */
const CLE = "bande.journee-en-attente";
const EVENEMENT = "bande:attente";

/**
 * Un abonnement minimal, pour que React puisse lire ce stockage pendant le
 * rendu au lieu de le recopier dans un état.
 *
 * `storage` ne se déclenche que dans les AUTRES onglets ; l'événement maison
 * couvre celui qui écrit. Les deux sont nécessaires.
 */
export function sAbonnerAttente(rappel: () => void): () => void {
  window.addEventListener(EVENEMENT, rappel);
  window.addEventListener("storage", rappel);
  return () => {
    window.removeEventListener(EVENEMENT, rappel);
    window.removeEventListener("storage", rappel);
  };
}

const prevenir = () => window.dispatchEvent(new Event(EVENEMENT));

/** Vrai s'il y a une journée en attente pour ce jour. Lisible pendant le rendu. */
export function yaUneAttente(jour: string): boolean {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return false;
    return (JSON.parse(brut) as JourneeEnAttente).jour === jour;
  } catch {
    return false;
  }
}

export type JourneeEnAttente = {
  jour: string;
  joie: number;
  note: string;
  declencheurs: string[];
  ecriteA: number;
};

export function garderEnAttente(journee: Omit<JourneeEnAttente, "ecriteA">): void {
  try {
    localStorage.setItem(CLE, JSON.stringify({ ...journee, ecriteA: Date.now() }));
    prevenir();
  } catch {
    // Stockage plein ou refusé : on perd la reprise automatique, pas la
    // journée — le formulaire est toujours à l'écran.
  }
}

/** La journée en attente, si elle concerne bien le jour demandé. */
export function lireEnAttente(jour: string): JourneeEnAttente | null {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return null;
    const journee = JSON.parse(brut) as JourneeEnAttente;
    // Une journée d'hier n'a plus lieu d'être envoyée : la contrainte d'unicité
    // porte sur le jour, et la renvoyer aujourd'hui écraserait la bonne.
    if (journee.jour !== jour) {
      oublierAttente();
      return null;
    }
    return journee;
  } catch {
    return null;
  }
}

export function oublierAttente(): void {
  try {
    localStorage.removeItem(CLE);
    prevenir();
  } catch {
    // Rien à faire, et rien de grave.
  }
}
