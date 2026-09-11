import { JEUX } from "./catalogue";
import { SUSCEPTIBLES, DILEMMES, JUGEMENTS, THEMES_TOP3 } from "./contenu/dilemmes";
import { JAMAIS, type Niveau } from "./contenu/jamais";
import { COMPLOTS_A, COMPLOTS_B, MOTS_DE_PASSE, TRIBUNAL } from "./contenu/marie-janne";
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
/**
 * Cinq formes, pour treize jeux.
 *
 * · **vote** — tout le monde répond en même temps, on révèle ensemble ;
 * · **tour** — un joueur agit, les autres regardent ou jugent ;
 * · **reflexe** — on attend le signal, et le chrono départage ;
 * · **parole** — un joueur ENREGISTRE, les autres notent ce qu'ils ont entendu ;
 * · **fond** — le jeu ne demande pas d'écran : il dure toute la soirée pendant
 *   qu'on joue à autre chose, et on n'y revient que pour se griller.
 */
export type Archetype = "vote" | "tour" | "reflexe" | "parole" | "fond";

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
  /**
   * Ce que l'hôte a réglé pour la partie — le mode duel de « Le plus rapide »,
   * par exemple.
   *
   * Ces réglages voyagent dans les données de la phase, comme le reste : un
   * téléphone qui rejoint en cours de partie, ou qui recharge, les retrouve
   * sans rien demander à personne.
   */
  options: Record<string, unknown>;
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
  /**
   * Combien de manches avant le podium, pour les jeux qui se jouent en format
   * fermé. Les autres tournent jusqu'à ce qu'on décide d'arrêter — c'est très
   * bien pour « Je n'ai jamais », qui n'a pas de fin naturelle, et ce serait
   * absurde pour un tournoi de réflexe.
   */
  manches?: number;
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
   * « Le plus rapide » : tout est dans l'horloge.
   *
   * ## Le signal
   *
   * Le serveur annonce **à l'avance** deux instants : celui où le décompte
   * 3-2-1 commence, et celui du vert. Entre les deux, une attente tirée au sort
   * entre une et cinq secondes — sans elle, on part sur le « 1 » et le jeu ne
   * mesure plus rien. Chaque téléphone compte chez lui : le réseau n'entre pas
   * dans le geste.
   *
   * ## Ce qui départage
   *
   * Le temps de réaction est mesuré **localement**, en millisecondes, et c'est
   * lui qui classe. L'horodatage du serveur servait à ça au lot N ; il ajoutait
   * la latence du réseau au réflexe, ce qui se voit quand on affiche des
   * chiffres : deux cents millisecondes de 4G sur une réaction de deux cent
   * cinquante, c'est le classement d'un opérateur. Il reste comme départage en
   * cas d'égalité parfaite, où il ne peut plus rien fausser.
   *
   * ## Le duel
   *
   * À trois, l'hôte peut passer en duel : deux joueurs s'affrontent, le
   * troisième arbitre et voit les deux temps. Les duellistes tournent d'une
   * manche à l'autre.
   */
  "plus-rapide": {
    archetype: "reflexe",
    manches: 5,
    tirer: ({ joueurs, manche, options }) => {
      if (options.duel !== true || joueurs.length < 3) return {};
      const n = joueurs.length;
      return {
        duellistes: [
          joueurs[(manche * 2) % n].membreId,
          joueurs[(manche * 2 + 1) % n].membreId,
        ],
      };
    },
    enonce: () => "Appuie dès que ça passe au vert.",
    options: () => [],
    depouiller: (d, reponses, joueurs) => {
      const duellistes = Array.isArray(d.duellistes) ? (d.duellistes as string[]) : null;
      const enLice = duellistes
        ? reponses.filter((r) => duellistes.includes(r.membreId))
        : reponses;

      const valables = enLice.filter((r) => r.donnees.faux !== true && typeof r.donnees.ms === "number");
      const classees = [...valables].sort(
        (a, b) => (a.donnees.ms as number) - (b.donnees.ms as number) || a.quand.localeCompare(b.quand),
      );
      const premier = classees[0];
      const brules = enLice.filter((r) => r.donnees.faux === true);

      return {
        gains: premier ? [{ membreId: premier.membreId, delta: 1 }] : [],
        gorgees: brules.map((r) => ({ membreId: r.membreId, nombre: 1 })),
        verdict: premier
          ? `${nomDe(joueurs, premier.membreId)}, ${Math.round(premier.donnees.ms as number)} ms.`
          : brules.length > 0
            ? "Tout le monde a brûlé le départ."
            : "Personne n'a appuyé.",
      };
    },
  },

  /**
   * « Le mot de passe » : le seul jeu qui ne demande pas qu'on le regarde.
   *
   * Chacun reçoit un mot, et doit le placer dans la conversation sans se faire
   * griller. Le téléphone se pose sur la table, on joue à autre chose, et on ne
   * le reprend que pour accuser quelqu'un — c'est pour ça que le jeu est marqué
   * « de fond » au catalogue et ne bloque pas le lancement des autres.
   *
   * **Les trois mots voyagent dans la phase**, comme le nom de « Devine qui je
   * suis » voyage jusqu'à celui qui ne doit pas le voir : l'écran n'affiche que
   * le sien. Quelqu'un qui ouvre les outils de développement verrait les trois —
   * c'est un jeu entre trois amis, pas un protocole, et le dire est plus honnête
   * que de faire semblant.
   */
  "mot-de-passe": {
    archetype: "fond",
    tirer: ({ joueurs, hasard }) => {
      const paquet = [...MOTS_DE_PASSE];
      const mots: Record<string, string> = {};
      for (const joueur of joueurs) {
        const i = Math.floor(hasard() * paquet.length);
        mots[joueur.membreId] = paquet.splice(i, 1)[0] ?? "moutarde";
      }
      return { mots };
    },
    enonce: () => "Place ton mot sans te faire griller.",
    options: () => [],
    depouiller: (d, reponses, joueurs) => {
      const mots = (d.mots ?? {}) as Record<string, string>;
      const gains: { membreId: string; delta: number }[] = [];
      const justes: string[] = [];

      // Une accusation : « j'ai entendu le mot de X ». Juste, elle rapporte un
      // point à l'accusateur ET grille l'accusé ; à côté, elle en coûte un.
      for (const reponse of reponses) {
        const vise = typeof reponse.donnees.vise === "string" ? reponse.donnees.vise : null;
        const dit = typeof reponse.donnees.mot === "string" ? reponse.donnees.mot : "";
        if (!vise) continue;
        const juste = normaliser(dit) === normaliser(mots[vise] ?? "");
        gains.push({ membreId: reponse.membreId, delta: juste ? 1 : -1 });
        if (juste) justes.push(`${nomDe(joueurs, reponse.membreId)} a grillé ${nomDe(joueurs, vise)}`);
      }

      return {
        gains,
        gorgees: [],
        verdict: justes.length > 0 ? `${justes.join(" · ")}.` : "Personne n'a rien vu venir.",
      };
    },
  },

  /**
   * « La théorie du complot » : quatre-vingt-dix secondes pour relier deux
   * choses sans rapport, enregistrées.
   *
   * Le jeu n'est pas dans la note, il est dans la réécoute : l'audio part dans
   * les souvenirs, et c'est là qu'il sert vraiment.
   */
  complot: {
    archetype: "parole",
    manches: 6,
    acteur: ({ joueurs, manche }) => joueurs[manche % joueurs.length].membreId,
    tirer: ({ hasard }) => ({
      a: tirerDans(COMPLOTS_A, hasard),
      b: tirerDans(COMPLOTS_B, hasard),
      secondes: 90,
    }),
    enonce: (d) => `${String(d.a ?? "")} et ${String(d.b ?? "")}`,
    enonceActeur: (d) =>
      `Relie ${String(d.a ?? "")} et ${String(d.b ?? "")}. Quatre-vingt-dix secondes.`,
    options: () => [],
    depouiller: (d, reponses, joueurs) => {
      const acteur = typeof d.acteur === "string" ? d.acteur : null;
      const notes = reponses
        .filter((r) => r.membreId !== acteur && typeof r.donnees.note === "number")
        .map((r) => r.donnees.note as number);
      if (!acteur || notes.length === 0) return rien;

      const total = notes.reduce((somme, n) => somme + n, 0);
      const moyenne = total / notes.length;
      return {
        // La moyenne sur dix devient des points : une théorie à 8/10 vaut quatre
        // points, une à 2/10 en vaut un. Personne ne repart à zéro pour avoir
        // parlé quatre-vingt-dix secondes.
        gains: [{ membreId: acteur, delta: Math.max(1, Math.round(moyenne / 2)) }],
        gorgees: [],
        verdict: `${nomDe(joueurs, acteur)} : ${moyenne.toFixed(1).replace(".", ",")} sur 10.`,
      };
    },
  },

  /**
   * « Le tribunal des idées » : soixante secondes pour défendre une invention,
   * enregistrées, puis les autres votent.
   *
   * Le lendemain matin, l'application renvoie son propre audio à celui qui a
   * plaidé. C'est le principe du jeu, et c'est le lot Q qui pose la
   * notification — la parole, elle, est gardée dès maintenant.
   */
  tribunal: {
    archetype: "parole",
    manches: 6,
    acteur: ({ joueurs, manche }) => joueurs[manche % joueurs.length].membreId,
    tirer: ({ hasard }) => ({ amorce: tirerDans(TRIBUNAL, hasard), secondes: 60 }),
    enonce: (d) => String(d.amorce ?? ""),
    enonceActeur: (d) => `${String(d.amorce ?? "")} Soixante secondes.`,
    options: () => [
      { cle: "oui", libelle: "Ça se finance" },
      { cle: "non", libelle: "Ça ne se finance pas" },
    ],
    depouiller: (d, reponses, joueurs) => {
      const acteur = typeof d.acteur === "string" ? d.acteur : null;
      const votes = reponses.filter((r) => r.membreId !== acteur);
      if (!acteur || votes.length === 0) return rien;

      const pour = votes.filter((r) => choix(r) === "oui").length;
      return {
        gains: pour > votes.length / 2 ? [{ membreId: acteur, delta: 3 }] : [],
        gorgees: [],
        verdict:
          pour > votes.length / 2
            ? `Financé. ${nomDe(joueurs, acteur)} empoche trois points.`
            : `Rejeté. ${nomDe(joueurs, acteur)} repart avec son idée.`,
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
