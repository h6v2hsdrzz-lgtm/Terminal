import { describe, expect, it } from "vitest";

import { badgesDe, plusLongueSerie, serieEnCours } from "./badges";
import { decaler } from "./dates";
import type { Entree } from "./types";

function entree(jour: string, joie = 6, note: string | null = null): Entree {
  return {
    id: jour, jour, profil: "moi", joie, note,
    declencheurs: [], photo: null, reactions: [], commentaires: [], posteA: "20:00",
  };
}
const suite = (debut: string, n: number) => Array.from({ length: n }, (_, i) => decaler(debut, i));

describe("plusLongueSerie", () => {
  it("rend 0 sur rien", () => {
    expect(plusLongueSerie(new Set())).toBe(0);
  });

  it("compte la plus longue, pas la dernière", () => {
    const jours = new Set([...suite("2026-01-01", 9), ...suite("2026-02-01", 3)]);
    expect(plusLongueSerie(jours)).toBe(9);
  });

  it("ne se laisse pas couper par un trou d'un jour", () => {
    const jours = new Set([...suite("2026-01-01", 4), ...suite("2026-01-06", 4)]);
    expect(plusLongueSerie(jours)).toBe(4);
  });

  it("franchit un changement de mois", () => {
    expect(plusLongueSerie(new Set(suite("2026-01-28", 10)))).toBe(10);
  });
});

describe("serieEnCours", () => {
  it("compte depuis aujourd'hui quand on a posté", () => {
    const jours = new Set(suite("2026-09-01", 4)); // jusqu'au 4 inclus
    expect(serieEnCours(jours, "2026-09-04")).toBe(4);
  });

  it("repart d'hier quand la journée n'est pas encore posée", () => {
    // La soirée n'est pas finie : ne pas avoir encore posé ne casse pas la série.
    const jours = new Set(suite("2026-09-01", 3)); // jusqu'au 3
    expect(serieEnCours(jours, "2026-09-04")).toBe(3);
  });

  it("tombe à zéro après deux jours manqués", () => {
    const jours = new Set(suite("2026-09-01", 3));
    expect(serieEnCours(jours, "2026-09-05")).toBe(0);
  });

  it("rend 0 sur rien", () => {
    expect(serieEnCours(new Set(), "2026-09-04")).toBe(0);
  });
});

describe("badgesDe", () => {
  it("n'en accorde aucun sans journée", () => {
    expect(badgesDe([]).every((b) => b.obtenuLe === null)).toBe(true);
  });

  it("date « première journée » à la plus ancienne, pas à la première reçue", () => {
    // Le dépôt rend les entrées du plus récent au plus ancien.
    const badges = badgesDe([entree("2026-03-01"), entree("2026-01-01"), entree("2026-02-01")]);
    expect(badges.find((b) => b.cle === "premiere")!.obtenuLe).toBe("2026-01-01");
  });

  it("date « sept d'affilée » au septième jour de la série", () => {
    const badges = badgesDe(suite("2026-01-01", 10).map((j) => entree(j)));
    expect(badges.find((b) => b.cle === "semaine")!.obtenuLe).toBe("2026-01-07");
    expect(badges.find((b) => b.cle === "mois")!.obtenuLe).toBeNull();
  });

  it("accorde « trente jours » à trente, et pas à vingt-neuf", () => {
    expect(badgesDe(suite("2026-01-01", 29).map((j) => entree(j)))
      .find((b) => b.cle === "mois")!.obtenuLe).toBeNull();
    expect(badgesDe(suite("2026-01-01", 30).map((j) => entree(j)))
      .find((b) => b.cle === "mois")!.obtenuLe).toBe("2026-01-30");
  });

  it("réserve « plein pot » à un vrai 10", () => {
    expect(badgesDe([entree("2026-01-01", 9)]).find((b) => b.cle === "plein-pot")!.obtenuLe).toBeNull();
    expect(badgesDe([entree("2026-01-01", 10)]).find((b) => b.cle === "plein-pot")!.obtenuLe).toBe("2026-01-01");
  });

  it("mesure la remontada entre deux journées POSÉES, trou compris", () => {
    // 3 le 1er, puis 8 le 10 : neuf jours d'écart, mais ce sont bien deux
    // journées consécutives dans le journal.
    const badges = badgesDe([entree("2026-01-01", 3), entree("2026-01-10", 8)]);
    expect(badges.find((b) => b.cle === "remontada")!.obtenuLe).toBe("2026-01-10");
  });

  it("ne donne pas la remontada pour +3", () => {
    const badges = badgesDe([entree("2026-01-01", 3), entree("2026-01-02", 6)]);
    expect(badges.find((b) => b.cle === "remontada")!.obtenuLe).toBeNull();
  });

  it("demande une note non vide pour « raconteur »", () => {
    expect(badgesDe([entree("2026-01-01", 6, null)]).find((b) => b.cle === "raconteur")!.obtenuLe).toBeNull();
    expect(badgesDe([entree("2026-01-01", 6, "voilà")]).find((b) => b.cle === "raconteur")!.obtenuLe).toBe("2026-01-01");
  });
});
