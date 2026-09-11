import { describe, expect, it } from "vitest";

import { aplatir, correspond, extraire, motsDe, normaliser, surligner } from "./recherche";

describe("aplatir", () => {
  it("ignore accents et casse", () => {
    expect(aplatir("Été à Nîmes")).toBe("ete a nimes");
    expect(aplatir("ÇA VA")).toBe("ca va");
  });

  it("garde la longueur du texte d'origine", () => {
    // C'est l'invariant dont dépend le surlignage. Le jour où il tombe, le
    // surlignage se décale d'un caractère et personne ne comprend pourquoi.
    for (const texte of ["Été", "déjà  vu", "  espaces  ", "œuf", "Ça, ç'a été dur."]) {
      expect(aplatir(texte)).toHaveLength(texte.normalize("NFC").length);
    }
  });

  it("ne touche pas aux espaces, contrairement à normaliser", () => {
    expect(aplatir("deux  espaces")).toBe("deux  espaces");
    expect(normaliser("  deux  espaces ")).toBe("deux espaces");
  });
});

describe("motsDe", () => {
  it("découpe, normalise, dédoublonne", () => {
    expect(motsDe("Été, ÉTÉ ; pluie")).toEqual(["ete", "pluie"]);
  });

  it("jette ce qui est trop court", () => {
    expect(motsDe("a b le")).toEqual(["le"]);
    expect(motsDe("")).toEqual([]);
  });
});

describe("correspond", () => {
  it("veut tous les mots, mais pas dans le même champ", () => {
    const champs = ["Pluie toute la journée", "Les Halles", null];
    expect(correspond(champs, motsDe("pluie halles"))).toBe(true);
    expect(correspond(champs, motsDe("pluie soleil"))).toBe(false);
  });

  it("ignore les accents des deux côtés", () => {
    expect(correspond(["Une journée réussie"], motsDe("reussie"))).toBe(true);
    expect(correspond(["Une journee reussie"], motsDe("réussie"))).toBe(true);
  });

  it("ne trouve rien sans requête", () => {
    expect(correspond(["n'importe quoi"], [])).toBe(false);
  });
});

describe("surligner", () => {
  it("marque le mot trouvé, accents compris", () => {
    expect(surligner("Une soirée tranquille", motsDe("soiree"))).toEqual([
      { texte: "Une ", fort: false },
      { texte: "soirée", fort: true },
      { texte: " tranquille", fort: false },
    ]);
  });

  it("marque toutes les occurrences", () => {
    const morceaux = surligner("pluie, pluie, pluie", motsDe("pluie"));
    expect(morceaux.filter((m) => m.fort)).toHaveLength(3);
    expect(morceaux.map((m) => m.texte).join("")).toBe("pluie, pluie, pluie");
  });

  it("rend le texte entier quand il n'y a rien à marquer", () => {
    expect(surligner("rien ici", motsDe("absent"))).toEqual([{ texte: "rien ici", fort: false }]);
    expect(surligner("rien ici", [])).toEqual([{ texte: "rien ici", fort: false }]);
  });

  it("ne perd jamais un caractère", () => {
    const texte = "Déjà vu : déjà-vu, déjà !";
    expect(surligner(texte, motsDe("deja")).map((m) => m.texte).join("")).toBe(texte);
  });
});

describe("extraire", () => {
  const longue = `${"a".repeat(200)} trouvaille ${"b".repeat(200)}`;

  it("laisse un texte court tel quel", () => {
    expect(extraire("court", motsDe("court"))).toBe("court");
  });

  it("centre sur le mot trouvé plutôt que sur le début", () => {
    const morceau = extraire(longue, motsDe("trouvaille"));
    expect(morceau).toContain("trouvaille");
    expect(morceau.startsWith("…")).toBe(true);
    expect(morceau.endsWith("…")).toBe(true);
  });

  it("part du début quand le mot n'y est pas", () => {
    const morceau = extraire(longue, motsDe("absent"));
    expect(morceau.startsWith("…")).toBe(false);
  });
});
