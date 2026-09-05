import { describe, expect, it } from "vitest";

import {
  ceJourLa,
  ecartEnJours,
  jourDeLaBandeEntiere,
  libelleMois,
  moisDisponibles,
  murDeSouvenirs,
  retrospective,
} from "./souvenirs";
import type { Entree } from "./types";

function entree(jour: string, profil = "a", joie = 6, extra: Partial<Entree> = {}): Entree {
  return {
    id: `${jour}-${profil}`, jour, profil, joie,
    titre: null, note: null, energie: null, calme: null, declencheurs: [],
    etiquettes: [], photos: [], audio: null, reactions: [], commentaires: [], posteA: "20:00",
    ...extra,
  };
}

/** Une photo de test : le mur ne regarde que « il y en a une », pas laquelle. */
const UNE_PHOTO = [{ id: "p1", url: "/api/photo/p1", largeur: 800, hauteur: 600 }];

describe("ceJourLa", () => {
  it("retrouve la même date l'an dernier", () => {
    const entrees = [entree("2025-09-04"), entree("2026-09-04")];
    const trouve = ceJourLa(entrees, "2026-09-04");
    expect(trouve.map((a) => a.ecart)).toContain("il y a un an");
  });

  it("cale le mois dernier sur le dernier jour d'un mois plus court", () => {
    // Le 31 mars renvoie au 28 février, pas au 3 mars.
    const entrees = [entree("2026-02-28")];
    const trouve = ceJourLa(entrees, "2026-03-31");
    expect(trouve).toHaveLength(1);
    expect(trouve[0].jour).toBe("2026-02-28");
  });

  it("cale sur le 29 février une année bissextile", () => {
    const trouve = ceJourLa([entree("2028-02-29")], "2028-03-31");
    expect(trouve[0].jour).toBe("2028-02-29");
  });

  it("franchit janvier pour trouver décembre", () => {
    const trouve = ceJourLa([entree("2025-12-15")], "2026-01-15");
    expect(trouve[0].jour).toBe("2025-12-15");
  });

  it("ne rend rien quand rien n'a été posé à ces dates", () => {
    expect(ceJourLa([entree("2026-09-04")], "2026-09-04")).toHaveLength(0);
  });
});

describe("murDeSouvenirs", () => {
  it("écarte les journées ordinaires", () => {
    expect(murDeSouvenirs([entree("2026-01-01"), entree("2026-01-02")])).toHaveLength(0);
  });

  it("retient une journée avec photo", () => {
    const avec = entree("2026-01-01", "a", 5, { photos: UNE_PHOTO });
    expect(murDeSouvenirs([avec, entree("2026-01-02")])).toHaveLength(1);
  });

  it("retient un jour creux assumé autant qu'un sommet", () => {
    const creux = entree("2026-01-01", "a", 1, { note: "journée pourrie, j'ai rien fait" });
    const sommet = entree("2026-01-02", "a", 10, { note: "journée pourrie, j'ai rien fait" });
    const mur = murDeSouvenirs([creux, sommet]);
    expect(mur).toHaveLength(2);
  });

  it("ne retient pas une journée pour sa seule note", () => {
    // Une note courte et rien d'autre : ça ne fait pas un souvenir.
    expect(murDeSouvenirs([entree("2026-01-01", "a", 7, { note: "ok" })])).toHaveLength(0);
  });

  it("classe la plus récente devant, à égalité de points", () => {
    const a = entree("2026-01-01", "a", 5, { photos: UNE_PHOTO });
    const b = entree("2026-06-01", "b", 5, { photos: UNE_PHOTO });
    expect(murDeSouvenirs([a, b])[0].entree.jour).toBe("2026-06-01");
  });

  it("respecte la limite demandée", () => {
    const beaucoup = Array.from({ length: 30 }, (_, i) =>
      entree(`2026-01-${String(i + 1).padStart(2, "0")}`, "a", 5, { photos: UNE_PHOTO }));
    expect(murDeSouvenirs(beaucoup, 5)).toHaveLength(5);
  });
});

