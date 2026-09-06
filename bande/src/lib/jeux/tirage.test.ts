import { describe, expect, it } from "vitest";

import { generateur, melanger, pioche } from "./tirage";

describe("generateur", () => {
  it("rejoue exactement la même suite à graine égale", () => {
    const a = generateur(42);
    const b = generateur(42);
    const suiteA = [a(), a(), a(), a()];
    const suiteB = [b(), b(), b(), b()];
    expect(suiteA).toEqual(suiteB);
  });

  it("reste dans [0, 1[", () => {
    const g = generateur(7);
    for (let i = 0; i < 500; i++) {
      const v = g();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("donne des suites différentes pour des graines différentes", () => {
    expect(generateur(1)()).not.toBe(generateur(2)());
  });
});

describe("melanger", () => {
  it("garde tous les éléments, une fois chacun", () => {
    const paquet = [1, 2, 3, 4, 5, 6, 7, 8];
    const melange = melanger(paquet, generateur(3));
    expect([...melange].sort((a, b) => a - b)).toEqual(paquet);
  });

  it("ne touche pas au paquet d'origine", () => {
    const paquet = [1, 2, 3, 4, 5];
    melanger(paquet, generateur(9));
    expect(paquet).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("pioche", () => {
  it("voit tout le paquet avant d'en revoir une carte", () => {
    // C'est toute la raison d'être de la pioche : un Math.random() par carte
    // redonne la même affirmation trois fois dans une partie de vingt manches.
    const paquet = ["a", "b", "c", "d", "e"];
    const p = pioche(paquet, generateur(11));
    const premier = [p.suivante(), p.suivante(), p.suivante(), p.suivante(), p.suivante()];
    expect([...premier].sort()).toEqual([...paquet].sort());
  });

  it("repart pour un tour quand le paquet est vide", () => {
    const p = pioche(["a", "b"], generateur(1));
    const cinq = [p.suivante(), p.suivante(), p.suivante(), p.suivante(), p.suivante()];
    expect(cinq.filter((c) => c === "a").length).toBeGreaterThanOrEqual(2);
    expect(cinq.filter((c) => c === "b").length).toBeGreaterThanOrEqual(2);
  });

  it("refuse un paquet vide plutôt que de rendre undefined", () => {
    expect(() => pioche([], generateur(1))).toThrow(/vide/);
  });
});
