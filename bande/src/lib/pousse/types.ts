/**
 * Les types de notification, et ce qu'on en dit.
 *
 * Ce fichier n'a AUCUNE dépendance : l'écran de réglages est un composant
 * client, et prendre une constante dans un module qui touche Prisma entraînerait
 * `pg` — donc `net`, `tls`, `fs`, `dns` — dans le paquet du navigateur. C'est
 * la même leçon que `jeux/types.ts`, payée une fois.
 */

export const TYPES = ["journee", "commentaire", "reaction", "jeu", "scelle", "parole"] as const;
export type TypeNotification = (typeof TYPES)[number];

/**
 * Ce que chaque type raconte, dans l'écran de réglages.
 *
 * Le texte dit CE QU'ON VA RECEVOIR, pas le nom technique de l'événement :
 * « quand quelqu'un pose sa journée » se décide, « journee » ne se décide pas.
 */
export const LIBELLES: Record<TypeNotification, { titre: string; detail: string }> = {
  journee: {
    titre: "Quand quelqu'un pose sa journée",
    detail: "Une fois par personne et par jour, jamais plus.",
  },
  commentaire: {
    titre: "Les commentaires",
    detail: "Quand quelqu'un écrit sous une journée — la tienne ou une autre.",
  },
  reaction: {
    titre: "Les réactions",
    detail: "Les petits cœurs. Beaucoup de monde les coupe, et c'est très bien.",
  },
  jeu: {
    titre: "Quand une partie s'ouvre",
    detail: "Quelqu'un lance un jeu et attend que tu rejoignes.",
  },
  scelle: {
    titre: "Un scellé qui s'ouvre",
    detail: "Le jour dit, ce que la bande s'était envoyé il y a des mois.",
  },
  parole: {
    titre: "Ta propre voix, le lendemain",
    detail:
      "Le tribunal des idées te renvoie ton plaidoyer le lendemain matin. C'est le principe du jeu.",
  },
};

/**
 * Par défaut, tout est allumé SAUF les réactions.
 *
 * Une réaction n'appelle pas de réponse : une notification par petit cœur
 * transforme un geste léger en interruption. Le reste raconte quelque chose de
 * nouveau, donc mérite qu'on lève les yeux — et se coupe en deux touches.
 */
export const PAR_DEFAUT: Record<TypeNotification, boolean> = {
  journee: true,
  commentaire: true,
  reaction: false,
  jeu: true,
  scelle: true,
  parole: true,
};

/** Les préférences d'une personne, telles qu'elles sortent de la base. */
export function preferences(brut: unknown): Record<TypeNotification, boolean> {
  const lu = (brut ?? {}) as Record<string, unknown>;
  const sortie = { ...PAR_DEFAUT };
  for (const type of TYPES) {
    if (typeof lu[type] === "boolean") sortie[type] = lu[type];
  }
  return sortie;
}

/** Ce qu'une notification porte jusqu'au téléphone. */
export type Notification = {
  type: TypeNotification;
  titre: string;
  corps: string;
  /**
   * Où aller quand on la touche — un chemin de l'application, jamais une
   * adresse complète. C'est ce qui fait les liens profonds du lot Q.
   */
  vers: string;
  /**
   * Le regroupement. Deux notifications de même étiquette se remplacent au lieu
   * de s'empiler : trois commentaires sur la même journée font une ligne, pas
   * trois.
   */
  etiquette: string;
};
