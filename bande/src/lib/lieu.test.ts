import { describe, expect, it } from "vitest";

import {
  arrondirPosition,
  cleCache,
  constellation,
  HAUTEUR_ETIQUETTE,
  nomDuLieu,
  poserEtiquettes,
  type LieuSitue,
} from "./lieu";

describe("arrondirPosition", () => {
  it("ramène à deux décimales, soit environ un kilomètre", () => {
    // Assez pour reconnaître un quartier, pas assez pour trouver une adresse.
    expect(arrondirPosition(48.858372, 2.294481)).toEqual({ latitude: 48.86, longitude: 2.29 });
  });

  it("arrondit AVANT le stockage, pas à l'affichage", () => {
    // Deux positions à cent mètres l'une de l'autre deviennent la même : c'est
    // le but. Arrondir à l'affichage laisserait la précision en base.
    expect(arrondirPosition(48.8601, 2.2941)).toEqual(arrondirPosition(48.8599, 2.2939));
  });

  it("tient les valeurs négatives et le méridien", () => {
    expect(arrondirPosition(-33.8688, 151.2093)).toEqual({ latitude: -33.87, longitude: 151.21 });
    expect(arrondirPosition(0, -0.001)).toEqual({ latitude: 0, longitude: -0 });
  });
});

describe("nomDuLieu", () => {
  it("préfère le quartier, avec sa ville", () => {
    expect(nomDuLieu({ neighbourhood: "Belleville", city: "Paris" })).toBe("Belleville, Paris");
  });

  it("ne répète pas la ville quand le quartier porte son nom", () => {
    expect(nomDuLieu({ suburb: "Lyon", city: "Lyon" })).toBe("Lyon");
  });

  it("se rabat sur ce qui existe", () => {
    expect(nomDuLieu({ village: "Sarlat" })).toBe("Sarlat");
    expect(nomDuLieu({ county: "Cantal" })).toBe("Cantal");
  });

  it("ne rend rien plutôt qu'un libellé vide", () => {
    expect(nomDuLieu(undefined)).toBeNull();
    expect(nomDuLieu({})).toBeNull();
  });

  it("ne remonte jamais la rue ni le numéro", () => {
    // Ils sont dans la réponse de Nominatim, et ils n'ont rien à faire ici.
    const precis = { house_number: "12", road: "rue des Lilas", city: "Paris" };
    expect(nomDuLieu(precis)).toBe("Paris");
  });
});

describe("cleCache", () => {
  it("regroupe les positions voisines sur la même clé", () => {
    // Un appel par saisie, dit la politique d'usage de Nominatim. Le cache ne
    // sert à rien s'il distingue deux points à dix mètres.
    expect(cleCache(48.8583, 2.2944)).toBe(cleCache(48.8581, 2.2942));
  });

  it("garde les décimales même quand elles tombent rondes", () => {
    expect(cleCache(48, 2)).toBe("48.00,2.00");
  });
});

