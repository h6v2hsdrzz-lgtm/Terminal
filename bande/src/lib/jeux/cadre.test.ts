import { describe, expect, it } from "vitest";

import { GAGES, MAX_GORGEES, gorgees, PALIER_EAU, rappelsDus, sanction } from "./cadre";

describe("gorgees", () => {
  it("dit l'unité, jamais le verre", () => {
    expect(gorgees(1)).toBe("une gorgée");
    expect(gorgees(2)).toBe("2 gorgées");
    expect(gorgees(0)).toBe("rien du tout");
  });

  it("plafonne, quoi qu'on lui demande", () => {
    // Un jeu qui compte mal ne doit pas pouvoir faire boire huit fois.
    expect(gorgees(8)).toBe(`${MAX_GORGEES} gorgées`);
    expect(gorgees(-3)).toBe("rien du tout");
  });
});

describe("sanction", () => {
  it("donne un gage à celui qui conduit, jamais une gorgée", () => {
    const s = sanction({ sobre: true, nombre: 2, tirage: 5 });
    expect(s.genre).toBe("gage");
    if (s.genre === "gage") expect(GAGES).toContain(s.texte);
  });

  it("ne donne rien à personne quand il n'y a rien à donner", () => {
    // Le sobre non plus : « je passe » ne se paie pas en gage.
    expect(sanction({ sobre: true, nombre: 0, tirage: 1 }).genre).toBe("rien");
    expect(sanction({ sobre: false, nombre: 0, tirage: 1 }).genre).toBe("rien");
  });

  it("plafonne aussi ce qui est compté par le jeu", () => {
    const s = sanction({ sobre: false, nombre: 12, tirage: 0 });
    expect(s).toEqual({ genre: "gorgees", nombre: MAX_GORGEES, texte: "3 gorgées" });
  });

  it("tire un gage dans le paquet quel que soit le nombre reçu", () => {
    // Un tirage négatif ou énorme ne doit pas sortir du tableau.
    for (const tirage of [-99, 0, 7, 1e6]) {
      const s = sanction({ sobre: true, nombre: 1, tirage });
      if (s.genre !== "gage") throw new Error("attendu un gage");
      expect(GAGES).toContain(s.texte);
    }
  });
});

describe("rappelsDus", () => {
  it("ne rappelle rien avant le premier palier", () => {
    expect(rappelsDus(0)).toBe(0);
    expect(rappelsDus(PALIER_EAU - 1)).toBe(0);
  });

  it("compte un rappel par palier franchi, pas un par manche", () => {
    expect(rappelsDus(PALIER_EAU)).toBe(1);
    expect(rappelsDus(PALIER_EAU * 2.5)).toBe(2);
  });
});
