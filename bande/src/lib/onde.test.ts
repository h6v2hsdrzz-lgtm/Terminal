import { describe, expect, it } from "vitest";

import { PLANCHER, ondeNormalisee } from "./onde";

describe("ondeNormalisee", () => {
  it("porte le plus fort au sommet", () => {
    expect(ondeNormalisee([10, 40, 25])[1]).toBe(100);
  });

  it("donne la même image à la même phrase dite plus fort", () => {
    // C'est l'intérêt : l'onde montre le rythme de la parole, pas la distance
    // entre la bouche et le téléphone.
    const pres = [20, 80, 40, 60];
    const loin = pres.map((n) => n / 4);
    expect(ondeNormalisee(loin)).toEqual(ondeNormalisee(pres));
  });

  it("garde une barre visible pour un silence", () => {
    expect(ondeNormalisee([0, 50])[0]).toBe(PLANCHER);
  });

  it("rend une ligne plate pour un enregistrement muet", () => {
    // Micro coupé, téléphone dans la poche : il n'y a pas de sommet auquel se
    // rapporter, et une division par zéro donnerait des barres NaN.
    expect(ondeNormalisee([0, 0, 0])).toEqual([PLANCHER, PLANCHER, PLANCHER]);
  });

  it("ne sort jamais des bornes", () => {
    for (const hauteur of ondeNormalisee([-5, 0, 33, 120, 7])) {
      expect(hauteur).toBeGreaterThanOrEqual(PLANCHER);
      expect(hauteur).toBeLessThanOrEqual(100);
    }
  });

  it("ne rend rien sans niveau", () => {
    expect(ondeNormalisee([])).toEqual([]);
  });

  it("garde l'ordre des barres", () => {
    const onde = ondeNormalisee([10, 30, 20]);
    expect(onde[0]).toBeLessThan(onde[1]);
    expect(onde[2]).toBeLessThan(onde[1]);
    expect(onde[0]).toBeLessThan(onde[2]);
  });
});