describe("constellation", () => {
  const paris: LieuSitue[] = [
    { id: "a", nom: "Chez moi", usages: 40, latitude: 48.87, longitude: 2.35 },
    { id: "b", nom: "Le bureau", usages: 30, latitude: 48.89, longitude: 2.32 },
    { id: "c", nom: "Le Zinc", usages: 12, latitude: 48.86, longitude: 2.38 },
    { id: "d", nom: "Le canal", usages: 9, latitude: 48.88, longitude: 2.37 },
    { id: "e", nom: "Les Halles", usages: 6, latitude: 48.86, longitude: 2.35 },
  ];
  const nantes: LieuSitue = {
    id: "f", nom: "Chez Mamie", usages: 4, latitude: 47.24, longitude: -1.55,
  };

  it("garde tout le monde dans le cadre", () => {
    for (const p of constellation([...paris, nantes], 300, 34)) {
      expect(p.x).toBeGreaterThanOrEqual(34);
      expect(p.x).toBeLessThanOrEqual(266);
      expect(p.y).toBeGreaterThanOrEqual(34);
      expect(p.y).toBeLessThanOrEqual(266);
    }
  });

  it("écarte la grappe même quand un lieu lointain fixe l'échelle", () => {
    // Le défaut trouvé en capture : cinq lieux parisiens en une seule tache
    // parce que Nantes est à trois cents kilomètres. En projection linéaire
    // pure, ces cinq points tiennent dans deux pixels.
    const points = constellation([...paris, nantes], 300, 34);
    const parisiens = points.filter((p) => p.id !== "f");
    let mini = Infinity;
    for (let i = 0; i < parisiens.length; i++) {
      for (let j = i + 1; j < parisiens.length; j++) {
        mini = Math.min(mini, Math.hypot(parisiens[i].x - parisiens[j].x, parisiens[i].y - parisiens[j].y));
      }
    }
    expect(mini).toBeGreaterThan(20);
  });

  it("laisse le lieu lointain visiblement à l'écart", () => {
    const points = constellation([...paris, nantes], 300, 34);
    const loin = points.find((p) => p.id === "f")!;
    const proches = points.filter((p) => p.id !== "f");
    const distances = proches.map((p) => Math.hypot(p.x - loin.x, p.y - loin.y));
    // Il reste le plus éloigné de tous : le resserrement ne doit pas le noyer.
    expect(Math.min(...distances)).toBeGreaterThan(60);
  });

  it("conserve l'ordre des deux axes", () => {
    const points = constellation([...paris, nantes], 300, 34);
    const par = new Map(points.map((p) => [p.id, p]));
    for (const a of [...paris, nantes]) {
      for (const b of [...paris, nantes]) {
        if (a.longitude < b.longitude) expect(par.get(a.id)!.x).toBeLessThan(par.get(b.id)!.x);
        // L'axe des ordonnées d'un SVG descend : plus au nord, plus haut.
        if (a.latitude < b.latitude) expect(par.get(a.id)!.y).toBeGreaterThan(par.get(b.id)!.y);
      }
    }
  });

  it("donne le même point à deux positions identiques", () => {
    const jumeaux = constellation(
      [
        { id: "a", nom: "A", usages: 1, latitude: 48.86, longitude: 2.35 },
        { id: "b", nom: "B", usages: 1, latitude: 48.86, longitude: 2.35 },
        { id: "c", nom: "C", usages: 1, latitude: 48.9, longitude: 2.4 },
      ],
      300,
      34,
    );
    expect(jumeaux[0].x).toBe(jumeaux[1].x);
    expect(jumeaux[0].y).toBe(jumeaux[1].y);
  });

  it("centre tout quand tous les lieux sont au même endroit", () => {
    const points = constellation(
      [
        { id: "a", nom: "A", usages: 1, latitude: 48.86, longitude: 2.35 },
        { id: "b", nom: "B", usages: 1, latitude: 48.86, longitude: 2.35 },
      ],
      300,
      34,
    );
    expect(points[0]).toMatchObject({ x: 150, y: 150 });
    expect(points[1]).toMatchObject({ x: 150, y: 150 });
  });
});

describe("poserEtiquettes", () => {
  function chevauchent(a: { x: number; y: number; l: number }, b: { x: number; y: number; l: number }) {
    return (
      Math.abs(a.x - b.x) < (a.l + b.l) / 2 && Math.abs(a.y - b.y) < HAUTEUR_ETIQUETTE
    );
  }

  it("n'empile jamais deux noms", () => {
    // Trois points au même endroit : le cas qui empilait cinq étiquettes.
    const points = [
      { nom: "Chez moi", x: 150, y: 150, r: 12 },
      { nom: "Le bureau", x: 152, y: 152, r: 10 },
      { nom: "Les Halles", x: 148, y: 148, r: 8 },
    ];
    const posees = poserEtiquettes(points, 300);
    const boites = posees.map((e, i) => ({ x: e.x, y: e.y, l: points[i].nom.length * 5.2 }));
    for (let i = 0; i < boites.length; i++) {
      for (let j = i + 1; j < boites.length; j++) {
        expect(chevauchent(boites[i], boites[j])).toBe(false);
      }
    }
  });

  it("ancre au bord les noms qui déborderaient", () => {
    const posees = poserEtiquettes(
      [
        { nom: "Un nom très long", x: 6, y: 100, r: 5 },
        { nom: "Un nom très long", x: 294, y: 200, r: 5 },
      ],
      300,
    );
    expect(posees[0].ancre).toBe("start");
    expect(posees[1].ancre).toBe("end");
  });

  it("pose au-dessus quand la place est libre", () => {
    const posees = poserEtiquettes([{ nom: "Seul", x: 150, y: 150, r: 10 }], 300);
    expect(posees[0].y).toBe(135);
  });
});
