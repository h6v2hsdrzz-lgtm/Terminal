/**
 * L'état que les actions serveur renvoient aux formulaires.
 *
 * Il vit dans son propre fichier parce qu'un module « use server » ne peut
 * exporter que des fonctions asynchrones : tout ce qui n'en est pas — un type,
 * une constante — fait échouer la compilation avec un message qui ne pointe
 * pas vers la bonne ligne.
 */
export type Etat = { erreur: string | null };

export const ETAT_INITIAL: Etat = { erreur: null };
