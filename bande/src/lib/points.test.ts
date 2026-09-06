import { describe, expect, it } from "vitest";

import { BAREME, NIVEAUX, PLAFOND_QUOTIDIEN, ardoise, niveau, pointsJournee } from "./points";
import { PLAFOND_JEUX } from "./jeux/recompense";
import type { Entree } from "./types";

function entree(surcharge: Partial<Entree> = {}): Entree {
  return {
    id: Math.random().toString(36), jour: "2026-09-01", profil: "moi", joie: 7,
    titre: null, note: null, energie: null, calme: null, declencheurs: [],
    etiquettes: [], photos: [], audio: null, reactions: [], commentaires: [],
    posteA: "21:00",
    ...surcharge,
  };
}

const MEDIA = {
  id: "m", genre: "photo" as const, url: "/x", vignette: "/v",
  largeur: 100, hauteur: 100, duree: null, legende: null,
};
const AUDIO = { url: "/a", duree: 5000, niveaux: [1, 2] };

describe("pointsJournee", () => {
  it("rapporte la même chose quelle que soit la note", () => {
    // C'est LA règle. Le jour où poster un 9 rapporte plus qu'un 3, personne
    // n'écrit plus un 3.
    expect(pointsJournee(entree({ joie: 1 }))).toBe(pointsJournee(entree({ joie: 10 })));
  });

  it("ajoute l'anecdote seulement si c'en est une", () => {
    expect(pointsJournee(entree({ note: "court" }))).toBe(BAREME.journee);
    expect(pointsJournee(entree({ note: "a".repeat(20) }))).toBe(BAREME.journee + BAREME.anecdote);
  });

  it("ne compte pas les espaces comme du texte", () => {
    expect(pointsJournee(entree({ note: "   ok   " }))).toBe(BAREME.journee);
  });

  it("compte deux médias au maximum", () => {
    const trois = [MEDIA, { ...MEDIA, id: "n" }, { ...MEDIA, id: "o" }];
    expect(pointsJournee(entree({ photos: trois }))).toBe(BAREME.journee + 2 * BAREME.media);
  });

  it("additionne tout ce qui est là", () => {
    const complete = entree({
      note: "a".repeat(30), audio: AUDIO, photos: [MEDIA], etiquettes: [{ id: "l", nom: "Ici" }],
    });
    expect(pointsJournee(complete)).toBe(
      BAREME.journee + BAREME.anecdote + BAREME.vocal + BAREME.media + BAREME.lieu,
    );
  });
});

describe("ardoise", () => {
  it("compte l'attention donnée, jamais celle qu'on reçoit", () => {
    // Compter les réactions reçues reviendrait à noter la popularité.
    const laMienne = entree({ profil: "moi", reactions: [{ emoji: "❤️", parQui: ["toi"] }] });
    const laSienne = entree({ profil: "toi", reactions: [{ emoji: "❤️", parQui: ["moi"] }] });

    expect(ardoise([laMienne], "moi").total).toBe(BAREME.journee);
    expect(ardoise([laSienne], "moi").total).toBe(BAREME.reactionDonnee);
  });

  it("ne rapporte rien pour réagir à sa propre journée", () => {
    const mienne = entree({ profil: "moi", reactions: [{ emoji: "🔥", parQui: ["moi"] }] });
    expect(ardoise([mienne], "moi").total).toBe(BAREME.journee);
  });

  it("plafonne par jour, pas sur la vie entière", () => {
    // Quelqu'un qui tient depuis un an ne doit pas buter sur le même plafond
    // que quelqu'un qui a tout fait en une soirée.
    const commentaires = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, auteurId: "moi", auteur: "Moi", texte: "hop", quand: "21:00",
    }));
    const grosseSoiree = entree({ profil: "toi", commentaires });
    expect(ardoise([grosseSoiree], "moi").total).toBeLessThanOrEqual(PLAFOND_QUOTIDIEN);

    const surDixJours = Array.from({ length: 10 }, (_, i) =>
      entree({ jour: `2026-09-0${i}`, profil: "moi", note: "a".repeat(30) }),
    );
    expect(ardoise(surDixJours, "moi").total).toBe(10 * (BAREME.journee + BAREME.anecdote));
  });

  it("limite les réactions comptées dans une même journée", () => {
    const beaucoup = Array.from({ length: 25 }, (_, i) =>
      entree({ jour: "2026-09-02", profil: "toi", reactions: [{ emoji: `${i}`, parQui: ["moi"] }] }),
    );
    // Vingt-cinq réactions le même jour, dix comptées.
    expect(ardoise(beaucoup, "moi").total).toBe(10 * BAREME.reactionDonnee);
  });

  it("compte les scellés au jour où ils ont été posés", () => {
    const a = ardoise([], "moi", [{ auteurId: "moi", creeLe: "2026-09-01" }]);
    expect(a.total).toBe(BAREME.scelle);
    expect(ardoise([], "moi", [{ auteurId: "toi", creeLe: "2026-09-01" }]).total).toBe(0);
  });

  it("explique d'où viennent les points", () => {
    const a = ardoise([entree({ profil: "moi", audio: AUDIO })], "moi");
    expect(a.detail[0]).toEqual({ quoi: "journées posées", points: BAREME.journee + BAREME.vocal });
  });

  it("ne donne rien à qui n'a rien fait", () => {
    expect(ardoise([], "moi").total).toBe(0);
    expect(ardoise([entree({ profil: "toi" })], "moi").total).toBe(0);
  });
});

