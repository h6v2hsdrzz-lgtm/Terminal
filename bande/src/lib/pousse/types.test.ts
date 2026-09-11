import { describe, expect, it } from "vitest";

import { LIBELLES, PAR_DEFAUT, TYPES, preferences } from "./types";

describe("les préférences de notification", () => {
  it("décrit chaque type, sans en oublier", () => {
    // Un type sans libellé est une case à cocher sans texte dans les réglages.
    for (const type of TYPES) {
      expect(LIBELLES[type]?.titre.length, type).toBeGreaterThan(3);
      expect(PAR_DEFAUT[type], type).toBeTypeOf("boolean");
    }
  });

  it("laisse les réactions éteintes par défaut, et le reste allumé", () => {
    // Une notification par petit cœur transforme un geste léger en
    // interruption. Tout le reste raconte quelque chose de neuf.
    expect(PAR_DEFAUT.reaction).toBe(false);
    expect(TYPES.filter((t) => !PAR_DEFAUT[t])).toEqual(["reaction"]);
  });

  it("complète ce qui manque, et ignore ce qui n'a rien à faire là", () => {
    expect(preferences({ reaction: true })).toEqual({ ...PAR_DEFAUT, reaction: true });
    expect(preferences(null)).toEqual(PAR_DEFAUT);
    expect(preferences({ inconnu: true, journee: "oui" })).toEqual(PAR_DEFAUT);
  });
});
