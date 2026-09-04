import { describe, expect, it } from "vitest";

import {
  SEUIL_CONCLUANT,
  SEUIL_SYNCHRONICITE,
  ecartType,
  effetDeclencheur,
  effetJourSemaine,
  moyenne,
  synchronicite,
} from "./analyse";
import type { Entree } from "./types";

/** Une entrée minimale : seuls le jour, la personne, la note et les déclencheurs comptent ici. */
function entree(jour: string, profil: string, joie: number, declencheurs: string[] = []): Entree {
  return {
    id: `${jour}-${profil}`, jour, profil, joie,
    note: null, declencheurs, photo: null, reactions: [], commentaires: [], posteA: "20:00",
  };
}

describe("moyenne", () => {
  it("rend null sur rien plutôt que NaN", () => {
    expect(moyenne([])).toBeNull();
  });

  it("calcule ce qu'on attend", () => {
    expect(moyenne([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("ecartType", () => {
  it("est nul quand tout est identique", () => {
    expect(ecartType([5, 5, 5, 5])).toBe(0);
  });

  it("utilise le diviseur n−1 : on estime, on ne décrit pas", () => {
    // Variance échantillonnale de [2,4,4,4,5,5,7,9] = 32/7
    expect(ecartType([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });

  it("rend 0 plutôt que NaN sur un seul point", () => {
    expect(ecartType([7])).toBe(0);
  });
});

describe("effetDeclencheur", () => {
  it("ne conclut pas sous le seuil d'échantillon", () => {
    const entrees = [
      ...Array.from({ length: SEUIL_CONCLUANT - 1 }, (_, i) => entree(`2026-01-0${i + 1}`, "a", 9, ["x"])),
      ...Array.from({ length: 30 }, (_, i) => entree(`2026-02-${String(i + 1).padStart(2, "0")}`, "a", 5)),
    ];
    const effet = effetDeclencheur(entrees, "x");
    expect(effet.concluant).toBe(false);
    // Même un écart énorme ne suffit pas si un des deux côtés est trop maigre.
    expect(effet.ecart).toBeGreaterThan(3);
  });

  it("repère un vrai effet", () => {
    const entrees = [
      ...Array.from({ length: 40 }, (_, i) => entree(`2026-01-${String(i + 1).padStart(2, "0")}`, "a", 8, ["x"])),
      ...Array.from({ length: 40 }, (_, i) => entree(`2026-03-${String(i + 1).padStart(2, "0")}`, "a", 5)),
    ];
    const effet = effetDeclencheur(entrees, "x");
    expect(effet.concluant).toBe(true);
    expect(effet.net).toBe(true);
    expect(effet.ecart).toBeCloseTo(3, 10);
  });

  it("refuse de qualifier de net un écart noyé dans le bruit", () => {
    // Deux groupes très dispersés dont les moyennes ne diffèrent qu'à peine :
    // c'est exactement le cas où un « +0,2 » affiché mentirait.
    const avec = [1, 10, 2, 9, 3, 8, 4, 7, 5, 6];
    const sans = [2, 9, 3, 8, 4, 7, 5, 6, 1, 10];
    const entrees = [
      ...avec.map((j, i) => entree(`2026-01-${String(i + 1).padStart(2, "0")}`, "a", j, ["x"])),
      ...sans.map((j, i) => entree(`2026-03-${String(i + 1).padStart(2, "0")}`, "a", j)),
    ];
    const effet = effetDeclencheur(entrees, "x");
    expect(effet.concluant).toBe(true);
    expect(effet.net).toBe(false);
    expect(effet.incertitude).toBeGreaterThan(0);
  });

  it("ne se laisse pas piéger par un déclencheur inconnu", () => {
    const entrees = Array.from({ length: 10 }, (_, i) => entree(`2026-01-0${i}`, "a", 7));
    const effet = effetDeclencheur(entrees, "jamais-coche");
    expect(effet.joursAvec).toBe(0);
    expect(effet.avec).toBeNull();
    expect(effet.concluant).toBe(false);
    expect(effet.net).toBe(false);
  });
});

describe("effetJourSemaine", () => {
  it("commence la semaine au lundi, pas au dimanche", () => {
    // 2026-09-07 est un lundi, 2026-09-13 le dimanche suivant.
    const semaine = effetJourSemaine([
      entree("2026-09-07", "a", 1), // lundi
      entree("2026-09-13", "a", 10), // dimanche
    ]);
    expect(semaine[0].moyenne).toBe(1);
    expect(semaine[6].moyenne).toBe(10);
  });

  it("rend null pour un jour jamais posé", () => {
    const semaine = effetJourSemaine([entree("2026-09-07", "a", 5)]);
    expect(semaine[0].moyenne).toBe(5);
    expect(semaine[1].moyenne).toBeNull();
    expect(semaine[1].nombre).toBe(0);
  });

  it("moyenne toutes les personnes ensemble", () => {
    const semaine = effetJourSemaine([
      entree("2026-09-07", "a", 4),
      entree("2026-09-07", "b", 8),
    ]);
    expect(semaine[0].moyenne).toBe(6);
    expect(semaine[0].nombre).toBe(2);
  });
});

describe("synchronicite", () => {
  const jours = (n: number) => Array.from({ length: n }, (_, i) =>
    `2026-0${Math.floor(i / 28) + 1}-${String((i % 28) + 1).padStart(2, "0")}`);

  it("ne conclut pas sous un mois de journées communes", () => {
    const j = jours(SEUIL_SYNCHRONICITE - 1);
    const entrees = j.flatMap((jour, i) => [entree(jour, "a", (i % 10) + 1), entree(jour, "b", (i % 10) + 1)]);
    const mesure = synchronicite(entrees, "a", "b");
    expect(mesure.joursCommuns).toBe(SEUIL_SYNCHRONICITE - 1);
    expect(mesure.concluant).toBe(false);
  });

  it("trouve 1 pour deux courbes identiques", () => {
    const j = jours(40);
    const entrees = j.flatMap((jour, i) => [entree(jour, "a", (i % 10) + 1), entree(jour, "b", (i % 10) + 1)]);
    const mesure = synchronicite(entrees, "a", "b");
    expect(mesure.concluant).toBe(true);
    expect(mesure.coefficient).toBeCloseTo(1, 10);
  });

  it("trouve −1 pour deux courbes opposées", () => {
    const j = jours(40);
    const entrees = j.flatMap((jour, i) => [entree(jour, "a", (i % 10) + 1), entree(jour, "b", 10 - (i % 10))]);
    expect(synchronicite(entrees, "a", "b").coefficient).toBeCloseTo(-1, 10);
  });

  it("ne compte que les jours où les deux ont posté", () => {
    const entrees = [
      entree("2026-01-01", "a", 5), entree("2026-01-01", "b", 5),
      entree("2026-01-02", "a", 9), // b absent
      entree("2026-01-03", "b", 2), // a absent
    ];
    expect(synchronicite(entrees, "a", "b").joursCommuns).toBe(1);
  });

  it("rend null plutôt qu'une division par zéro quand une courbe est plate", () => {
    const j = jours(40);
    const entrees = j.flatMap((jour, i) => [entree(jour, "a", 7), entree(jour, "b", (i % 10) + 1)]);
    expect(synchronicite(entrees, "a", "b").coefficient).toBeNull();
  });
});
