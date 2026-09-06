import { describe, expect, it } from "vitest";

import { depouiller } from "./vote";

describe("depouiller", () => {
  it("désigne le camp le moins nombreux", () => {
    const resultat = depouiller({ a: "gauche", b: "droite", c: "droite" }, ["gauche", "droite"]);
    expect(resultat.minoritaire).toBe("gauche");
    expect(resultat.comptes).toEqual({ gauche: 1, droite: 2 });
  });

  it("ne trouve aucune minorité à l'unanimité", () => {
    // Le défaut vu en capture : quatre voix contre zéro, et le camp VIDE
    // devenait minoritaire — donc tout le monde marquait un point pour avoir
    // deviné une majorité que personne ne pouvait manquer.
    const resultat = depouiller(
      { a: "droite", b: "droite", c: "droite", d: "droite" },
      ["gauche", "droite"],
    );
    expect(resultat.minoritaire).toBeNull();
    expect(resultat.unanime).toBe(true);
  });

  it("ne trouve aucune minorité à égalité", () => {
    const resultat = depouiller(
      { a: "gauche", b: "gauche", c: "droite", d: "droite" },
      ["gauche", "droite"],
    );
    expect(resultat.minoritaire).toBeNull();
    expect(resultat.unanime).toBe(false);
  });

  it("ignore les votes hors options", () => {
    const resultat = depouiller({ a: "gauche", b: "haut", c: "droite" }, ["gauche", "droite"]);
    expect(resultat.comptes).toEqual({ gauche: 1, droite: 1 });
    expect(resultat.minoritaire).toBeNull();
  });

  it("tient devant un vote vide", () => {
    const resultat = depouiller({}, ["gauche", "droite"]);
    expect(resultat).toEqual({ comptes: { gauche: 0, droite: 0 }, minoritaire: null, unanime: false });
  });

  it("gère plus de deux options en prenant le moins fourni", () => {
    const resultat = depouiller(
      { a: "x", b: "y", c: "y", d: "z", e: "z", f: "z" },
      ["x", "y", "z"],
    );
    expect(resultat.minoritaire).toBe("x");
  });
});
