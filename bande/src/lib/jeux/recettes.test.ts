import { describe, expect, it } from "vitest";

import { JEUX } from "./catalogue";
import { RECETTES, jeuxSansRecette, recetteDe, type Reponse } from "./recettes";
import type { Joueur } from "./types";

const JOUEURS: Joueur[] = ["momo", "sam", "samy"].map((membreId, i) => ({
  membreId,
  pseudo: membreId[0].toUpperCase() + membreId.slice(1),
  teinte: i + 1,
  initiales: membreId.slice(0, 2).toUpperCase(),
  avatar: null,
  points: 0,
  sobre: false,
  ordre: i,
}));

const repondre = (membreId: string, donnees: Record<string, unknown>, quand = "2026-09-11T20:00:00.000Z"): Reponse => ({
  membreId,
  donnees,
  quand,
});

describe("le catalogue et les recettes", () => {
  it("couvre TOUS les jeux du catalogue, sans exception", () => {
    // Un jeu au catalogue sans recette est un jeu qui s'ouvre et ne joue pas.
    // Ça s'est produit, et ça ne s'est vu qu'en jouant : d'où ce test, qui
    // rougit au moment où le jeu est ajouté et pas trois semaines plus tard.
    expect(jeuxSansRecette()).toEqual([]);
    expect(Object.keys(RECETTES)).toHaveLength(JEUX.length);
  });

  it("n'invente pas de jeu qui n'existe pas", () => {
    for (const cle of Object.keys(RECETTES)) {
      expect(JEUX.some((j) => j.cle === cle)).toBe(true);
    }
    expect(recetteDe("inexistant")).toBeNull();
  });

  it("donne un acteur à tous les jeux où quelqu'un passe, et à eux seuls", () => {
    // Deux archétypes ont un joueur qui agit pendant que les autres regardent :
    // « tour » et « parole ». Les autres n'en ont pas, et en donner un ferait
    // attendre tout le monde pour rien.
    const avecActeur = new Set(["tour", "parole"]);
    for (const [cle, recette] of Object.entries(RECETTES)) {
      expect(typeof recette.acteur === "function", cle).toBe(avecActeur.has(recette.archetype));
    }
  });
});

describe("« Je n'ai jamais »", () => {
  const recette = RECETTES.jamais;

  it("fait boire ceux qui avouent, et personne d'autre", () => {
    const bilan = recette.depouiller(
      { carte: "menti" },
      [repondre("momo", { choix: "fait" }), repondre("sam", { choix: "jamais" })],
      JOUEURS,
    );
    expect(bilan.gorgees).toEqual([{ membreId: "momo", nombre: 1 }]);
  });

  it("ne donne aucun point : ce jeu ne se gagne pas", () => {
    const bilan = recette.depouiller({ carte: "x" }, [repondre("momo", { choix: "fait" })], JOUEURS);
    expect(bilan.gains).toEqual([]);
  });
});

describe("« Tu préfères »", () => {
  const recette = RECETTES.prefere;

  it("fait boire la minorité et marque la majorité", () => {
    const bilan = recette.depouiller(
      { a: "A", b: "B" },
      [
        repondre("momo", { choix: "a" }),
        repondre("sam", { choix: "a" }),
        repondre("samy", { choix: "b" }),
      ],
      JOUEURS,
    );
    expect(bilan.gorgees).toEqual([{ membreId: "samy", nombre: 1 }]);
    expect(bilan.gains.map((g) => g.membreId).sort()).toEqual(["momo", "sam"]);
  });

  it("ne fait boire personne sur une unanimité", () => {
    // Deviner une majorité unanime n'est pas un exploit.
    const bilan = recette.depouiller(
      { a: "A", b: "B" },
      JOUEURS.map((j) => repondre(j.membreId, { choix: "a" })),
      JOUEURS,
    );
    expect(bilan.gorgees).toEqual([]);
    expect(bilan.gains).toEqual([]);
  });
});

describe("« Qui est le plus susceptible »", () => {
  it("fait boire le plus désigné", () => {
    const bilan = RECETTES.susceptible.depouiller(
      { situation: "rater un avion" },
      [
        repondre("momo", { choix: "samy" }),
        repondre("sam", { choix: "samy" }),
        repondre("samy", { choix: "momo" }),
      ],
      JOUEURS,
    );
    expect(bilan.gorgees).toEqual([{ membreId: "samy", nombre: 1 }]);
  });

  it("fait boire les deux en cas d'égalité", () => {
    const bilan = RECETTES.susceptible.depouiller(
      { situation: "x" },
      [repondre("momo", { choix: "sam" }), repondre("sam", { choix: "momo" })],
      JOUEURS,
    );
    expect(bilan.gorgees.map((g) => g.membreId).sort()).toEqual(["momo", "sam"]);
  });
});

