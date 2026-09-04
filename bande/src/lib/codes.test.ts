import { describe, expect, it } from "vitest";

import {
  ALPHABET,
  codeInvitation,
  creerCodeReprise,
  decouperCodeReprise,
  normaliserCode,
  verifierCodeReprise,
} from "./codes";

describe("l'alphabet des codes", () => {
  it("écarte tous les caractères qui se confondent", () => {
    for (const ambigu of ["I", "O", "S", "Z", "0", "1", "5"]) {
      expect(ALPHABET).not.toContain(ambigu);
    }
  });

  it("ne se répète pas", () => {
    expect(new Set(ALPHABET).size).toBe(ALPHABET.length);
  });
});

describe("normaliserCode", () => {
  it("ignore la casse, les espaces et les tirets", () => {
    expect(normaliserCode(" fr9m-4g ")).toBe("FR9M4G");
    expect(normaliserCode("f r 9 m 4 g")).toBe("FR9M4G");
  });

  it("retire les caractères hors alphabet au lieu de les deviner", () => {
    // Deviner un « O » en « Q » transformerait une faute de frappe en une autre
    // lettre valide, et enverrait vers une bande qui n'est pas la bonne.
    expect(normaliserCode("FR9M4GO")).toBe("FR9M4G");
    expect(normaliserCode("O0I1S5")).toBe("");
  });

  it("est idempotente", () => {
    const code = codeInvitation();
    expect(normaliserCode(normaliserCode(code))).toBe(code);
  });
});

describe("codeInvitation", () => {
  it("ne tire que dans l'alphabet, sur six positions", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = codeInvitation();
      expect(code).toHaveLength(6);
      expect([...code].every((c) => ALPHABET.includes(c))).toBe(true);
      // Un code qui ne survit pas à sa propre normalisation serait introuvable.
      expect(normaliserCode(code)).toBe(code);
    }
  });

  it("ne rend pas deux fois la même chose", () => {
    const tires = new Set(Array.from({ length: 500 }, codeInvitation));
    expect(tires.size).toBeGreaterThan(490);
  });
});

describe("le code de reprise", () => {
  it("se présente en trois groupes de quatre", () => {
    expect(creerCodeReprise().enClair).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("garde la poignée en clair et le secret sous empreinte", () => {
    const { poignee, empreinte, enClair } = creerCodeReprise();
    expect(enClair.startsWith(poignee)).toBe(true);
    // Le secret ne doit apparaître nulle part dans l'empreinte.
    const secret = enClair.replaceAll("-", "").slice(4);
    expect(empreinte).not.toContain(secret);
    expect(empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  it("se relit après un aller-retour", () => {
    const { poignee, empreinte, enClair } = creerCodeReprise();
    const decoupe = decouperCodeReprise(enClair)!;
    expect(decoupe.poignee).toBe(poignee);
    expect(verifierCodeReprise(decoupe.secret, decoupe.poignee, empreinte)).toBe(true);
  });

  it("accepte la saisie en minuscules et sans tirets", () => {
    const { empreinte, enClair } = creerCodeReprise();
    const decoupe = decouperCodeReprise(enClair.toLowerCase().replaceAll("-", " "))!;
    expect(verifierCodeReprise(decoupe.secret, decoupe.poignee, empreinte)).toBe(true);
  });

  it("refuse un secret faux", () => {
    const a = creerCodeReprise();
    const b = creerCodeReprise();
    const decoupeB = decouperCodeReprise(b.enClair)!;
    expect(verifierCodeReprise(decoupeB.secret, a.poignee, a.empreinte)).toBe(false);
  });

  it("sale avec la poignée : deux personnes au même secret n'ont pas la même empreinte", () => {
    const a = creerCodeReprise();
    const secretA = a.enClair.replaceAll("-", "").slice(4);
    // Même secret, autre poignée : l'empreinte doit différer.
    expect(verifierCodeReprise(secretA, "ZZZZ", a.empreinte)).toBe(false);
  });

  it("rejette ce qui n'a pas la bonne forme au lieu de planter", () => {
    expect(decouperCodeReprise("")).toBeNull();
    expect(decouperCodeReprise("trop-court")).toBeNull();
    expect(decouperCodeReprise("AAAA-BBBB-CCCC-DDDD")).toBeNull();
  });

  it("ne lève pas sur une empreinte d'une autre longueur", () => {
    // `timingSafeEqual` lèverait ; la fonction doit répondre faux.
    expect(verifierCodeReprise("ABCDEFGH", "ABCD", "00ff")).toBe(false);
  });
});
