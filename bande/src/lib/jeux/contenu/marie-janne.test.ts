import { describe, expect, it } from "vitest";

import { COMPLOTS_A, COMPLOTS_B, MOTS_DE_PASSE, TRIBUNAL } from "./marie-janne";

describe("le contenu des jeux Marie Janne", () => {
  it("donne assez de mots de passe pour une longue soirée", () => {
    // Trois joueurs, une manche par tour : sous quarante mots, le paquet se
    // répète avant la fin de la soirée et le jeu perd son sel.
    expect(MOTS_DE_PASSE.length).toBeGreaterThanOrEqual(60);
    expect(new Set(MOTS_DE_PASSE).size).toBe(MOTS_DE_PASSE.length);
  });

  it("n'a que des mots plaçables dans une phrase", () => {
    for (const mot of MOTS_DE_PASSE) {
      // Un seul mot, en minuscules, sans ponctuation : on le dit, on ne le
      // récite pas. Et pas plus de quinze lettres, sinon il s'entend de loin.
      expect(mot, mot).toMatch(/^[a-zà-ÿ'-]{4,15}$/);
    }
  });

  it("tire les deux moitiés d'un complot dans deux mondes séparés", () => {
    // Deux listes, donc au moins neuf cents paires : tirer dans une seule
    // donnerait « les pigeons » et « les mouettes », et il n'y aurait plus rien
    // à relier.
    expect(COMPLOTS_A.length * COMPLOTS_B.length).toBeGreaterThanOrEqual(900);
    for (const a of COMPLOTS_A) expect(COMPLOTS_B).not.toContain(a);
  });

  it("donne au tribunal de quoi tenir plusieurs soirées", () => {
    expect(TRIBUNAL.length).toBeGreaterThanOrEqual(15);
    for (const amorce of TRIBUNAL) {
      // Une phrase, pas un thème : « les transports » ne lance personne.
      expect(amorce, amorce).toMatch(/[.!?]$/);
    }
  });
});