describe("« Le plus rapide »", () => {
  const recette = RECETTES["plus-rapide"];

  it("classe sur le temps de réaction, pas sur l'ordre d'arrivée au serveur", () => {
    // Le geste est mesuré sur le téléphone. L'horodatage du serveur y ajoutait
    // la latence du réseau : deux cents millisecondes de 4G sur une réaction de
    // deux cent cinquante, et le jeu classait les opérateurs.
    const bilan = recette.depouiller(
      {},
      [
        repondre("sam", { ms: 210 }, "2026-09-11T20:00:00.120Z"),
        repondre("momo", { ms: 180 }, "2026-09-11T20:00:00.300Z"),
      ],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([{ membreId: "momo", delta: 1 }]);
    expect(bilan.verdict).toBe("Momo, 180 ms.");
  });

  it("départage deux temps identiques sur l'horodatage du serveur", () => {
    const bilan = recette.depouiller(
      {},
      [
        repondre("sam", { ms: 200 }, "2026-09-11T20:00:00.300Z"),
        repondre("momo", { ms: 200 }, "2026-09-11T20:00:00.120Z"),
      ],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([{ membreId: "momo", delta: 1 }]);
  });

  it("fait boire ceux qui ont brûlé le départ, et ne les fait pas gagner", () => {
    const bilan = recette.depouiller(
      {},
      [
        repondre("momo", { faux: true }, "2026-09-11T20:00:00.010Z"),
        repondre("sam", { ms: 400 }, "2026-09-11T20:00:00.400Z"),
      ],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([{ membreId: "sam", delta: 1 }]);
    expect(bilan.gorgees).toEqual([{ membreId: "momo", nombre: 1 }]);
  });

  it("en duel, ne compte que les deux duellistes", () => {
    // Le troisième arbitre. S'il appuie quand même — c'est un téléphone, et une
    // main traîne toujours — sa réponse ne doit ni gagner ni faire boire.
    const bilan = recette.depouiller(
      { duellistes: ["momo", "sam"] },
      [
        repondre("samy", { ms: 90 }),
        repondre("momo", { ms: 240 }),
        repondre("sam", { ms: 260 }),
      ],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([{ membreId: "momo", delta: 1 }]);
  });

  it("tire deux duellistes différents d'une manche à l'autre", () => {
    const contexte = (manche: number) => ({
      manche,
      hasard: () => 0.5,
      joueurs: JOUEURS,
      cartesMaison: [],
      niveaux: [] as never,
      duJournal: [],
      options: { duel: true },
    });
    const un = recette.tirer(contexte(1)).duellistes as string[];
    const deux = recette.tirer(contexte(2)).duellistes as string[];
    expect(new Set(un).size).toBe(2);
    expect(un).not.toEqual(deux);
  });

  it("sans le mode duel, tout le monde joue", () => {
    const tire = recette.tirer({
      manche: 1,
      hasard: () => 0.5,
      joueurs: JOUEURS,
      cartesMaison: [],
      niveaux: [] as never,
      duJournal: [],
      options: {},
    });
    expect(tire.duellistes).toBeUndefined();
  });

  it("se joue au meilleur de cinq, et le dit", () => {
    expect(recette.manches).toBe(5);
  });
});

describe("« Menteur »", () => {
  it("récompense ceux qui trouvent le mensonge", () => {
    const bilan = RECETTES.menteur.depouiller(
      { fausse: "1", acteur: "momo", affirmations: ["a", "b", "c"] },
      [repondre("sam", { choix: "1" }), repondre("samy", { choix: "0" })],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([{ membreId: "sam", delta: 1 }]);
  });

  it("récompense le menteur quand il n'a trompé personne… l'inverse", () => {
    const bilan = RECETTES.menteur.depouiller(
      { fausse: "2", acteur: "momo", affirmations: ["a", "b", "c"] },
      [repondre("sam", { choix: "0" }), repondre("samy", { choix: "1" })],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([{ membreId: "momo", delta: 2 }]);
  });
});

describe("« Top 3 »", () => {
  it("compte deux points à la même place, un quand c'est seulement présent", () => {
    const bilan = RECETTES.top3.depouiller(
      { theme: "films" },
      [
        repondre("momo", { liste: ["Matrix", "Alien", "Heat"] }),
        repondre("sam", { liste: ["Matrix", "Heat", "Dune"] }),
      ],
      JOUEURS,
    );
    // Matrix à la même place (2) + Heat présent ailleurs (1) = 3, des deux côtés.
    expect(bilan.gains.map((g) => g.delta)).toEqual([3, 3]);
  });

  it("ne donne rien quand personne ne se recoupe", () => {
    const bilan = RECETTES.top3.depouiller(
      { theme: "films" },
      [
        repondre("momo", { liste: ["A", "B", "C"] }),
        repondre("sam", { liste: ["D", "E", "F"] }),
      ],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([]);
  });
});

describe("« Le mot de passe »", () => {
  const recette = RECETTES["mot-de-passe"];

  it("donne un mot différent à chacun", () => {
    const tire = recette.tirer({
      manche: 1,
      hasard: () => 0.42,
      joueurs: JOUEURS,
      cartesMaison: [],
      niveaux: [] as never,
      duJournal: [],
      options: {},
    });
    const mots = tire.mots as Record<string, string>;
    expect(Object.keys(mots).sort()).toEqual(["momo", "sam", "samy"]);
    // Deux joueurs avec le même mot, et le jeu n'a plus de sens : celui qui
    // grille l'un grille l'autre par accident.
    expect(new Set(Object.values(mots)).size).toBe(3);
  });

  it("récompense l'accusation juste et punit celle qui tombe à côté", () => {
    const donnees = { mots: { momo: "moutarde", sam: "kiosque", samy: "wagon" } };
    const bilan = recette.depouiller(
      donnees,
      [
        repondre("sam", { vise: "momo", mot: "moutarde" }),
        repondre("samy", { vise: "momo", mot: "kiosque" }),
      ],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([
      { membreId: "sam", delta: 1 },
      { membreId: "samy", delta: -1 },
    ]);
    expect(bilan.verdict).toContain("Sam a grillé Momo");
  });

  it("ne pinaille pas sur la casse ni les accents", () => {
    const bilan = recette.depouiller(
      { mots: { momo: "chrysanthème" } },
      [repondre("sam", { vise: "momo", mot: "Chrysantheme" })],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([{ membreId: "sam", delta: 1 }]);
  });
});

describe("« La théorie du complot »", () => {
  const recette = RECETTES.complot;

  it("convertit la moyenne sur dix en points, sans jamais laisser à zéro", () => {
    // Quatre-vingt-dix secondes de plaidoirie valent au moins un point, même
    // ratées : c'est le prix de s'être lancé.
    const nul = recette.depouiller(
      { acteur: "momo" },
      [repondre("sam", { note: 1 }), repondre("samy", { note: 0 })],
      JOUEURS,
    );
    expect(nul.gains).toEqual([{ membreId: "momo", delta: 1 }]);

    const bon = recette.depouiller(
      { acteur: "momo" },
      [repondre("sam", { note: 8 }), repondre("samy", { note: 8 })],
      JOUEURS,
    );
    expect(bon.gains).toEqual([{ membreId: "momo", delta: 4 }]);
    expect(bon.verdict).toBe("Momo : 8,0 sur 10.");
  });

  it("ne compte pas la note que l'acteur se donnerait à lui-même", () => {
    const bilan = recette.depouiller(
      { acteur: "momo" },
      [repondre("momo", { note: 10 }), repondre("sam", { note: 4 })],
      JOUEURS,
    );
    expect(bilan.verdict).toBe("Momo : 4,0 sur 10.");
  });
});

describe("« Le tribunal des idées »", () => {
  const recette = RECETTES.tribunal;

  it("finance à la majorité, et pas autrement", () => {
    const finance = recette.depouiller(
      { acteur: "momo" },
      [repondre("sam", { choix: "oui" }), repondre("samy", { choix: "oui" })],
      JOUEURS,
    );
    expect(finance.gains).toEqual([{ membreId: "momo", delta: 3 }]);

    // Une voix sur deux n'est pas une majorité : l'idée passe à la trappe.
    const partage = recette.depouiller(
      { acteur: "momo" },
      [repondre("sam", { choix: "oui" }), repondre("samy", { choix: "non" })],
      JOUEURS,
    );
    expect(partage.gains).toEqual([]);
    expect(partage.verdict).toContain("Rejeté");
  });
});
