import { describe, expect, it } from "vitest";

import {
  HEURE_BASCULE,
  decaler,
  enTexteCourt,
  enTexteLong,
  enTexteLongAvecAnnee,
  enTexteRelatif,
  jourDeLaBande,
  jourSemaine,
  versIso,
} from "./dates";

describe("la journée de la bande ferme à 4 h", () => {
  it("range une soirée de minuit et demi dans la veille", () => {
    // 1 h du matin le 5 septembre appartient encore à la soirée du 4.
    expect(jourDeLaBande(new Date(2026, 8, 5, 1, 0))).toBe("2026-09-04");
    expect(jourDeLaBande(new Date(2026, 8, 5, 3, 59))).toBe("2026-09-04");
  });

  it("bascule pile à l'heure dite", () => {
    expect(jourDeLaBande(new Date(2026, 8, 5, HEURE_BASCULE, 0))).toBe("2026-09-05");
  });

  it("laisse la journée en cours tranquille", () => {
    expect(jourDeLaBande(new Date(2026, 8, 4, 22, 30))).toBe("2026-09-04");
  });
});

describe("versIso", () => {
  it("complète les mois et les jours à deux chiffres", () => {
    expect(versIso(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});

describe("decaler", () => {
  it("franchit un changement de mois", () => {
    expect(decaler("2026-01-31", 1)).toBe("2026-02-01");
    expect(decaler("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("connaît les années bissextiles", () => {
    expect(decaler("2028-02-28", 1)).toBe("2028-02-29");
    expect(decaler("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("franchit un changement d'année", () => {
    expect(decaler("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("survit au passage à l'heure d'été", () => {
    // Le dernier dimanche de mars, une journée fait 23 heures. Un décalage
    // calculé en millisecondes tomberait ici sur le mauvais jour.
    expect(decaler("2026-03-28", 1)).toBe("2026-03-29");
    expect(decaler("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("survit au passage à l'heure d'hiver", () => {
    expect(decaler("2026-10-24", 1)).toBe("2026-10-25");
    expect(decaler("2026-10-25", 1)).toBe("2026-10-26");
  });
});

describe("jourSemaine", () => {
  it("rend 0 pour un dimanche, comme getDay", () => {
    expect(jourSemaine("2026-09-06")).toBe(0);
    expect(jourSemaine("2026-09-04")).toBe(5);
  });
});

describe("le texte des dates", () => {
  it("écrit le jour en toutes lettres", () => {
    expect(enTexteLong("2026-09-04")).toBe("vendredi 4 septembre");
  });

  it("abrège les mois longs et laisse les courts", () => {
    expect(enTexteCourt("2026-09-04")).toBe("4 sept.");
    expect(enTexteCourt("2026-05-04")).toBe("4 mai");
  });

  it("préfère « aujourd'hui » et « hier » à une date", () => {
    expect(enTexteRelatif("2026-09-04", "2026-09-04")).toBe("aujourd'hui");
    expect(enTexteRelatif("2026-09-03", "2026-09-04")).toBe("hier");
    expect(enTexteRelatif("2026-09-02", "2026-09-04")).toBe("mercredi 2 septembre");
  });
});

describe("enTexteLongAvecAnnee", () => {
  it("tait l'année quand c'est la même", () => {
    expect(enTexteLongAvecAnnee("2026-09-04", "2026-01-01")).toBe("vendredi 4 septembre");
  });

  it("la donne quand elle diffère — une capsule de l'an prochain doit le dire", () => {
    expect(enTexteLongAvecAnnee("2027-07-01", "2026-09-04")).toBe("jeudi 1er juillet 2027");
    expect(enTexteLongAvecAnnee("2024-07-01", "2026-09-04")).toBe("lundi 1er juillet 2024");
  });
});

describe("le premier du mois", () => {
  it("s'écrit « 1er », pas « 1 »", () => {
    expect(enTexteLong("2026-09-01")).toBe("mardi 1er septembre");
    expect(enTexteCourt("2026-09-01")).toBe("1er sept.");
  });

  it("laisse les autres quantièmes tranquilles", () => {
    expect(enTexteLong("2026-09-02")).toBe("mercredi 2 septembre");
    expect(enTexteLong("2026-09-21")).toBe("lundi 21 septembre");
  });
});
