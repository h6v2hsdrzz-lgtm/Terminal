import { describe, expect, it } from "vitest";

import { CATEGORIES, JEUX, jeuParCle, jeuxDeCategorie } from "./catalogue";

describe("catalogue", () => {
  it("tient la promesse : au moins dix jeux", () => {
    expect(JEUX.length).toBeGreaterThanOrEqual(10);
  });

  it("n'a aucune clé en double — la clé sert d'adresse", () => {
    expect(new Set(JEUX.map((j) => j.cle)).size).toBe(JEUX.length);
  });

  it("range chaque jeu dans une catégorie qui existe", () => {
    const cles = new Set(CATEGORIES.map((c) => c.cle));
    for (const jeu of JEUX) expect(cles.has(jeu.categorie)).toBe(true);
  });

  it("ne laisse aucune catégorie vide dans la navigation", () => {
    for (const categorie of CATEGORIES) {
      expect(jeuxDeCategorie(categorie.cle).length).toBeGreaterThan(0);
    }
  });

  it("donne trois lignes de règles à chacun, lisibles avant de lancer", () => {
    for (const jeu of JEUX) {
      expect(jeu.regles).toHaveLength(3);
      for (const ligne of jeu.regles) expect(ligne.length).toBeGreaterThan(20);
    }
  });

  it("retrouve un jeu par sa clé, et rien par une clé inconnue", () => {
    expect(jeuParCle("devine-qui")?.nom).toBe("Devine qui je suis");
    expect(jeuParCle("belote")).toBeUndefined();
  });

  it("garde deux jeux qui n'existent que chez eux", () => {
    expect(jeuxDeCategorie("vous").map((j) => j.cle)).toEqual(["quiz-bande", "qui-a-ecrit"]);
  });
});
