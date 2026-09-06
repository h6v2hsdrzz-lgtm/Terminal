import { beforeEach, describe, expect, it, vi } from "vitest";

import { garderBrouillon, lireBrouillon, oublierBrouillon, vide, type Brouillon } from "./brouillon";

function brouillon(surcharge: Partial<Brouillon> = {}): Brouillon {
  return {
    jour: "2026-09-06",
    joie: 7,
    titre: "",
    note: "",
    lieu: "",
    energie: null,
    rire: null,
    declencheurs: [],
    ...surcharge,
  };
}

/** Un stockage local minimal : Vitest tourne sans navigateur. */
function faussaire() {
  const boite = new Map<string, string>();
  return {
    getItem: (c: string) => boite.get(c) ?? null,
    setItem: (c: string, v: string) => void boite.set(c, v),
    removeItem: (c: string) => void boite.delete(c),
    boite,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", faussaire());
});

describe("vide", () => {
  it("ne compte ni la note ni le curseur : seuls les mots comptent", () => {
    expect(vide(brouillon())).toBe(true);
    expect(vide(brouillon({ joie: 10, energie: 3, rire: 9 }))).toBe(true);
  });

  it("un seul mot suffit à en faire un brouillon", () => {
    expect(vide(brouillon({ titre: "Bof" }))).toBe(false);
    expect(vide(brouillon({ note: "long" }))).toBe(false);
    expect(vide(brouillon({ lieu: "Chez moi" }))).toBe(false);
    expect(vide(brouillon({ declencheurs: ["x"] }))).toBe(false);
  });

  it("ne se laisse pas avoir par des espaces", () => {
    expect(vide(brouillon({ titre: "   ", note: "\n" }))).toBe(true);
  });
});

describe("garder et relire", () => {
  it("rend ce qu'on a écrit", () => {
    garderBrouillon(brouillon({ note: "Une soirée" }));
    expect(lireBrouillon("2026-09-06")?.note).toBe("Une soirée");
  });

  it("ne rend pas le brouillon d'un autre jour", () => {
    // Le reproposer ferait poster hier sous la date d'aujourd'hui.
    garderBrouillon(brouillon({ jour: "2026-09-05", note: "Hier" }));
    expect(lireBrouillon("2026-09-06")).toBeNull();
  });

  it("n'écrit rien pour un brouillon vide, et efface le précédent", () => {
    garderBrouillon(brouillon({ note: "Un début" }));
    garderBrouillon(brouillon({ note: "" }));
    expect(lireBrouillon("2026-09-06")).toBeNull();
  });

  it("s'oublie à la demande", () => {
    garderBrouillon(brouillon({ note: "x" }));
    oublierBrouillon();
    expect(lireBrouillon("2026-09-06")).toBeNull();
  });
});

describe("quand le stockage refuse", () => {
  it("ne fait pas échouer l'écran", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("refusé");
      },
      setItem: () => {
        throw new Error("refusé");
      },
      removeItem: () => {
        throw new Error("refusé");
      },
    });
    expect(() => garderBrouillon(brouillon({ note: "x" }))).not.toThrow();
    expect(lireBrouillon("2026-09-06")).toBeNull();
    expect(() => oublierBrouillon()).not.toThrow();
  });

  it("survit à un contenu abîmé", () => {
    const faux = faussaire();
    faux.boite.set("bande.brouillon", "{pas du json");
    vi.stubGlobal("localStorage", faux);
    expect(lireBrouillon("2026-09-06")).toBeNull();
  });
});
