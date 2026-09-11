import { describe, expect, it } from "vitest";

import { couperEnLignes, resoudreCouleur } from "./partage";

/**
 * Un contexte de canvas factice : `couperEnLignes` ne se sert que de
 * `measureText`, et une largeur de dix pixels par caractère rend les cas
 * lisibles à l'œil dans les attentes.
 */
function contexte(parCaractere = 10): CanvasRenderingContext2D {
  return {
    measureText: (texte: string) => ({ width: texte.length * parCaractere }),
  } as unknown as CanvasRenderingContext2D;
}

describe("couperEnLignes", () => {
  it("garde une phrase courte sur une seule ligne", () => {
    expect(couperEnLignes(contexte(), "Bonne soirée", 500, 3)).toEqual(["Bonne soirée"]);
  });

  it("coupe entre les mots, jamais au milieu", () => {
    const lignes = couperEnLignes(contexte(), "une soirée vraiment longue ici", 120, 5);
    for (const ligne of lignes) expect(ligne.length * 10).toBeLessThanOrEqual(120);
    expect(lignes.join(" ")).toBe("une soirée vraiment longue ici");
  });

  it("s'arrête au nombre de lignes demandé et le dit", () => {
    const lignes = couperEnLignes(contexte(), "un deux trois quatre cinq six sept", 80, 2);
    expect(lignes).toHaveLength(2);
    // Le texte coupé se voit : sans les points de suspension, l'image
    // laisserait croire que la note s'arrêtait là.
    expect(lignes[1].endsWith("…")).toBe(true);
  });

  it("ne rend rien pour un texte vide", () => {
    expect(couperEnLignes(contexte(), "", 500, 3)).toEqual([]);
  });

  it("laisse passer un mot plus large que la ligne plutôt que de le perdre", () => {
    // Un mot seul plus long que la largeur ne peut pas être coupé sans césure ;
    // le perdre serait pire que de le laisser déborder.
    expect(couperEnLignes(contexte(), "anticonstitutionnellement", 100, 2)).toEqual([
      "anticonstitutionnellement",
    ]);
  });
});

describe("resoudreCouleur", () => {
  const jetons: Record<string, string> = { "--profil-4": "#d24c4c", "--joie-8": " #c79a3d " };
  const lire = (nom: string) => jetons[nom] ?? "";

  it("remplace une variable CSS par sa valeur", () => {
    expect(resoudreCouleur("var(--profil-4)", lire)).toBe("#d24c4c");
  });

  it("rogne les espaces que rend getPropertyValue", () => {
    expect(resoudreCouleur("var(--joie-8)", lire)).toBe("#c79a3d");
  });

  it("laisse passer une couleur déjà concrète", () => {
    expect(resoudreCouleur("#112233", lire)).toBe("#112233");
    expect(resoudreCouleur("rgb(1 2 3)", lire)).toBe("rgb(1 2 3)");
  });

  it("rend un gris plutôt que rien sur une variable inconnue", () => {
    // Une couleur vide fait LEVER `addColorStop`, et l'image entière
    // disparaît au milieu du dessin. Un gris est toujours préférable.
    expect(resoudreCouleur("var(--inexistante)", lire)).toBe("#8a8a8a");
  });
});
