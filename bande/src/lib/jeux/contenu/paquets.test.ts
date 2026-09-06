import { describe, expect, it } from "vitest";

import { PAQUETS, paquetParCle, toutesLesCartes } from "./paquets";

describe("les paquets", () => {
  it("en compte assez pour une soirée", () => {
    expect(PAQUETS.length).toBeGreaterThanOrEqual(10);
  });

  it("n'a aucune clé en double", () => {
    expect(new Set(PAQUETS.map((p) => p.cle)).size).toBe(PAQUETS.length);
  });

  it("donne à chaque paquet de quoi tenir une manche entière", () => {
    // Une manche de soixante secondes descend une quinzaine de cartes ; un
    // paquet de vingt se répète au deuxième tour.
    for (const paquet of PAQUETS) {
      expect(paquet.cartes.length).toBeGreaterThanOrEqual(35);
    }
  });

  it("ne répète aucune carte à l'intérieur d'un paquet", () => {
    for (const paquet of PAQUETS) {
      expect(new Set(paquet.cartes).size).toBe(paquet.cartes.length);
    }
  });

  it("ne laisse pas de carte vide ou interminable", () => {
    // Un nom trop long ne tient pas sur un écran posé sur un front.
    for (const carte of toutesLesCartes()) {
      expect(carte.trim().length).toBeGreaterThan(1);
      expect(carte.length).toBeLessThanOrEqual(46);
    }
  });

  it("retrouve un paquet par sa clé", () => {
    expect(paquetParCle("rap-fr")?.nom).toBe("Rap FR");
    expect(paquetParCle("inconnu")).toBeUndefined();
  });

  it("offre au moins quatre cents cartes en roulette", () => {
    expect(toutesLesCartes().length).toBeGreaterThanOrEqual(400);
  });
});
