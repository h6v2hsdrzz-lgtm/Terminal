import { describe, expect, it } from "vitest";

import { normaliser, scoreTop3 } from "./top3";

describe("normaliser", () => {
  it("ignore la casse, les accents et les espaces en trop", () => {
    expect(normaliser("  Le  PARRAIN ")).toBe("le parrain");
    expect(normaliser("Amélie")).toBe(normaliser("AMELIE"));
  });
});

describe("scoreTop3", () => {
  const vrai = ["Le Parrain", "Matrix", "Titanic"];

  it("donne le maximum pour un top retrouvé dans l'ordre", () => {
    expect(scoreTop3(vrai, ["Le Parrain", "Matrix", "Titanic"])).toBe(6);
  });

  it("donne un point par réponse présente mais mal placée", () => {
    expect(scoreTop3(vrai, ["Titanic", "Le Parrain", "Matrix"])).toBe(3);
  });

  it("mélange les deux barèmes sans les confondre", () => {
    // Une à sa place (2), une présente ailleurs (1), une absente (0).
    expect(scoreTop3(vrai, ["Le Parrain", "Titanic", "Alien"])).toBe(3);
  });

  it("ne donne rien pour un top complètement à côté", () => {
    expect(scoreTop3(vrai, ["Alien", "Rocky", "Shrek"])).toBe(0);
  });

  it("ne compte pas deux fois la même réponse répétée", () => {
    // « Matrix » trois fois ne vaut pas trois points de présence.
    expect(scoreTop3(vrai, ["Matrix", "Matrix", "Matrix"])).toBe(2);
  });

  it("ignore les cases laissées vides", () => {
    expect(scoreTop3(vrai, ["Le Parrain", "", ""])).toBe(2);
    expect(scoreTop3(vrai, ["", "", ""])).toBe(0);
  });

  it("accepte une orthographe approchante seulement sur la casse et les accents", () => {
    expect(scoreTop3(["Amélie"], ["amelie"])).toBe(2);
    expect(scoreTop3(["Amélie"], ["Amelie Poulain"])).toBe(0);
  });
});
