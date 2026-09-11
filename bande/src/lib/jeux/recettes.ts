import { JEUX } from "./catalogue";
import { SUSCEPTIBLES, DILEMMES, JUGEMENTS, THEMES_TOP3 } from "./contenu/dilemmes";
import { JAMAIS, type Niveau } from "./contenu/jamais";
import { toutesLesCartes } from "./contenu/paquets";
import { normaliser, POINTS_PLACE, POINTS_PRESENT } from "./top3";
import { depouiller } from "./vote";
import type { Joueur } from "./types";

/**
 * Ce que chaque jeu fait d'une manche, à plusieurs téléphones.
 *
 * Dix jeux, mais **trois formes** seulement — et c'est la découverte qui rend
 * ce lot faisable. Tout ce qui distingue les dix, une fois le multi en place,
 * c'est ce qu'on tire, ce qu'on demande, et comment on compte :
 *
 * · **vote** — tout le monde répond en même temps, on révèle ensemble ;
 * · **tour** — un joueur agit, les autres regardent ou jugent ;
 * · **réflexe** — on attend le signal, et le serveur départage.
 *
 * Écrire dix moteurs séparés aurait fait dix fois les mêmes bogues de
 * synchronisation. Ici, la synchronisation est écrite une fois, et chaque jeu
 * n'apporte que ses trois fonctions.
 *
 * Rien ici ne touche au réseau ni au DOM : ce sont des fonctions pures, et
 * elles se testent comme telles.
 */
export type Archetype = "vote" | "tour" | "reflexe";

export type Reponse = { membreId: string; donnees: Record<string, unknown>; quand: string };

export type Depouillement = {
  /** Points à ajouter, par personne. */
  gains: { membreId: string; delta: number }[];
  /** Gorgées à prendre, par personne. Le cadre les plafonne plus loin. */
  gorgees: { membreId: string; nombre: number }[];
  /** Ce qu'on affiche en gros à la révélation. */
  verdict: string;
};

export type ContexteTirage = {
  manche: number;
  hasard: () => number;
  joueurs: Joueur[];
  /** Les cartes maison, pour « Devine qui je suis ». */
  cartesMaison: string[];
  /** Les niveaux choisis pour « Je n'ai jamais ». */
  niveaux: Niveau[];
  /** Tirées du journal, pour les deux jeux qui s'en nourrissent. */
  duJournal: { enonce: string; reponse: string; options: string[] }[];
};

export type Recette = {
  archetype: Archetype;
  /** Ce que l'hôte publie pour la manche. Lu par tous les écrans. */
  tirer: (contexte: ContexteTirage) => Record<string, unknown>;
  /** L'énoncé, en grand, au milieu de l'écran. */
  enonce: (donnees: Record<string, unknown>) => string;
  /** Ce qu'on propose de répondre. Vide = une réponse libre. */
  options: (
    donnees: Record<string, unknown>,
    joueurs: Joueur[],
    moi: string,
  ) => { cle: string; libelle: string }[];
  /** Qui marque, qui boit, et ce qu'on affiche. */
  depouiller: (
    donnees: Record<string, unknown>,
    reponses: Reponse[],
    joueurs: Joueur[],
  ) => Depouillement;
  /** Pour les jeux « tour » : qui agit à cette manche. */
  acteur?: (contexte: ContexteTirage) => string;
  /** Ce que voit l'acteur, quand ce n'est pas ce que voient les autres. */
  enonceActeur?: (donnees: Record<string, unknown>) => string;
};

const rien: Depouillement = { gains: [], gorgees: [], verdict: "" };

/** Le choix d'un joueur, en chaîne, ou `null`. */
function choix(reponse: Reponse | undefined): string | null {
  const valeur = reponse?.donnees.choix;
  return typeof valeur === "string" ? valeur : null;
}

function parJoueur(reponses: Reponse[]): Record<string, string> {
  const carte: Record<string, string> = {};
  for (const reponse of reponses) {
    const c = choix(reponse);
    if (c !== null) carte[reponse.membreId] = c;
  }
  return carte;
}

function tirerDans<T>(paquet: readonly T[], hasard: () => number): T {
  return paquet[Math.floor(hasard() * paquet.length)];
}

const nomDe = (joueurs: Joueur[], id: string) =>
  joueurs.find((j) => j.membreId === id)?.pseudo ?? "quelqu'un";

