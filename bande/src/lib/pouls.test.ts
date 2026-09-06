import { describe, expect, it } from "vitest";

import { borner, cadreAutomatique, enHeure, enY, lignes, trace, type Pouls } from "./pouls";

function pouls(surcharge: Partial<Pouls> = {}): Pouls {
  return {
    membreId: "a",
    jour: "2026-09-06",
    rire: 7,
    energie: 5,
    poseA: "2026-09-06T14:30:00.000Z",
    ...surcharge,
  };
}

describe("borner", () => {
  it("garde les valeurs dans l'échelle des curseurs", () => {
    expect(borner(0)).toBe(1);
    expect(borner(99)).toBe(10);
    expect(borner(6.6)).toBe(7);
  });

  it("rend le milieu plutôt que NaN", () => {
    expect(borner(Number.NaN)).toBe(6);
  });
});

describe("cadreAutomatique", () => {
  it("montre la journée dès qu'il y a un pouls aujourd'hui", () => {
    expect(cadreAutomatique([pouls()], "2026-09-06")).toBe("journee");
  });

  it("bascule sur la semaine plutôt que d'afficher un écran vide", () => {
    // Le cas normal des premières semaines, pas un cas limite.
    expect(cadreAutomatique([pouls({ jour: "2026-09-05" })], "2026-09-06")).toBe("semaine");
    expect(cadreAutomatique([], "2026-09-06")).toBe("semaine");
  });
});

describe("lignes", () => {
  const jours = ["2026-09-01", "2026-09-02", "2026-09-03"];

  it("trace une ligne par personne, triée par heure", () => {
    const resultat = lignes(
      [
        pouls({ membreId: "a", poseA: "2026-09-06T18:00:00.000Z", rire: 9 }),
        pouls({ membreId: "a", poseA: "2026-09-06T09:00:00.000Z", rire: 4 }),
        pouls({ membreId: "b", poseA: "2026-09-06T12:00:00.000Z", rire: 6 }),
      ],
      "rire",
      "journee",
      "2026-09-06",
      jours,
    );
    expect(resultat).toHaveLength(2);
    const a = resultat.find((l) => l.membreId === "a")!;
    expect(a.points.map((p) => p.y)).toEqual([4, 9]);
    expect(a.points[0].x).toBeLessThan(a.points[1].x);
  });

  it("ne garde que la journée en cours en cadre journée", () => {
    const resultat = lignes(
      [pouls({ jour: "2026-09-05" }), pouls({ jour: "2026-09-06" })],
      "rire",
      "journee",
      "2026-09-06",
      jours,
    );
    expect(resultat[0].points).toHaveLength(1);
  });

  it("moyenne les pouls d'un même jour en cadre semaine", () => {
    // Sinon une journée à six pouls pèserait six fois plus qu'une journée à
    // un seul, et la courbe raconterait l'assiduité au lieu de l'humeur.
    const resultat = lignes(
      [
        pouls({ jour: "2026-09-02", rire: 4 }),
        pouls({ jour: "2026-09-02", rire: 8 }),
        pouls({ jour: "2026-09-03", rire: 10 }),
      ],
      "rire",
      "semaine",
      "2026-09-06",
      jours,
    );
    expect(resultat[0].points).toEqual([
      { x: 1, y: 6, quand: "2026-09-02" },
      { x: 2, y: 10, quand: "2026-09-03" },
    ]);
  });

  it("ne perce pas de trou : un jour sans pouls n'a pas de point", () => {
    const resultat = lignes([pouls({ jour: "2026-09-03" })], "rire", "semaine", "2026-09-06", jours);
    expect(resultat[0].points.map((p) => p.x)).toEqual([2]);
  });

  it("lit l'axe demandé, et pas l'autre", () => {
    const resultat = lignes([pouls({ rire: 3, energie: 9 })], "energie", "journee", "2026-09-06", jours);
    expect(resultat[0].points[0].y).toBe(9);
  });

  it("ne rend aucune ligne vide", () => {
    expect(lignes([], "rire", "journee", "2026-09-06", jours)).toEqual([]);
  });
});

describe("trace", () => {
  it("rend une chaîne vide sans point", () => {
    expect(trace([])).toBe("");
  });

  it("rend un simple déplacement pour un point isolé", () => {
    expect(trace([{ x: 3, y: 4 }])).toBe("M 3 4");
  });

  it("relie chaque paire par une cubique, et passe par les points", () => {
    const d = trace([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]);
    expect(d.startsWith("M 0 10")).toBe(true);
    expect(d).toContain("C ");
    expect(d.endsWith("10 0")).toBe(true);
  });

  it("borne les poignées à l'écart horizontal, sans boucle", () => {
    // Une poignée plus longue que l'écart fait sortir la courbe de son
    // intervalle, et on lit une valeur qui n'a jamais existé.
    const d = trace([
      { x: 0, y: 0 },
      { x: 4, y: 10 },
    ]);
    const nombres = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const n of nombres) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(10);
    }
  });
});

describe("enY", () => {
  it("met 10 en haut et 1 en bas", () => {
    expect(enY(10, 200, 10)).toBe(10);
    expect(enY(1, 200, 10)).toBe(190);
  });

  it("place le milieu au milieu", () => {
    expect(enY(5.5, 200, 10)).toBeCloseTo(100, 5);
  });
});

describe("l'heure, dans le fuseau de la bande", () => {
  it("lit la même heure quel que soit le fuseau de la machine", () => {
    // C'est le défaut qui faisait diverger le graphique rendu par le serveur
    // et celui rendu par le navigateur : `getHours()` rend l'heure de la
    // machine qui exécute, et le serveur est en UTC.
    expect(enHeure("2026-06-15T12:30:00.000Z")).toBe("14:30"); // Paris, heure d'été
    expect(enHeure("2026-01-15T12:30:00.000Z")).toBe("13:30"); // Paris, heure d'hiver
  });

  it("place les points de la journée dans le même ordre que les heures", () => {
    const resultat = lignes(
      [
        pouls({ poseA: "2026-09-06T06:00:00.000Z" }),
        pouls({ poseA: "2026-09-06T16:00:00.000Z" }),
      ],
      "rire",
      "journee",
      "2026-09-06",
      [],
    );
    const [tot, tard] = resultat[0].points;
    expect(tot.x).toBeCloseTo(8, 5);
    expect(tard.x).toBeCloseTo(18, 5);
  });
});
