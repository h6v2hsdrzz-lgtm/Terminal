import { describe, expect, it } from "vitest";

import { initialesDeLaBande } from "./initiales";

describe("initialesDeLaBande", () => {
  it("prend les deux premières lettres quand ça suffit", () => {
    expect(initialesDeLaBande(["Momo", "Lise", "Théo"])).toEqual(["MO", "LI", "TH"]);
  });

  it("sépare Sam de Samy — le cas qui a motivé la fonction", () => {
    expect(initialesDeLaBande(["Momo", "Sam", "Samy"])).toEqual(["MO", "SM", "SY"]);
  });

  it("numérote en dernier recours plutôt que de rendre deux jumeaux", () => {
    const marques = initialesDeLaBande(["Lea", "Lena", "Leo"]);
    expect(new Set(marques).size).toBe(3);
    expect(marques[2]).toBe("LO");
  });

  it("prend les initiales des deux mots d'un nom composé", () => {
    expect(initialesDeLaBande(["Jean Michel"])).toEqual(["JM"]);
    expect(initialesDeLaBande(["Anne Dupont", "Anne Durand"])).toEqual(["AT", "AD"]);
  });

  it("ne rend jamais deux fois la même marque, quoi qu'on lui donne", () => {
    for (const bande of [
      ["Bo", "Bo"],
      ["A", "A", "A"],
      ["Zoé", "Zoe", "Zo"],
      ["Sam", "Sam", "Samy", "Samuel"],
    ]) {
      const marques = initialesDeLaBande(bande);
      expect(marques.length).toBe(bande.length);
      expect(new Set(marques).size, `collision sur ${bande.join(", ")} → ${marques.join(", ")}`)
        .toBe(bande.length);
    }
  });

  it("rend toujours quelque chose de court et non vide", () => {
    for (const marque of initialesDeLaBande(["A", "Zoé", "Jean-Baptiste de la Tour", "  Lou  "])) {
      expect(marque.length).toBeGreaterThan(0);
      expect(marque.length).toBeLessThanOrEqual(2);
    }
  });
});
