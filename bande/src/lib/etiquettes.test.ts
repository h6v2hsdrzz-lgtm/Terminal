import { describe, expect, it } from "vitest";

import { LONGUEUR_ETIQUETTE, cleEtiquette, nettoyerEtiquette } from "./etiquettes";

describe("cleEtiquette", () => {
  it("confond casse et accents", () => {
    expect(cleEtiquette("Soirée")).toBe(cleEtiquette("soiree"));
    expect(cleEtiquette("SOIRÉE")).toBe("soiree");
  });

  it("retire les espaces et la ponctuation", () => {
    expect(cleEtiquette("  week-end  ")).toBe("weekend");
    expect(cleEtiquette("ça y est !")).toBe("cayest");
  });

  it("gère les caractères déjà décomposés comme les composés", () => {
    // « é » s'écrit d'une seule unité sur un clavier français (U+00E9) et en
    // deux au copier-coller depuis certaines applications (e + U+0301). Écrire
    // les deux formes en clair dans ce fichier ne prouverait rien : l'éditeur
    // les normaliserait. On les compose donc à la main.
    const compose = "\u00e9t\u00e9";
    const decompose = "e\u0301te\u0301";
    expect(compose).not.toBe(decompose);
    expect(cleEtiquette(compose)).toBe("ete");
    expect(cleEtiquette(decompose)).toBe("ete");
  });

  it("rend une clé vide pour ce qui n'est que ponctuation", () => {
    expect(cleEtiquette("!!!")).toBe("");
    expect(cleEtiquette("   ")).toBe("");
  });

  it("garde les chiffres", () => {
    expect(cleEtiquette("2026")).toBe("2026");
  });
});

describe("nettoyerEtiquette", () => {
  it("garde les accents et la casse", () => {
    expect(nettoyerEtiquette("  Soirée ")).toBe("Soirée");
  });

  it("rogne au-delà de la longueur affichable", () => {
    expect(nettoyerEtiquette("a".repeat(50))).toHaveLength(LONGUEUR_ETIQUETTE);
  });
});