export const RECETTES: Record<string, Recette> = {
  /**
   * « Je n'ai jamais » : la carte est la même pour tous, et chacun dit s'il
   * l'a fait. Personne ne marque — ce jeu-là ne se gagne pas, c'est un jeu
   * d'aveux, et y mettre un score en changerait la nature.
   */
  jamais: {
    archetype: "vote",
    tirer: ({ hasard, niveaux }) => ({
      carte: tirerDans(niveaux.flatMap((n) => JAMAIS[n]), hasard),
    }),
    enonce: (d) => `« Je n'ai jamais ${d.carte}. »`,
    options: () => [
      { cle: "fait", libelle: "Je l'ai fait" },
      { cle: "jamais", libelle: "Jamais" },
    ],
    depouiller: (_d, reponses, joueurs) => {
      const coupables = reponses.filter((r) => choix(r) === "fait");
      return {
        gains: [],
        gorgees: coupables.map((r) => ({ membreId: r.membreId, nombre: 1 })),
        verdict:
          coupables.length === 0
            ? "Personne. Suspect."
            : coupables.length === joueurs.length
              ? "Tout le monde. Évidemment."
              : coupables.map((r) => nomDe(joueurs, r.membreId)).join(", "),
      };
    },
  },

  /**
   * « Tu préfères » : on ne cherche pas la bonne réponse — il n'y en a pas —
   * mais à deviner ce que les autres vont choisir. La minorité boit, la
   * majorité marque.
   */
  prefere: {
    archetype: "vote",
    tirer: ({ hasard }) => {
      const [a, b] = tirerDans(DILEMMES, hasard);
      return { a, b };
    },
    enonce: () => "Tu préfères…",
    options: (d) => [
      { cle: "a", libelle: String(d.a) },
      { cle: "b", libelle: String(d.b) },
    ],
    depouiller: (_d, reponses, joueurs) => {
      const votes = parJoueur(reponses);
      const { minoritaire } = depouiller(votes, ["a", "b"]);
      if (minoritaire === null) {
        return { ...rien, verdict: "Égalité. Personne ne boit." };
      }
      const perdants = Object.entries(votes).filter(([, v]) => v === minoritaire);
      const gagnants = Object.entries(votes).filter(([, v]) => v !== minoritaire);
      return {
        gains: gagnants.map(([membreId]) => ({ membreId, delta: 1 })),
        gorgees: perdants.map(([membreId]) => ({ membreId, nombre: 1 })),
        verdict: `${perdants.map(([id]) => nomDe(joueurs, id)).join(", ")} en minorité.`,
      };
    },
  },

  /**
   * « Qui est le plus susceptible de » : chacun désigne quelqu'un, le plus
   * désigné boit. Voter pour soi est autorisé, et c'est souvent le plus drôle.
   */
  susceptible: {
    archetype: "vote",
    tirer: ({ hasard }) => ({ situation: tirerDans(SUSCEPTIBLES, hasard) }),
    enonce: (d) => `Qui est le plus susceptible de ${d.situation} ?`,
    options: (_d, joueurs) =>
      joueurs.map((j) => ({ cle: j.membreId, libelle: j.pseudo })),
    depouiller: (_d, reponses, joueurs) => {
      const comptes = new Map<string, number>();
      for (const reponse of reponses) {
        const c = choix(reponse);
        if (c) comptes.set(c, (comptes.get(c) ?? 0) + 1);
      }
      const maximum = Math.max(0, ...comptes.values());
      if (maximum === 0) return rien;
      const designes = [...comptes].filter(([, n]) => n === maximum).map(([id]) => id);
      return {
        gains: [],
        gorgees: designes.map((membreId) => ({ membreId, nombre: 1 })),
        verdict:
          designes.length === 1
            ? `${nomDe(joueurs, designes[0])}, sans surprise.`
            : `${designes.map((id) => nomDe(joueurs, id)).join(" et ")}, à égalité.`,
      };
    },
  },

  /**
   * « Devine qui a écrit ça » : une note du journal, et il faut retrouver son
   * auteur. Un point par bonne réponse.
   */
  "qui-a-ecrit": {
    archetype: "vote",
    tirer: ({ hasard, duJournal }) =>
      duJournal.length > 0
        ? (tirerDans(duJournal, hasard) as unknown as Record<string, unknown>)
        : { enonce: "Pas encore assez de journées écrites.", reponse: "", options: [] },
    enonce: (d) => `« ${d.enonce} »`,
    options: (d, joueurs) =>
      (Array.isArray(d.options) ? (d.options as string[]) : joueurs.map((j) => j.membreId)).map(
        (id) => ({ cle: id, libelle: nomDe(joueurs, id) }),
      ),
    depouiller: (d, reponses, joueurs) => {
      const bonne = String(d.reponse ?? "");
      const justes = reponses.filter((r) => choix(r) === bonne);
      return {
        gains: justes.map((r) => ({ membreId: r.membreId, delta: 1 })),
        gorgees: [],
        verdict: bonne ? `C'était ${nomDe(joueurs, bonne)}.` : "",
      };
    },
  },

  /** « Le quiz de la bande » : même mécanique, questions tirées du journal. */
  "quiz-bande": {
    archetype: "vote",
    tirer: ({ hasard, duJournal }) =>
      duJournal.length > 0
        ? (tirerDans(duJournal, hasard) as unknown as Record<string, unknown>)
        : { enonce: "Pas encore assez de journées écrites.", reponse: "", options: [] },
    enonce: (d) => String(d.enonce ?? ""),
    options: (d) =>
      (Array.isArray(d.options) ? (d.options as string[]) : []).map((o) => ({
        cle: o,
        libelle: o,
      })),
    depouiller: (d, reponses) => {
      const bonne = String(d.reponse ?? "");
      const justes = reponses.filter((r) => choix(r) === bonne);
      return {
        gains: justes.map((r) => ({ membreId: r.membreId, delta: 1 })),
        gorgees: [],
        verdict: bonne ? `Réponse : ${bonne}.` : "",
      };
    },
  },

  /**
   * « Top 3 » : un thème, chacun écrit trois choses, et on marque sur les
   * recoupements. Deux points quand c'est à la même place, un quand c'est
   * seulement présent — la règle vient de `top3.ts`, elle ne bouge pas.
   */
  top3: {
    archetype: "vote",
    tirer: ({ hasard }) => ({ theme: tirerDans(THEMES_TOP3, hasard) }),
    enonce: (d) => String(d.theme ?? ""),
    options: () => [],
    depouiller: (_d, reponses, joueurs) => {
      const listes = new Map<string, string[]>();
      for (const reponse of reponses) {
        const brut = reponse.donnees.liste;
        if (Array.isArray(brut)) {
          listes.set(reponse.membreId, brut.map((x) => normaliser(String(x))).filter(Boolean));
        }
      }
      const gains: { membreId: string; delta: number }[] = [];
      for (const [membreId, liste] of listes) {
        let points = 0;
        for (const [autre, sienne] of listes) {
          if (autre === membreId) continue;
          liste.forEach((mot, place) => {
            const ou = sienne.indexOf(mot);
            if (ou === place) points += POINTS_PLACE;
            else if (ou >= 0) points += POINTS_PRESENT;
          });
        }
        if (points > 0) gains.push({ membreId, delta: points });
      }
      const meilleur = gains.sort((a, b) => b.delta - a.delta)[0];
      return {
        gains,
        gorgees: [],
        verdict: meilleur
          ? `${nomDe(joueurs, meilleur.membreId)} a le plus de points communs.`
          : "Aucun recoupement. Vous ne vous connaissez pas du tout.",
      };
    },
  },

  /**
   * « Le jugement » : un juge pose, les autres répondent, le juge tranche.
   * Archétype « tour », parce que l'écran du juge ne montre pas la même chose.
   */
  jugement: {
    archetype: "tour",
    acteur: ({ joueurs, manche }) => joueurs[manche % joueurs.length].membreId,
    tirer: ({ hasard }) => ({ question: tirerDans(JUGEMENTS, hasard) }),
    enonce: (d) => String(d.question ?? ""),
    enonceActeur: (d) => `Tu juges : ${String(d.question ?? "")}`,
    options: () => [],
    depouiller: (d, reponses, joueurs) => {
      const gagnant = typeof d.gagnant === "string" ? d.gagnant : null;
      void reponses;
      return gagnant
        ? {
            gains: [{ membreId: gagnant, delta: 2 }],
            gorgees: joueurs
              .filter((j) => j.membreId !== gagnant && j.membreId !== d.acteur)
              .map((j) => ({ membreId: j.membreId, nombre: 1 })),
            verdict: `${nomDe(joueurs, gagnant)} l'emporte.`,
          }
        : rien;
    },
  },

  /**
   * « Menteur » : un joueur écrit trois affirmations, une seule est fausse.
   * Les autres cherchent laquelle.
   */
  menteur: {
    archetype: "tour",
    acteur: ({ joueurs, manche }) => joueurs[manche % joueurs.length].membreId,
    tirer: () => ({}),
    enonce: () => "Laquelle est fausse ?",
    enonceActeur: () => "Écris trois choses sur toi. Une seule est fausse.",
    options: (d) =>
      (Array.isArray(d.affirmations) ? (d.affirmations as string[]) : []).map((texte, i) => ({
        cle: String(i),
        libelle: texte,
      })),
    depouiller: (d, reponses, joueurs) => {
      const fausse = String(d.fausse ?? "");
      const justes = reponses.filter((r) => choix(r) === fausse);
      const acteur = typeof d.acteur === "string" ? d.acteur : null;
      return {
        gains: [
          ...justes.map((r) => ({ membreId: r.membreId, delta: 1 })),
          // Le menteur marque s'il n'a trompé personne… pardon : s'il les a
          // tous trompés. C'est ce qui récompense un bon mensonge.
          ...(acteur && justes.length === 0 ? [{ membreId: acteur, delta: 2 }] : []),
        ],
        gorgees: [],
        verdict:
          justes.length === 0
            ? "Personne n'a vu le mensonge."
            : `${justes.map((r) => nomDe(joueurs, r.membreId)).join(", ")} ont vu clair.`,
      };
    },
  },

  /**
   * « Devine qui je suis » : le nom s'affiche chez les AUTRES, pas chez celui
   * qui devine. Le multi règle enfin le problème du téléphone sur le front —
   * il n'y a plus de front, l'acteur regarde son écran comme tout le monde,
   * et c'est le seul écran qui ne dit pas le mot.
   */
  "devine-qui": {
    archetype: "tour",
    acteur: ({ joueurs, manche }) => joueurs[manche % joueurs.length].membreId,
    tirer: ({ hasard, cartesMaison }) => {
      const paquet = cartesMaison.length > 0 ? cartesMaison : toutesLesCartes();
      return { carte: tirerDans(paquet, hasard) };
    },
    enonce: (d) => String(d.carte ?? ""),
    enonceActeur: () => "À toi de deviner. Ils te font signe.",
    options: () => [],
    depouiller: (d, _reponses, joueurs) => {
      const trouve = d.trouve === true;
      const acteur = typeof d.acteur === "string" ? d.acteur : null;
      return {
        gains: trouve && acteur ? [{ membreId: acteur, delta: 1 }] : [],
        gorgees: [],
        verdict: trouve ? `Trouvé — ${nomDe(joueurs, acteur ?? "")} marque.` : "Passé.",
      };
    },
  },

  /**
   * « Le plus rapide » : tout est dans l'horloge. Le serveur annonce l'instant
   * du signal, chaque téléphone compte à rebours chez lui, et c'est
   * l'horodatage du serveur qui départage — sinon celui qui a la meilleure 4G
   * gagne toujours.
   */
  "plus-rapide": {
    archetype: "reflexe",
    tirer: () => ({}),
    enonce: () => "Appuie dès que ça passe au vert.",
    options: () => [],
    depouiller: (_d, reponses, joueurs) => {
      const valables = reponses.filter((r) => r.donnees.faux !== true);
      const premier = [...valables].sort((a, b) => a.quand.localeCompare(b.quand))[0];
      const brules = reponses.filter((r) => r.donnees.faux === true);
      return {
        gains: premier ? [{ membreId: premier.membreId, delta: 1 }] : [],
        gorgees: brules.map((r) => ({ membreId: r.membreId, nombre: 1 })),
        verdict: premier
          ? `${nomDe(joueurs, premier.membreId)} d'abord.`
          : "Personne n'a appuyé.",
      };
    },
  },
};

/** Les jeux qui savent se jouer à plusieurs téléphones. */
export function recetteDe(cle: string): Recette | null {
  return RECETTES[cle] ?? null;
}

/** Vérifie au démarrage que le catalogue et les recettes ne divergent pas. */
export function jeuxSansRecette(): string[] {
  return JEUX.map((j) => j.cle).filter((cle) => !RECETTES[cle]);
}
