/**
 * La forme des clés d'objet.
 *
 * Elles vivent à part, sans la moindre dépendance : le script de migration s'en
 * sert hors de Next, les routes s'en servent dedans, et les deux doivent
 * fabriquer exactement la même chaîne. Une clé calculée à deux endroits
 * différents est une photo perdue le jour où l'un des deux change.
 *
 * Le préfixe dit ce que c'est. Il ne sert pas à ranger — R2 n'a pas de dossiers
 * — mais à lire un seau à l'œil nu quand quelque chose cloche.
 */
export function cleMedia(mediaId: string, vignette = false): string {
  return `${vignette ? "vignettes" : "medias"}/${mediaId}`;
}

/**
 * L'audio se range sous l'identifiant de la JOURNÉE, pas le sien.
 *
 * Il y en a au plus un par journée, et réenregistrer doit écraser l'objet
 * précédent plutôt qu'en laisser un orphelin à chaque prise.
 */
export function cleAudio(entreeId: string): string {
  return `audio/${entreeId}`;
}

export function cleCapsule(capsuleId: string): string {
  return `scelles/${capsuleId}`;
}
