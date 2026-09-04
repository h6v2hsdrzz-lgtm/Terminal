import { describe, expect, it } from "vitest";

import { badgesDe, classementAssiduite, lundiDeLaSemaine, plusLongueSerie, serieEnCours } from "./badges";
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
    expect(badges.find((b) => b.cle === "trentaine")!.obtenuLe).toBeNull();
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

describe("moisComplet, via le badge « mois plein »", () => {
  const moisPlein = (entrees: Entree[]) =>
    badgesDe(entrees).find((b) => b.cle === "mois-plein")!.obtenuLe;

  it("demande le mois entier, pas trente jours à cheval", () => {
    // Trente jours du 15 janvier au 13 février : aucun mois n'est complet.
    expect(moisPlein(suite("2026-01-15", 30).map((j) => entree(j)))).toBeNull();
  });

  it("reconnaît un février de 28 jours", () => {
    expect(moisPlein(suite("2026-02-01", 28).map((j) => entree(j)))).toBe("2026-02-28");
  });

  it("reconnaît un février bissextile de 29 jours", () => {
    expect(moisPlein(suite("2028-02-01", 28).map((j) => entree(j)))).toBeNull();
    expect(moisPlein(suite("2028-02-01", 29).map((j) => entree(j)))).toBe("2028-02-29");
  });
});

describe("« toute la gamme »", () => {
  it("attend les dix notes, et date le jour où la dixième tombe", () => {
    const neuf = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((j, i) => entree(decaler("2026-01-01", i), j));
    expect(badgesDe(neuf).find((b) => b.cle === "eventail")!.obtenuLe).toBeNull();
    const dix = [...neuf, entree("2026-01-10", 10)];
    expect(badgesDe(dix).find((b) => b.cle === "eventail")!.obtenuLe).toBe("2026-01-10");
  });
});

describe("« même les jours creux »", () => {
  it("se gagne en posant un 1, pas en l'évitant", () => {
    expect(badgesDe([entree("2026-01-01", 2)]).find((b) => b.cle === "jours-creux")!.obtenuLe).toBeNull();
    expect(badgesDe([entree("2026-01-01", 1)]).find((b) => b.cle === "jours-creux")!.obtenuLe).toBe("2026-01-01");
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