describe("retrospective", () => {
  const profils = ["a", "b"];

  it("ne compte que le mois demandé", () => {
    const entrees = [entree("2026-01-15"), entree("2026-02-15")];
    expect(retrospective(entrees, "2026-02", profils).journeesPosees).toBe(1);
  });

  it("accepte une année entière", () => {
    const entrees = [entree("2026-01-15"), entree("2026-02-15"), entree("2025-12-31")];
    expect(retrospective(entrees, "2026", profils).journeesPosees).toBe(2);
  });

  it("ne compte au complet que les jours où toute la bande a posté", () => {
    const entrees = [
      entree("2026-01-01", "a"), entree("2026-01-01", "b"),
      entree("2026-01-02", "a"),
    ];
    const r = retrospective(entrees, "2026-01", profils);
    expect(r.jours).toBe(2);
    expect(r.joursComplets).toBe(1);
  });

  it("nomme le jour le plus dur autant que le plus haut", () => {
    const entrees = [entree("2026-01-01", "a", 2), entree("2026-01-02", "a", 9)];
    const r = retrospective(entrees, "2026-01", profils);
    expect(r.meilleurJour!.jour).toBe("2026-01-02");
    expect(r.plusDure!.jour).toBe("2026-01-01");
  });

  it("n'invente pas de « plus dur » quand il n'y a qu'un jour", () => {
    const r = retrospective([entree("2026-01-01")], "2026-01", profils);
    expect(r.meilleurJour!.jour).toBe("2026-01-01");
    expect(r.plusDure).toBeNull();
  });

  it("survit à un mois vide sans lever", () => {
    const r = retrospective([], "2026-01", profils);
    expect(r.jours).toBe(0);
    expect(r.moyenne).toBeNull();
    expect(r.meilleurJour).toBeNull();
    expect(r.meilleurJourSemaine).toBeNull();
    expect(r.parProfil.every((p) => p.posees === 0 && p.moyenne === null)).toBe(true);
  });

  it("compte notes, photos, réactions et commentaires", () => {
    const entrees = [
      entree("2026-01-01", "a", 7, {
        note: "voilà", photos: UNE_PHOTO,
        reactions: [{ emoji: "❤️", parQui: ["b", "c"] }],
        commentaires: [{ id: "1", auteurId: "b", auteur: "B", texte: "oui", quand: "20:00" }],
      }),
    ];
    const r = retrospective(entrees, "2026-01", profils);
    expect(r.notesEcrites).toBe(1);
    expect(r.photos).toBe(1);
    expect(r.reactions).toBe(2);
    expect(r.commentaires).toBe(1);
  });
});

describe("jourDeLaBandeEntiere", () => {
  it("ne retient qu'un jour où tout le monde était là", () => {
    const entrees = [
      entree("2026-01-01", "a", 10), // seul, mais très haut
      entree("2026-01-02", "a", 6), entree("2026-01-02", "b", 6),
    ];
    expect(jourDeLaBandeEntiere(entrees, 2)).toBe("2026-01-02");
  });

  it("rend null quand personne n'a jamais posté le même jour", () => {
    expect(jourDeLaBandeEntiere([entree("2026-01-01", "a")], 2)).toBeNull();
  });
});

describe("libelleMois et moisDisponibles", () => {
  it("écrit le mois en toutes lettres", () => {
    expect(libelleMois("2026-08")).toBe("août 2026");
  });

  it("liste les mois du plus récent au plus ancien, sans doublon", () => {
    const entrees = [entree("2026-01-01"), entree("2026-01-02"), entree("2026-03-01")];
    expect(moisDisponibles(entrees)).toEqual(["2026-03", "2026-01"]);
  });
});

describe("ecartEnJours", () => {
  it("compte les jours d'un intervalle, bissextile compris", () => {
    expect(ecartEnJours("2026-01-01", "2026-01-01")).toBe(0);
    expect(ecartEnJours("2026-02-28", "2026-03-01")).toBe(1);
    expect(ecartEnJours("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("le mur ne répète pas le même motif", () => {
  it("n'écrase pas les autres motifs quand la place manque", () => {
    // Six journées à 10 et trois photos, pour quatre places : sans plafond, les
    // 10 prendraient tout et le mur dirait quatre fois la même phrase.
    const dix = Array.from({ length: 6 }, (_, i) =>
      entree(`2026-01-0${i + 1}`, "a", 10, { note: "belle journée" }));
    const photos = Array.from({ length: 3 }, (_, i) =>
      entree(`2026-02-0${i + 1}`, "a", 6, { photos: UNE_PHOTO }));
    const mur = murDeSouvenirs([...dix, ...photos], 4);
    expect(mur.filter((m) => m.raison === "une journée à 10").length).toBeLessThanOrEqual(2);
    expect(mur.some((m) => m.raison === "une photo")).toBe(true);
  });

  it("mais remplit quand même le mur quand il n'y a qu'un motif", () => {
    // Mieux vaut six fois le même motif qu'un mur presque vide : le plafond
    // sert à répartir, pas à censurer.
    const dix = Array.from({ length: 6 }, (_, i) =>
      entree(`2026-01-0${i + 1}`, "a", 10, { note: "belle journée" }));
    expect(murDeSouvenirs(dix)).toHaveLength(6);
  });

  it("laisse de la place aux autres motifs", () => {
    const dix = Array.from({ length: 6 }, (_, i) =>
      entree(`2026-01-0${i + 1}`, "a", 10, { note: "belle journée" }));
    const photos = Array.from({ length: 3 }, (_, i) =>
      entree(`2026-02-0${i + 1}`, "a", 6, { photos: UNE_PHOTO }));
    const raisons = new Set(murDeSouvenirs([...dix, ...photos]).map((m) => m.raison));
    expect(raisons.has("une photo")).toBe(true);
    expect(raisons.has("une journée à 10")).toBe(true);
  });
});
