import { describe, expect, it } from "vitest";

import { SEUIL_ACTION, gravitéÉcran, prochaineAction } from "./inclinaison";

describe("gravitéÉcran", () => {
  it("vaut zéro quand le téléphone est vertical — donc sur un front", () => {
    // Portrait debout : beta 90, gamma 0.
    expect(Math.abs(gravitéÉcran(90, 0))).toBeLessThan(0.01);
  });

  it("vaut zéro en paysage debout, avec la même formule", () => {
    // C'est tout l'intérêt : iOS ne permet pas de verrouiller l'orientation,
    // et un téléphone posé sur un front bascule tout seul en cours de manche.
    expect(Math.abs(gravitéÉcran(0, 90))).toBeLessThan(0.01);
    expect(Math.abs(gravitéÉcran(0, -90))).toBeLessThan(0.01);
  });

  it("vaut +1 écran vers le ciel et −1 écran vers le sol", () => {
    expect(gravitéÉcran(0, 0)).toBeCloseTo(1, 5);
    expect(gravitéÉcran(180, 0)).toBeCloseTo(-1, 5);
  });

  it("rend zéro plutôt que NaN quand le capteur ne dit rien", () => {
    expect(gravitéÉcran(null, null)).toBe(0);
    expect(gravitéÉcran(90, null)).toBe(0);
  });
});

describe("prochaineAction", () => {
  it("compte une carte trouvée quand on penche vers le bas", () => {
    expect(prochaineAction(-0.9, true)).toEqual({ action: "trouve", arme: false });
  });

  it("passe la carte quand on penche vers le haut", () => {
    expect(prochaineAction(0.9, true)).toEqual({ action: "passe", arme: false });
  });

  it("ne fait rien tant qu'on reste près de la verticale", () => {
    expect(prochaineAction(0.1, true)).toEqual({ action: null, arme: true });
    expect(prochaineAction(-0.4, true)).toEqual({ action: null, arme: true });
  });

  it("n'enchaîne pas trois cartes sur un seul geste", () => {
    // Le défaut classique : l'événement arrive soixante fois par seconde, et
    // tant que le téléphone reste penché il redéclencherait à chaque fois.
    let arme = true;
    let comptees = 0;
    for (const g of [-0.9, -0.95, -0.99, -0.92, -0.88]) {
      const suite = prochaineAction(g, arme);
      arme = suite.arme;
      if (suite.action) comptees++;
    }
    expect(comptees).toBe(1);
  });

  it("réarme une fois revenu au repos, et pas avant", () => {
    let arme = false;
    // Toujours penché : rien, et toujours désarmé.
    ({ arme } = prochaineAction(-0.9, arme));
    expect(arme).toBe(false);
    // Revenu vertical : réarmé, mais sans déclencher au passage.
    const retour = prochaineAction(0.05, arme);
    expect(retour).toEqual({ action: null, arme: true });
    // Et le geste suivant compte.
    expect(prochaineAction(-SEUIL_ACTION, retour.arme).action).toBe("trouve");
  });
});
