/**
 * Ce qui a changé, en trois écrans.
 *
 * Personne ne lit un journal des versions. Tout le monde fait défiler trois
 * écrans. C'est la même information, rangée dans la seule forme qui se lit.
 *
 * ## Les règles de ce fichier
 *
 * · **trois à cinq écrans par version, pas plus.** Au sixième, on referme ;
 * · **ce qu'on peut FAIRE**, pas ce qui a été codé. « Cherche un mot » et pas
 *   « recherche full-text sans accent » ;
 * · **le ton de la bande**, pas celui d'une note de service.
 *
 * Aucune dépendance : l'écran qui l'affiche est un composant client.
 */

export type EcranNouveaute = {
  emoji: string;
  titre: string;
  texte: string;
};

export type Nouveaute = {
  /** Ce qui est retenu comme « déjà vu ». Se compare, ne s'ordonne pas. */
  version: string;
  /** Ce que la version apporte, en une ligne, pour la liste. */
  resume: string;
  ecrans: EcranNouveaute[];
};

/** De la plus récente à la plus ancienne. La première est celle qu'on montre. */
export const NOUVEAUTES: Nouveaute[] = [
  {
    version: "vague-2",
    resume: "Les jeux à trois téléphones, deux graphiques, la recherche, les notifications.",
    ecrans: [
      {
        emoji: "🎲",
        titre: "Chacun son téléphone",
        texte:
          "Les treize jeux se jouent maintenant à trois écrans. Plus de téléphone qu'on se passe autour de la table : tout le monde voit la même manche en même temps, chacun répond de son côté, et l'écran change quand il faut.",
      },
      {
        emoji: "🔥",
        titre: "Le registre a changé",
        texte:
          "Les cartes ont été réécrites. Aucune ne ressemble plus à un jeu de séminaire d'entreprise. Si une question vous met mal à l'aise, c'est qu'elle est au bon niveau — et on peut toujours passer.",
      },
      {
        emoji: "🔍",
        titre: "Chercher dans le journal",
        texte:
          "La loupe, en haut du fil. Un mot, un lieu, un prénom : les journées, les commentaires, les légendes des photos. Les accents ne comptent pas, « ete » trouve « été ».",
      },
      {
        emoji: "🔔",
        titre: "Être prévenu, ou pas",
        texte:
          "Six types de notification, à régler un par un. Les réactions sont coupées par défaut — un petit cœur n'appelle pas de réponse. Tout se coupe en deux touches dans les réglages.",
      },
      {
        emoji: "💾",
        titre: "Tout emporter, pour de vrai",
        texte:
          "La sauvegarde complète emporte aussi les photos et les vocaux, dans un seul fichier. Et elle se remet en place aussi facilement : rien n'est écrasé, une journée déjà là reste comme elle est.",
      },
    ],
  },
];

export const VERSION_COURANTE = NOUVEAUTES[0].version;

/** Ce qu'on retient dans le navigateur pour ne pas le remontrer. */
export const CLE_VUE = "joie-nouveautes-vue";