describe("niveau", () => {
  it("commence au premier palier", () => {
    expect(niveau(0).nom).toBe(NIVEAUX[0].nom);
    expect(niveau(0).rang).toBe(1);
  });

  it("monte aux seuils, jamais avant", () => {
    const deuxieme = NIVEAUX[1].seuil;
    expect(niveau(deuxieme - 1).rang).toBe(1);
    expect(niveau(deuxieme).rang).toBe(2);
  });

  it("annonce ce qu'il reste, et rien au sommet", () => {
    expect(niveau(NIVEAUX[1].seuil - 40).restant).toBe(40);
    expect(niveau(NIVEAUX.at(-1)!.seuil + 10_000).restant).toBeNull();
  });

  it("garde l'avancement entre 0 et 1", () => {
    for (const points of [0, 1, 249, 250, 5999, 6000, 999_999]) {
      const n = niveau(points);
      expect(n.part).toBeGreaterThanOrEqual(0);
      expect(n.part).toBeLessThanOrEqual(1);
    }
  });

  it("remplit la barre au dernier palier", () => {
    // Sinon elle annonce une progression vers un palier qui n'existe pas.
    expect(niveau(NIVEAUX.at(-1)!.seuil).part).toBe(1);
  });
});

describe("ardoise — les parties", () => {
  it("ajoute les points de jeu par-dessus le plafond quotidien", () => {
    // Une journée déjà pleine (plafond 100) plus une partie gagnée : la partie
    // s'ajoute, sinon jouer le soir d'une grosse journée ne rapporterait rien.
    const entrees = Array.from({ length: 12 }, (_, i) =>
      entree({ jour: "2026-06-0" + ((i % 9) + 1), profil: "moi" }),
    );
    const sans = ardoise(entrees, "moi", []);
    const avec = ardoise(entrees, "moi", [], [{ membreId: "moi", jour: "2026-06-01", points: 40 }]);
    expect(avec.total).toBe(sans.total + 40);
    expect(avec.detail.find((d) => d.quoi === "parties jouées")?.points).toBe(40);
  });

  it("plafonne les jeux à leur propre limite quotidienne", () => {
    const parties = Array.from({ length: 6 }, () => ({
      membreId: "moi",
      jour: "2026-06-01",
      points: 40,
    }));
    expect(ardoise([], "moi", [], parties).total).toBe(PLAFOND_JEUX);
  });

  it("compte le plafond par jour, pas sur toute l'histoire", () => {
    const parties = [
      { membreId: "moi", jour: "2026-06-01", points: 200 },
      { membreId: "moi", jour: "2026-06-02", points: 200 },
    ];
    expect(ardoise([], "moi", [], parties).total).toBe(PLAFOND_JEUX * 2);
  });

  it("ne crédite personne d'autre que le joueur", () => {
    const parties = [{ membreId: "toi", jour: "2026-06-01", points: 40 }];
    expect(ardoise([], "moi", [], parties).total).toBe(0);
  });
});
