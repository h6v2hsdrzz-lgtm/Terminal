import { describe, expect, it } from "vitest";

import { CREUX_ABSENT, CREUX_MINIMAL, PART_CACHEE, contour, figure, lireFigure, regularite } from "./figure";

const TROIS = ["momo", "sam", "samy"];

function journee(...joies: (number | null)[]) {
  return figure(
    joies.map((joie, i) => ({ profil: TROIS[i] ?? `p${i}`, joie })),
    100,
  );
}

describe("figure", () => {
  it("pose le premier sommet en haut", () => {
    const [premier] = journee(10, 10, 10);
    expect(premier.x).toBeCloseTo(0, 6);
    expect(premier.y).toBeLessThan(0);
  });

  it("répartit les sommets à intervalles égaux", () => {
    const sommets = journee(10, 10, 10);
    const angles = sommets.map((s) => Math.atan2(s.y, s.x));
    // Trois sommets sur un cercle, c'est cent vingt degrés entre chacun.
    const ecart = (a: number, b: number) => Math.abs(((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    expect(ecart(angles[0], angles[1])).toBeCloseTo((Math.PI * 2) / 3, 6);
    expect(ecart(angles[1], angles[2])).toBeCloseTo((Math.PI * 2) / 3, 6);
  });

  it("tire le sommet d'autant plus loin que la joie est haute", () => {
    const parts = journee(1, 5, 10).map((s) => s.part);
    expect(parts[0]).toBeLessThan(parts[1]);
    expect(parts[1]).toBeLessThan(parts[2]);
    expect(parts[2]).toBeCloseTo(1, 6);
  });

  it("garde un creux visible pour une journée à 1", () => {
    // Une mauvaise journée n'écrase pas le sommet sur le centre : la personne
    // est là, et la figure doit le montrer.
    expect(journee(1, 1, 1)[0].part).toBeCloseTo(CREUX_MINIMAL, 6);
  });

  it("effondre le sommet de celui qui n'a pas posé", () => {
    const [absent] = journee(null, 8, 8);
    expect(absent.part).toBeCloseTo(CREUX_ABSENT, 6);
    // Et il reste plus près du centre que la pire des journées posées.
    expect(absent.part).toBeLessThan(CREUX_MINIMAL);
  });

  it("garde la personne sur son sommet", () => {
    expect(journee(3, 7, 9).map((s) => s.profil)).toEqual(TROIS);
  });

  it("rend une figure vide sans personne", () => {
    expect(figure([], 100)).toEqual([]);
  });
});

describe("contour", () => {
  it("ferme le tracé", () => {
    expect(contour(journee(5, 5, 5))).toMatch(/Z$/);
  });

  it("trace un segment par sommet supplémentaire", () => {
    const trace = contour(journee(5, 5, 5));
    expect(trace.match(/L/g)).toHaveLength(2);
  });

  it("dessine un cercle plutôt qu'un point pour une personne seule", () => {
    const trace = contour(journee(7));
    expect(trace).toContain("A");
    expect(trace).not.toContain("L");
  });

  it("ne rend rien sans sommet", () => {
    expect(contour([])).toBe("");
  });
});

describe("regularite", () => {
  it("vaut 1 quand tout le monde est au même niveau", () => {
    expect(regularite(journee(7, 7, 7))).toBeCloseTo(1, 6);
  });

  it("mesure l'accord, pas le bonheur", () => {
    // Trois journées à 2 forment une figure aussi régulière que trois à 9.
    expect(regularite(journee(2, 2, 2))).toBeCloseTo(regularite(journee(9, 9, 9))!, 6);
  });

  it("tombe à 0 quand la bande est écartelée", () => {
    expect(regularite(journee(1, 1, 10))).toBeCloseTo(0, 6);
  });

  it("baisse quand un seul décroche", () => {
    expect(regularite(journee(8, 8, 3))!).toBeLessThan(regularite(journee(8, 8, 7))!);
  });

  it("ne se prononce pas avec moins de deux personnes", () => {
    expect(regularite(journee(7, null, null))).toBeNull();
    expect(regularite([])).toBeNull();
  });

  it("ignore les absents plutôt que de les compter comme un désaccord", () => {
    // Deux journées identiques et une personne qui n'a pas posé : la figure est
    // incomplète, pas irrégulière. Compter l'absent ferait dire à l'écran que
    // la bande est en désaccord alors que personne n'a exprimé de désaccord.
    expect(regularite(journee(6, 6, null))).toBeCloseTo(1, 6);
  });
});

describe("lireFigure", () => {
  it("se tait tant qu'il manque quelqu'un", () => {
    expect(lireFigure(journee(9, 9, null))).toBeNull();
    expect(lireFigure(journee(9, 1, null))).toBeNull();
  });

  it("salue une bande au diapason", () => {
    expect(lireFigure(journee(8, 8, 8))).toContain("même endroit");
  });

  it("signale une figure écartelée", () => {
    expect(lireFigure(journee(2, 9, 9))).toContain("penche");
  });

  it("ne nomme jamais personne", () => {
    // Le sommet court se voit sur le dessin, dans la couleur de la personne.
    // La phrase, elle, ne met personne en cause.
    for (const phrase of [lireFigure(journee(2, 9, 9)), lireFigure(journee(8, 8, 8))]) {
      for (const nom of TROIS) expect(phrase ?? "").not.toContain(nom);
    }
  });

  it("se tait sur une journée ordinaire", () => {
    expect(lireFigure(journee(6, 7, 8))).toBeNull();
  });

  it("se tait à une seule personne", () => {
    expect(lireFigure(journee(7))).toBeNull();
  });
});


/** Sous le voile : personne n'a de note, certains ont posé, d'autres non. */
function voilee(...posees: boolean[]) {
  return figure(
    posees.map((posee, i) => ({ profil: TROIS[i] ?? `p${i}`, joie: null, cachee: posee })),
    100,
  );
}

describe("sous le voile", () => {
  it("distingue celui qui a posé de celui qui n'a rien posé", () => {
    // C'est tout l'intérêt : sans cette distinction, la figure est un point
    // pendant la moitié de la soirée et ne dit rien à personne.
    const [pose, absent] = voilee(true, false, false);
    expect(pose.part).toBeCloseTo(PART_CACHEE, 6);
    expect(absent.part).toBeCloseTo(CREUX_ABSENT, 6);
    expect(pose.part).toBeGreaterThan(absent.part);
  });

  it("place tous les sommets cachés au même rayon, quelle que soit la note", () => {
    // Le rayon est une constante. S'il dépendait de la note, la note serait
    // dans la page — c'est exactement ce que le voile doit empêcher.
    const rayons = figure(
      [
        { profil: "a", joie: 1, cachee: true },
        { profil: "b", joie: 10, cachee: true },
      ],
      100,
    ).map((s) => s.part);
    expect(rayons[0]).toBeCloseTo(rayons[1], 10);
  });

  it("n'expose aucune note sur un sommet caché", () => {
    for (const sommet of figure([{ profil: "a", joie: 9, cachee: true }], 100)) {
      expect(sommet.joie).toBeNull();
    }
  });

  it("ne prétend pas mesurer un accord", () => {
    expect(regularite(voilee(true, true, true))).toBeNull();
    expect(lireFigure(voilee(true, true, true))).toBeNull();
  });

  it("laisse une figure visible dès qu'une personne a posé", () => {
    const [pose] = voilee(true, false, false);
    expect(pose.part).toBeGreaterThan(CREUX_MINIMAL);
  });
});
