import { describe, expect, it } from "vitest";

import {
  COTE_MAX_VIDEO,
  DUREE_MAX_VIDEO,
  debitCible,
  dimensionsCibles,
  enPoids,
  enSecondes,
  poidsAttendu,
} from "./media";

describe("dimensionsCibles", () => {
  it("ramène le côté long à la cible", () => {
    expect(dimensionsCibles(4032, 3024, 720)).toEqual({ largeur: 720, hauteur: 540 });
  });

  it("conserve les proportions d'une vidéo verticale", () => {
    const { largeur, hauteur } = dimensionsCibles(1080, 1920, 720);
    expect(hauteur).toBe(720);
    expect(largeur / hauteur).toBeCloseTo(1080 / 1920, 2);
  });

  it("n'agrandit jamais une image déjà petite", () => {
    // L'agrandir n'ajoute aucun détail et ne fait que gonfler le fichier.
    expect(dimensionsCibles(320, 240, 720)).toEqual({ largeur: 320, hauteur: 240 });
  });

  it("rend toujours des côtés pairs", () => {
    // H.264 encode par blocs de deux pixels et refuse une dimension impaire.
    for (const [l, h] of [[1001, 777], [333, 999], [4031, 3023], [7, 5]]) {
      const d = dimensionsCibles(l, h, COTE_MAX_VIDEO);
      expect(d.largeur % 2, `${l}×${h}`).toBe(0);
      expect(d.hauteur % 2, `${l}×${h}`).toBe(0);
    }
  });

  it("ne descend jamais à zéro", () => {
    const d = dimensionsCibles(1, 1, 720);
    expect(d.largeur).toBeGreaterThanOrEqual(2);
    expect(d.hauteur).toBeGreaterThanOrEqual(2);
  });

  it("rend zéro pour des dimensions absurdes plutôt que de calculer", () => {
    expect(dimensionsCibles(0, 100, 720)).toEqual({ largeur: 0, hauteur: 0 });
    expect(dimensionsCibles(-4, 4, 720)).toEqual({ largeur: 0, hauteur: 0 });
  });
});

describe("debitCible", () => {
  it("monte avec le nombre de pixels", () => {
    expect(debitCible(320, 240)).toBeLessThan(debitCible(720, 1280));
  });

  it("reste dans des bornes tenables", () => {
    for (const [l, h] of [[2, 2], [640, 480], [720, 1280], [4000, 3000]]) {
      const d = debitCible(l, h);
      expect(d).toBeGreaterThanOrEqual(300_000);
      expect(d).toBeLessThanOrEqual(1_600_000);
    }
  });
});

describe("poidsAttendu", () => {
  it("tient sous le plafond pour une vidéo pleine cadre à la durée maximale", () => {
    // C'est la raison d'être de tout ce module : une vidéo au maximum de ce que
    // l'application accepte doit rentrer dans ce que le serveur accepte.
    expect(poidsAttendu(720, 1280, DUREE_MAX_VIDEO)).toBeLessThan(4 * 1024 * 1024);
  });

  it("ne compte pas au-delà de la durée maximale", () => {
    // Une vidéo d'une minute sera coupée : la prévenir d'un poids d'une minute
    // ferait renoncer pour rien.
    expect(poidsAttendu(720, 1280, 60_000)).toBe(poidsAttendu(720, 1280, DUREE_MAX_VIDEO));
  });

  it("grandit avec la durée", () => {
    expect(poidsAttendu(720, 1280, 2000)).toBeLessThan(poidsAttendu(720, 1280, 6000));
  });
});

describe("mise en forme", () => {
  it("arrondit les secondes sans jamais afficher zéro", () => {
    expect(enSecondes(6400)).toBe("6 s");
    expect(enSecondes(200)).toBe("1 s");
  });

  it("choisit l'unité de poids", () => {
    expect(enPoids(800)).toBe("800 o");
    expect(enPoids(2048)).toBe("2 ko");
    expect(enPoids(1_572_864)).toBe("1,5 Mo");
  });
});
