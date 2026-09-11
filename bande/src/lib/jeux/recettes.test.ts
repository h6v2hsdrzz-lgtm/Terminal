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
  it("couvre les dix jeux, sans exception", () => {
    // Un jeu au catalogue sans recette est un jeu qui s'ouvre et ne joue pas.
    expect(jeuxSansRecette()).toEqual([]);
    expect(Object.keys(RECETTES)).toHaveLength(JEUX.length);
  });

  it("n'invente pas de jeu qui n'existe pas", () => {
    for (const cle of Object.keys(RECETTES)) {
      expect(JEUX.some((j) => j.cle === cle)).toBe(true);
    }
    expect(recetteDe("inexistant")).toBeNull();
  });

  it("donne un acteur à tous les jeux « tour », et à eux seuls", () => {
    for (const [cle, recette] of Object.entries(RECETTES)) {
      expect(typeof recette.acteur === "function", cle).toBe(recette.archetype === "tour");
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

  it("départage sur l'horodatage du SERVEUR, pas sur l'ordre d'arrivée", () => {
    const bilan = recette.depouiller(
      {},
      [
        repondre("sam", {}, "2026-09-11T20:00:00.300Z"),
        repondre("momo", {}, "2026-09-11T20:00:00.120Z"),
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
        repondre("sam", {}, "2026-09-11T20:00:00.400Z"),
      ],
      JOUEURS,
    );
    expect(bilan.gains).toEqual([{ membreId: "sam", delta: 1 }]);
    expect(bilan.gorgees).toEqual([{ membreId: "momo", nombre: 1 }]);
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
