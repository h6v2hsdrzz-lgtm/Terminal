import { describe, expect, it } from "vitest";

import { decompte, nomDuGenre } from "./scelle";

describe("decompte", () => {
  it("dit les jours proches avec des mots", () => {
    expect(decompte("2026-09-06", "2026-09-06")).toBe("aujourd'hui");
    expect(decompte("2026-09-07", "2026-09-06")).toBe("demain");
    expect(decompte("2026-09-13", "2026-09-06")).toBe("dans 7 jours");
  });

  it("passe aux mois puis aux années", () => {
    expect(decompte("2026-12-06", "2026-09-06")).toBe("dans 3 mois");
    expect(decompte("2027-09-06", "2026-09-06")).toBe("dans un an");
    expect(decompte("2029-09-06", "2026-09-06")).toBe("dans 3 ans");
  });

  it("compose l'année et les mois", () => {
    expect(decompte("2027-12-06", "2026-09-06")).toBe("dans un an et 3 mois");
  });

  it("ne dit jamais « dans un an et 12 mois »", () => {
    // L'arrondi peut ramener le reste à douze mois : ça se dit deux ans.
    for (let jours = 300; jours < 800; jours += 1) {
      const cible = new Date(Date.UTC(2026, 8, 6) + jours * 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(decompte(cible, "2026-09-06")).not.toMatch(/12 mois/);
    }
  });

  it("ne compte pas à l'envers", () => {
    // Un scellé dont la date est passée est ouvert, pas « dans -3 jours ».
    expect(decompte("2026-09-01", "2026-09-06")).toBe("aujourd'hui");
  });

  it("franchit les changements d'heure sans se décaler", () => {
    // Fin mars et fin octobre, une soustraction de dates locales perd ou gagne
    // une heure et fait basculer l'arrondi d'un jour entier.
    expect(decompte("2027-03-29", "2027-03-27")).toBe("dans 2 jours");
    expect(decompte("2027-10-32".replace("32", "31"), "2027-10-29")).toBe("dans 2 jours");
  });
});

describe("nomDuGenre", () => {
  it("accorde l'article", () => {
    expect(nomDuGenre("photo")).toBe("une photo");
    expect(nomDuGenre("video")).toBe("une vidéo");
    expect(nomDuGenre("audio")).toBe("une voix");
    expect(nomDuGenre("mot")).toBe("un mot");
    expect(nomDuGenre("nimporte quoi")).toBe("un mot");
  });
});
