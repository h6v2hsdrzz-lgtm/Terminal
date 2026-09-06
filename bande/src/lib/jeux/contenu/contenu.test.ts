import { describe, expect, it } from "vitest";

import { GAGES } from "../cadre";
import { DILEMMES, JUGEMENTS, SUSCEPTIBLES, THEMES_TOP3 } from "./dilemmes";
import { JAMAIS, affirmations } from "./jamais";

/**
 * Ce fichier ne juge pas le contenu — il n'y a pas de test automatique pour
 * « est-ce que c'est assez trash ». Il tient les deux choses qu'une machine
 * sait vérifier et qu'un humain oublie : le volume, et la grammaire.
 *
 * Le volume, parce que la bande a écrit un chiffre dans le plan et qu'une
 * réécriture ultérieure peut discrètement le faire redescendre. La grammaire,
 * parce que chaque carte est un morceau de phrase collé derrière « Je n'ai
 * jamais », et qu'une carte qui ne s'y colle pas ne se voit qu'en jouant.
 */

const TOUTES = affirmations(["soft", "chaud", "trash"]);

describe("« Je n'ai jamais »", () => {
  it("tient les quatre cents cartes demandées", () => {
    expect(TOUTES.length).toBeGreaterThanOrEqual(400);
  });

  it("garde les trois niveaux jouables séparément", () => {
    // Un niveau trop maigre se répète au bout de dix minutes.
    for (const niveau of ["soft", "chaud", "trash"] as const) {
      expect(JAMAIS[niveau].length).toBeGreaterThanOrEqual(100);
    }
  });

  it("ne répète aucune carte, y compris d'un niveau à l'autre", () => {
    expect(new Set(TOUTES).size).toBe(TOUTES.length);
  });

  it("se colle derrière « Je n'ai jamais »", () => {
    // La carte est un fragment : minuscule à l'attaque, pas de point final,
    // et surtout pas une deuxième négation qui inverserait la phrase.
    for (const carte of TOUTES) {
      expect(carte).toBe(carte.trim());
      expect(carte[0]).toBe(carte[0]?.toLowerCase());
      expect(carte.endsWith(".")).toBe(false);
      expect(carte.startsWith("pas ")).toBe(false);
      expect(carte.startsWith("jamais ")).toBe(false);
    }
  });

  it("reste lisible sur un écran de téléphone", () => {
    for (const carte of TOUTES) {
      expect(carte.length).toBeGreaterThan(8);
      expect(carte.length).toBeLessThanOrEqual(110);
    }
  });
});

describe("« Tu préfères »", () => {
  it("tient les deux cents dilemmes demandés", () => {
    expect(DILEMMES.length).toBeGreaterThanOrEqual(200);
  });

  it("ne répète aucun dilemme", () => {
    const cles = DILEMMES.map(([a, b]) => `${a} | ${b}`);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("propose deux options réellement différentes", () => {
    for (const [a, b] of DILEMMES) {
      expect(a.trim().length).toBeGreaterThan(5);
      expect(b.trim().length).toBeGreaterThan(5);
      expect(a).not.toBe(b);
    }
  });

  it("garde des options qui tiennent sur une ligne", () => {
    // Au-delà, l'option se coupe en deux et le dilemme perd son claquant.
    for (const option of DILEMMES.flat()) {
      expect(option.length).toBeLessThanOrEqual(64);
      expect(option.endsWith(".")).toBe(false);
    }
  });
});

describe("les autres paquets de texte", () => {
  it("en donne assez pour que rien ne se répète dans la soirée", () => {
    expect(SUSCEPTIBLES.length).toBeGreaterThanOrEqual(60);
    expect(THEMES_TOP3.length).toBeGreaterThanOrEqual(40);
    expect(JUGEMENTS.length).toBeGreaterThanOrEqual(40);
    expect(GAGES.length).toBeGreaterThanOrEqual(30);
  });

  it("ne répète rien à l'intérieur d'un paquet", () => {
    for (const paquet of [SUSCEPTIBLES, THEMES_TOP3, JUGEMENTS, [...GAGES]]) {
      expect(new Set(paquet).size).toBe(paquet.length);
    }
  });

  it("écrit les gages comme des consignes, pas comme des fragments", () => {
    // Un gage se lit tel quel à voix haute : majuscule et point final.
    for (const gage of GAGES) {
      expect(gage[0]).toBe(gage[0]?.toUpperCase());
      expect(/[.!?»]$/.test(gage)).toBe(true);
    }
  });

  it("colle « qui est le plus susceptible de… » à son entrée de phrase", () => {
    for (const cas of SUSCEPTIBLES) {
      expect(cas[0]).toBe(cas[0]?.toLowerCase());
      expect(cas.endsWith(".")).toBe(false);
    }
  });
});
