/**
 * Le mouvement de l'application, en un seul endroit.
 *
 * Les ressorts étaient écrits à la main dans chaque composant — `stiffness: 420`
 * trois fois, `damping: 34` trois fois, et une dizaine de valeurs voisines mais
 * jamais identiques. Le résultat se voyait : deux éléments qui apparaissent
 * ensemble n'arrivaient pas ensemble.
 *
 * Quatre ressorts nommés par leur usage, pas par leurs chiffres. On choisit
 * « vif » ou « ample », pas « 420 » ou « 260 ».
 */
export const RESSORT = {
  /** Ce qui suit le doigt : pastilles, bascules, onglet actif. */
  vif: { type: "spring", stiffness: 420, damping: 34 } as const,
  /** L'entrée d'une carte, l'ouverture d'un panneau. */
  moyen: { type: "spring", stiffness: 340, damping: 30 } as const,
  /** Ce qui prend de la place à l'écran : révélation, feuille modale. */
  ample: { type: "spring", stiffness: 260, damping: 28 } as const,
  /** Un chiffre qui change, un visage qui se déforme. */
  chiffre: { type: "spring", stiffness: 500, damping: 30 } as const,
} as const;

/** Les fondus, en millisecondes. Un fondu n'a pas de masse : pas de ressort. */
export const DUREE = {
  court: 0.16,
  moyen: 0.25,
  long: 0.4,
} as const;

/**
 * Le décalage entre deux éléments d'une même liste qui apparaissent.
 *
 * Au-delà de trois ou quatre cartes, un décalage fixe donne l'impression que
 * l'application rame : on plafonne le retard total.
 */
export function retard(index: number, pas = 0.06, plafond = 0.24): number {
  return Math.min(index * pas, plafond);
}
