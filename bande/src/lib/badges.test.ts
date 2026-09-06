import { describe, expect, it } from "vitest";

import { badgesDe, classementAssiduite, lundiDeLaSemaine, plusLongueSerie, serieEnCours } from "./badges";
import { decaler } from "./dates";
import type { Entree } from "./types";

function entree(jour: string, joie = 6, note: string | null = null): Entree {
  return {
    id: jour, jour, profil: "moi", joie,
    titre: null, note, energie: null, calme: null, declencheurs: [],
    etiquettes: [], photos: [], audio: null, reactions: [], commentaires: [], posteA: "20:00",
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

  it("accorde « trente jours » à trente, et pas à vingt-neuf", () => {
    expect(badgesDe(suite("2026-01-01", 29).map((j) => entree(j)))
      .find((b) => b.cle === "trentaine")!.obtenuLe).toBeNull();
    expect(badgesDe(suite("2026-01-01", 30).map((j) => entree(j)))
      .find((b) => b.cle === "trentaine")!.obtenuLe).toBe("2026-01-30");
  });

  it("réserve « plein pot » à un vrai 10", () => {
    expect(badgesDe([entree("2026-01-01", 9)]).find((b) => b.cle === "plein-pot")!.obtenuLe).toBeNull();
    expect(badgesDe([entree("2026-01-01", 10)]).find((b) => b.cle === "plein-pot")!.obtenuLe).toBe("2026-01-01");
  });

});

describe("les huit badges", () => {
  it("en compte huit, pas un de plus", () => {
    // Un mur de vingt-trois cases dont douze grises rappelle surtout tout ce
    // qu'on n'a pas fait.
    expect(badgesDe([])).toHaveLength(8);
  });

  it("garde le badge secret muet tant qu'il n'est pas gagné", () => {
    const cache = badgesDe([entree("2026-01-01", 5)]).find((b) => b.cle === "grand-ecart")!;
    expect(cache.nom).toBe("Badge secret");
    expect(cache.description).not.toMatch(/1 et un 10/);

    // Un 1 et un 10 dans la même semaine : il se découvre en le gagnant.
    const gagne = badgesDe([entree("2026-01-01", 1), entree("2026-01-04", 10)])
      .find((b) => b.cle === "grand-ecart")!;
    expect(gagne.obtenuLe).toBe("2026-01-04");
    expect(gagne.nom).toBe("Le grand écart");
  });

  it("demande la MÊME semaine pour le grand écart", () => {
    // Huit jours d'écart : ce n'est plus la même semaine.
    expect(
      badgesDe([entree("2026-01-01", 1), entree("2026-01-09", 10)])
        .find((b) => b.cle === "grand-ecart")!.obtenuLe,
    ).toBeNull();
  });

  it("laisse à gagner ce qui ne se déduit pas des journées", () => {
    // Sans scellé ouvert, sans podium et sans points, ces trois-là restent
    // simplement à gagner — et rien ne casse.
    const sans = badgesDe([entree("2026-01-01")]);
    for (const cle of ["capsule", "podium", "mille"]) {
      expect(sans.find((b) => b.cle === cle)!.obtenuLe).toBeNull();
    }

    const avec = badgesDe([entree("2026-01-01")], [entree("2026-01-01")], "moi", {
      points: 1200,
      scelleOuvertLe: "2026-02-02",
      podiumLe: "2026-03-03",
    });
    expect(avec.find((b) => b.cle === "capsule")!.obtenuLe).toBe("2026-02-02");
    expect(avec.find((b) => b.cle === "podium")!.obtenuLe).toBe("2026-03-03");
    expect(avec.find((b) => b.cle === "mille")!.obtenuLe).toBe("2026-01-01");
  });

  it("n'accorde les mille points qu'à mille", () => {
    const presque = badgesDe([entree("2026-01-01")], [entree("2026-01-01")], "moi", { points: 999 });
    expect(presque.find((b) => b.cle === "mille")!.obtenuLe).toBeNull();
  });
});

describe("aucun badge ne récompense d'aller bien", () => {
  it("une bande qui note toujours 3 en obtient autant qu'une qui note toujours 9", () => {
    const bas = suite("2026-01-01", 120).map((j) => entree(j, 3, "voilà"));
    const haut = suite("2026-01-01", 120).map((j) => entree(j, 9, "voilà"));
    const compter = (e: Entree[]) => badgesDe(e).filter((b) => b.obtenuLe).length;
    expect(compter(bas)).toBe(compter(haut));
  });
});

describe("classementAssiduite", () => {
  it("classe sur les journées posées, jamais sur la note", () => {
    // « morose » poste tous les jours à 2 ; « rayonnant » deux fois à 10.
    const entrees = [
      ...suite("2026-08-31", 5).map((j) => ({ ...entree(j, 2), profil: "morose", id: `m${j}` })),
      ...suite("2026-08-31", 2).map((j) => ({ ...entree(j, 10), profil: "rayonnant", id: `r${j}` })),
    ];
    const classement = classementAssiduite(entrees, ["morose", "rayonnant"], "2026-09-04");
    expect(classement[0].profil).toBe("morose");
    expect(classement[0].joursPostes).toBe(5);
  });

  it("ne compte que la semaine en cours", () => {
    const entrees = [
      ...suite("2026-08-24", 7).map((j) => ({ ...entree(j), profil: "a", id: `a${j}` })), // semaine d'avant
      ...suite("2026-08-31", 2).map((j) => ({ ...entree(j), profil: "b", id: `b${j}` })),
    ];
    const classement = classementAssiduite(entrees, ["a", "b"], "2026-09-04");
    expect(classement.find((c) => c.profil === "a")!.joursPostes).toBe(0);
    expect(classement.find((c) => c.profil === "b")!.joursPostes).toBe(2);
  });

  it("partage le rang en cas d'égalité au lieu de départager au hasard", () => {
    const entrees = [
      ...suite("2026-08-31", 3).map((j) => ({ ...entree(j), profil: "a", id: `a${j}` })),
      ...suite("2026-08-31", 3).map((j) => ({ ...entree(j), profil: "b", id: `b${j}` })),
      ...suite("2026-08-31", 1).map((j) => ({ ...entree(j), profil: "c", id: `c${j}` })),
    ];
    const classement = classementAssiduite(entrees, ["a", "b", "c"], "2026-09-04");
    expect(classement[0].rang).toBe(1);
    expect(classement[1].rang).toBe(1);
    expect(classement[2].rang).toBe(3);
  });

  it("montre à zéro celui qui n'a rien posé plutôt que de l'omettre", () => {
    const classement = classementAssiduite([], ["a", "b"], "2026-09-04");
    expect(classement).toHaveLength(2);
    expect(classement.every((c) => c.joursPostes === 0 && c.rang === 1)).toBe(true);
  });
});

describe("lundiDeLaSemaine", () => {
  it("rend le lundi pour chaque jour de la semaine, dimanche compris", () => {
    // Du lundi 31 août au dimanche 6 septembre 2026.
    for (let i = 0; i < 7; i += 1) {
      expect(lundiDeLaSemaine(decaler("2026-08-31", i))).toBe("2026-08-31");
    }
    expect(lundiDeLaSemaine("2026-09-07")).toBe("2026-09-07");
  });
});
