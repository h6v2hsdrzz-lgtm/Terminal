import { describe, expect, it } from "vitest";

import {
  ABSENCE_MS,
  codeValide,
  decalageHorloge,
  estPresent,
  prochainHote,
  tirerCode,
  tousOntRepondu,
  versLocal,
} from "./salon";

describe("le code de partie", () => {
  it("tire toujours quatre chiffres sans zéro en tête", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = tirerCode();
      expect(code).toMatch(/^[1-9]\d{3}$/);
    }
  });

  it("couvre bien la plage annoncée", () => {
    expect(tirerCode(() => 0)).toBe("1000");
    expect(tirerCode(() => 0.999999)).toBe("9999");
  });

  it("refuse ce qui ne se dicte pas", () => {
    expect(codeValide("4271")).toBe(true);
    expect(codeValide(" 4271 ")).toBe(true);
    expect(codeValide("0271")).toBe(false);
    expect(codeValide("427")).toBe(false);
    expect(codeValide("42710")).toBe(false);
    expect(codeValide("abcd")).toBe(false);
  });
});

describe("la présence", () => {
  const maintenant = new Date("2026-09-11T20:00:00.000Z");

  it("compte présent celui qui a donné signe de vie récemment", () => {
    expect(estPresent(new Date(maintenant.getTime() - 3_000), maintenant)).toBe(true);
  });

  it("laisse passer trois battements manqués avant de déclarer absent", () => {
    expect(estPresent(new Date(maintenant.getTime() - (ABSENCE_MS - 1)), maintenant)).toBe(true);
    expect(estPresent(new Date(maintenant.getTime() - (ABSENCE_MS + 1)), maintenant)).toBe(false);
  });

  it("accepte une date en chaîne, comme celles qui viennent du réseau", () => {
    expect(estPresent(new Date(maintenant.getTime() - 1000).toISOString(), maintenant)).toBe(true);
  });
});

describe("le transfert d'hôte", () => {
  const joueurs = [
    { membreId: "momo", ordre: 0, present: true },
    { membreId: "sam", ordre: 1, present: true },
    { membreId: "samy", ordre: 2, present: true },
  ];

  it("passe la main au premier présent dans l'ordre de passage", () => {
    expect(prochainHote(joueurs, "momo")).toBe("sam");
  });

  it("saute ceux qui sont partis", () => {
    const avecUnAbsent = joueurs.map((j) => (j.membreId === "sam" ? { ...j, present: false } : j));
    expect(prochainHote(avecUnAbsent, "momo")).toBe("samy");
  });

  it("rend null quand il ne reste personne", () => {
    expect(prochainHote(joueurs.map((j) => ({ ...j, present: false })), "momo")).toBeNull();
  });

  it("ne redonne jamais la main à l'hôte qui s'en va", () => {
    const seul = [{ membreId: "momo", ordre: 0, present: true }];
    expect(prochainHote(seul, "momo")).toBeNull();
  });
});

describe("« tout le monde a répondu »", () => {
  it("n'attend que les présents", () => {
    // Sans cette règle, un téléphone éteint bloque la manche pour toujours.
    expect(tousOntRepondu(["momo", "sam"], ["momo", "sam"])).toBe(true);
    expect(tousOntRepondu(["momo", "sam"], ["momo"])).toBe(false);
    expect(tousOntRepondu(["momo"], ["momo", "sam"])).toBe(true);
  });

  it("refuse de valider une manche que plus personne ne joue", () => {
    expect(tousOntRepondu([], [])).toBe(false);
  });
});

describe("l'horloge du serveur", () => {
  it("mesure le décalage du téléphone", () => {
    // Téléphone en retard de deux secondes sur le serveur.
    expect(decalageHorloge("2026-09-11T20:00:02.000Z", Date.parse("2026-09-11T20:00:00.000Z")))
      .toBe(2000);
  });

  it("ramène un instant serveur à l'heure du téléphone", () => {
    const decalage = 2000;
    expect(versLocal("2026-09-11T20:00:05.000Z", decalage)).toBe(
      Date.parse("2026-09-11T20:00:03.000Z"),
    );
  });

  it("ne change rien quand les deux horloges sont d'accord", () => {
    const t = "2026-09-11T20:00:05.000Z";
    expect(versLocal(t, decalageHorloge(t, Date.parse(t)))).toBe(Date.parse(t));
  });
});
