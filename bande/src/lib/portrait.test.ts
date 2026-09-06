import { describe, expect, it } from "vitest";

import { SEUIL_PORTRAIT, enHeure, heureMoyenne, lieuFavori, motFavori, partVocale } from "./portrait";
import type { Entree } from "./types";

function entree(surcharge: Partial<Entree> = {}): Entree {
  return {
    id: Math.random().toString(36), jour: "2026-09-01", profil: "a", joie: 7,
    titre: null, note: null, energie: null, calme: null, declencheurs: [],
    etiquettes: [], photos: [], audio: null, reactions: [], commentaires: [],
    posteA: "21:00",
    ...surcharge,
  };
}

const AUDIO = { url: "/api/audio/x", duree: 5000, niveaux: [10, 30] };
const lieu = (id: string, nom: string) => ({ id, nom });

describe("heureMoyenne", () => {
  it("se tait tant qu'il n'y a pas de quoi parler", () => {
    expect(heureMoyenne(Array.from({ length: SEUIL_PORTRAIT - 1 }, () => entree()))).toBeNull();
  });

  it("moyenne des heures ordinaires", () => {
    const heures = ["20:00", "21:00", "22:00", "21:00", "20:00"];
    expect(heureMoyenne(heures.map((posteA) => entree({ posteA })))).toBe(21 * 60 - 12);
  });

  it("passe minuit sans partir à midi", () => {
    // C'est LE défaut d'une moyenne arithmétique sur des heures : 23 h 50 et
    // 00 h 10 donneraient midi. On moyenne sur un cercle.
    const heures = ["23:50", "00:10", "23:55", "00:05", "00:00"];
    const m = heureMoyenne(heures.map((posteA) => entree({ posteA })))!;
    expect(m === 0 || m >= 1439 || m <= 1).toBe(true);
  });

  it("ne se prononce pas quand les heures s'annulent", () => {
    // Minuit et midi, à parts égales : il n'y a pas d'heure moyenne, et en
    // annoncer une serait un artefact du calcul.
    const heures = ["00:00", "12:00", "00:00", "12:00", "00:00", "12:00"];
    expect(heureMoyenne(heures.map((posteA) => entree({ posteA })))).toBeNull();
  });

  it("ignore une heure illisible plutôt que de compter n'importe quoi", () => {
    const heures = ["21:00", "21:00", "21:00", "21:00", "21:00", "99:99", ""];
    expect(heureMoyenne(heures.map((posteA) => entree({ posteA })))).toBe(21 * 60);
  });

  it("rend toujours une valeur dans la journée", () => {
    const m = heureMoyenne(["23:00", "23:30", "00:30", "01:00", "22:00"].map((posteA) => entree({ posteA })))!;
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThan(1440);
  });
});

describe("enHeure", () => {
  it("écrit à la française", () => {
    expect(enHeure(21 * 60 + 5)).toBe("21 h 05");
    expect(enHeure(0)).toBe("0 h 00");
  });
});

describe("lieuFavori", () => {
  it("prend celui qui revient", () => {
    const entrees = [
      ...Array.from({ length: 4 }, () => entree({ etiquettes: [lieu("1", "Chez Mamie")] })),
      ...Array.from({ length: 3 }, () => entree({ etiquettes: [lieu("2", "Le bar")] })),
    ];
    expect(lieuFavori(entrees)).toEqual({ nom: "Chez Mamie", fois: 4 });
  });

  it("ne fait pas d'une fois une habitude", () => {
    expect(lieuFavori([entree({ etiquettes: [lieu("1", "Ailleurs")] })])).toBeNull();
  });

  it("ne rend rien sans lieu", () => {
    expect(lieuFavori([entree(), entree()])).toBeNull();
  });
});

describe("partVocale", () => {
  it("compte les journées où l'on a parlé", () => {
    const entrees = [
      entree({ audio: AUDIO }), entree({ audio: AUDIO }),
      entree(), entree(), entree(), entree(), entree(), entree(),
    ];
    expect(partVocale(entrees)).toBeCloseTo(0.25, 6);
  });

  it("distingue « aucun » de « on ne sait pas encore »", () => {
    expect(partVocale([entree(), entree()])).toBeNull();
    expect(partVocale(Array.from({ length: SEUIL_PORTRAIT }, () => entree()))).toBe(0);
  });
});

describe("motFavori", () => {
  it("écarte les mots vides", () => {
    // Sans la liste, le mot le plus utilisé de tout le monde est « de ».
    const notes = ["de la pluie encore", "de la pluie toujours", "de la pluie enfin"];
    expect(motFavori(notes.map((note) => entree({ note })))).toEqual({ mot: "pluie", fois: 3 });
  });

  it("confond accents et casse", () => {
    const notes = ["Soirée tranquille", "soiree tranquille", "SOIRÉE encore"];
    expect(motFavori(notes.map((note) => entree({ note })))?.fois).toBe(3);
  });

  it("ne retient rien d'anecdotique", () => {
    expect(motFavori([entree({ note: "un mot unique ici" })])).toBeNull();
  });

  it("ignore les journées sans anecdote", () => {
    expect(motFavori([entree(), entree({ note: null })])).toBeNull();
  });
});
