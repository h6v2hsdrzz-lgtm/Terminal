import { describe, expect, it } from "vitest";

import {
  declencheursDansLeTemps,
  evolutionDesPoints,
  joursDe,
  lundiDe,
  semainesDe,
} from "./graphiques";
import type { Entree, Profil } from "./types";

const PROFILS: Profil[] = ["momo", "sam"].map((id, i) => ({
  id,
  pseudo: id[0].toUpperCase() + id.slice(1),
  teinte: i + 1,
  initiales: id.slice(0, 2).toUpperCase(),
  avatar: null,
}));

function entree(profil: string, jour: string, joie = 7, declencheurs: string[] = []): Entree {
  return {
    id: `${profil}-${jour}`,
    profil,
    jour,
    joie,
    titre: null,
    note: null,
    energie: null,
    calme: null,
    creeLe: `${jour}T20:00:00.000Z`,
    declencheurs,
    etiquettes: [],
    reactions: [],
    commentaires: [],
    photos: [],
    audio: null,
  } as unknown as Entree;
}

describe("les jours d'une période", () => {
  it("rend une fenêtre fermée des deux côtés", () => {
    expect(joursDe("2026-09-11", 30, "2026-01-01")).toHaveLength(30);
    expect(joursDe("2026-09-11", 30, "2026-01-01").at(-1)).toBe("2026-09-11");
    expect(joursDe("2026-09-11", 30, "2026-01-01")[0]).toBe("2026-08-13");
  });

  it("part du premier jour connu quand on demande tout", () => {
    expect(joursDe("2026-09-03", 0, "2026-09-01")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });
});

describe("l'évolution des points", () => {
  const jours = joursDe("2026-09-05", 0, "2026-09-01");

  it("cumule, et ne redescend jamais", () => {
    const entrees = [
      entree("momo", "2026-09-01"),
      entree("momo", "2026-09-03"),
      entree("momo", "2026-09-05"),
    ];
    const [momo] = evolutionDesPoints(entrees, [PROFILS[0]], jours);
    // Une courbe de points cumulés qui redescend, c'est un bogue ou un
    // classement qui punit : ni l'un ni l'autre n'existe ici.
    for (let i = 1; i < momo.valeurs.length; i += 1) {
      expect(momo.valeurs[i]).toBeGreaterThanOrEqual(momo.valeurs[i - 1]);
    }
    expect(momo.valeurs.at(-1)).toBe(momo.total);
  });

  it("ne remet personne à zéro quand on réduit la fenêtre", () => {
    // C'est le choix qui compte : regarder les deux derniers jours ne doit pas
    // effacer six mois de journal, sinon le graphique montre un classement qui
    // n'existe pas.
    const entrees = [entree("momo", "2026-09-01"), entree("momo", "2026-09-05")];
    const [court] = evolutionDesPoints(entrees, [PROFILS[0]], joursDe("2026-09-05", 2, "2026-09-01"));
    expect(court.valeurs[0]).toBeGreaterThan(0);
  });

  it("partage la place en cas d'égalité", () => {
    const entrees = [entree("momo", "2026-09-01"), entree("sam", "2026-09-01")];
    const lignes = evolutionDesPoints(entrees, PROFILS, jours);
    expect(lignes.map((l) => l.place)).toEqual([1, 1]);
  });

  it("classe le plus gros total premier", () => {
    const entrees = [
      entree("momo", "2026-09-01"),
      entree("momo", "2026-09-02"),
      entree("sam", "2026-09-01"),
    ];
    const lignes = evolutionDesPoints(entrees, PROFILS, jours);
    expect(lignes.find((l) => l.membreId === "momo")?.place).toBe(1);
    expect(lignes.find((l) => l.membreId === "sam")?.place).toBe(2);
  });
});

describe("les semaines", () => {
  it("commence le lundi, y compris pour un dimanche", () => {
    // Un dimanche rangé avec la semaine suivante décale les courbes d'un cran
    // une fois sur sept, et le défaut ne se voit qu'en comptant à la main.
    expect(lundiDe("2026-09-13")).toBe("2026-09-07"); // dimanche
    expect(lundiDe("2026-09-07")).toBe("2026-09-07"); // lundi
    expect(lundiDe("2026-09-11")).toBe("2026-09-07"); // vendredi
  });

  it("range les lundis dans l'ordre, sans doublon", () => {
    expect(semainesDe(joursDe("2026-09-14", 14, "2026-01-01"))).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
    ]);
  });
});

describe("les déclencheurs dans le temps", () => {
  const jours = joursDe("2026-09-14", 14, "2026-01-01");

  it("compte les occurrences par semaine", () => {
    const entrees = [
      entree("momo", "2026-09-07", 8, ["Sport"]),
      entree("momo", "2026-09-09", 8, ["Sport"]),
      entree("momo", "2026-09-14", 8, ["Sport"]),
    ];
    const { periodes, pas, series } = declencheursDansLeTemps(entrees, ["Sport"], jours);
    expect(pas).toBe("semaine");
    expect(periodes).toHaveLength(3);
    expect(series[0].parSemaine).toEqual([0, 2, 1]);
  });

  it("se tait sous cinq journées plutôt que d'annoncer une moyenne", () => {
    // « 8,4 sur deux journées » a l'air d'un résultat et n'en est pas un.
    const entrees = [
      entree("momo", "2026-09-07", 9, ["Sport"]),
      entree("momo", "2026-09-08", 8, ["Sport"]),
    ];
    const { series } = declencheursDansLeTemps(entrees, ["Sport"], jours);
    expect(series[0].moyenne).toBeNull();
    expect(series[0].joursComptes).toBe(2);
  });

  it("annonce la moyenne à partir de cinq journées", () => {
    const entrees = ["07", "08", "09", "10", "11"].map((j) =>
      entree("momo", `2026-09-${j}`, 8, ["Sport"]),
    );
    const { series } = declencheursDansLeTemps(entrees, ["Sport"], jours);
    expect(series[0].moyenne).toBe(8);
  });

  it("ignore ce qui tombe hors de la fenêtre", () => {
    const entrees = [
      entree("momo", "2026-08-01", 3, ["Sport"]),
      entree("momo", "2026-09-14", 9, ["Sport"]),
    ];
    const { series } = declencheursDansLeTemps(entrees, ["Sport"], jours);
    expect(series[0].parSemaine.reduce((s, n) => s + n, 0)).toBe(1);
    expect(series[0].joursComptes).toBe(1);
  });

  it("passe au mois au-delà de six mois, plutôt que d'empiler des barres d'un pixel", () => {
    // Une année fait cinquante-deux semaines : trois barres par semaine sur la
    // largeur d'un iPhone, ce sont des traits qui se chevauchent.
    const longue = joursDe("2026-09-14", 365, "2025-01-01");
    const { periodes, pas } = declencheursDansLeTemps([], ["Sport"], longue);
    expect(pas).toBe("mois");
    expect(periodes.length).toBeLessThanOrEqual(13);
    expect(periodes[0]).toMatch(/^\d{4}-\d{2}$/);
  });
});
