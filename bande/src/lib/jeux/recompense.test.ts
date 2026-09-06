import { describe, expect, it } from "vitest";

import { classement, crediter, PLAFOND_JEUX } from "./recompense";

describe("classement", () => {
  it("donne 40, 25 et 15 à trois joueurs distincts", () => {
    const places = classement([
      { membreId: "b", points: 3 },
      { membreId: "a", points: 9 },
      { membreId: "c", points: 1 },
    ]);
    expect(places).toEqual([
      { membreId: "a", place: 1, points: 40 },
      { membreId: "b", place: 2, points: 25 },
      { membreId: "c", place: 3, points: 15 },
    ]);
  });

  it("partage la place en cas d'égalité, et fait sauter la suivante", () => {
    // Deux premiers, puis un TROISIÈME : il n'y a pas de deuxième place.
    const places = classement([
      { membreId: "a", points: 9 },
      { membreId: "b", points: 9 },
      { membreId: "c", points: 2 },
    ]);
    expect(places.map((p) => p.place)).toEqual([1, 1, 3]);
    expect(places.map((p) => p.points)).toEqual([40, 40, 15]);
  });

  it("ne donne que la participation au-delà du podium", () => {
    const places = classement(
      ["a", "b", "c", "d", "e"].map((membreId, i) => ({ membreId, points: 10 - i })),
    );
    expect(places[3]).toEqual({ membreId: "d", place: 4, points: 10 });
    expect(places[4]).toEqual({ membreId: "e", place: 5, points: 10 });
  });

  it("tient devant une partie à zéro partout", () => {
    const places = classement([
      { membreId: "a", points: 0 },
      { membreId: "b", points: 0 },
    ]);
    expect(places.map((p) => p.place)).toEqual([1, 1]);
  });
});

describe("crediter", () => {
  it("laisse passer tant que le plafond du jour n'est pas atteint", () => {
    const credits = crediter(classement([
      { membreId: "a", points: 5 },
      { membreId: "b", points: 1 },
    ]), {});
    expect(credits.map((c) => c.points)).toEqual([40, 25]);
  });

  it("rogne la partie de trop au lieu de l'annuler", () => {
    // 100 déjà pris dans la journée : il reste 20 sur 120, pas 40.
    const credits = crediter(
      classement([
        { membreId: "a", points: 5 },
        { membreId: "b", points: 1 },
      ]),
      { a: 100 },
    );
    expect(credits[0].points).toBe(20);
    // Le plafond est personnel : le second n'est pas rogné pour autant.
    expect(credits[1].points).toBe(25);
  });

  it("ne descend jamais sous zéro une fois le plafond dépassé", () => {
    const credits = crediter(
      classement([
        { membreId: "a", points: 5 },
        { membreId: "b", points: 1 },
      ]),
      { a: PLAFOND_JEUX + 50 },
    );
    expect(credits[0].points).toBe(0);
  });
});

describe("classement — quand personne ne gagne", () => {
  it("ne monte personne sur le podium si tous les scores sont égaux", () => {
    // Le cas normal de « Je n'ai jamais », qui ne compte rien : la première
    // version donnait 40 points à toute la bande pour une partie sans point.
    const places = classement([
      { membreId: "a", points: 0 },
      { membreId: "b", points: 0 },
      { membreId: "c", points: 0 },
      { membreId: "d", points: 0 },
    ]);
    expect(places.map((p) => p.points)).toEqual([10, 10, 10, 10]);
    expect(places.every((p) => p.place === 1)).toBe(true);
  });

  it("vaut aussi pour une égalité à un score non nul", () => {
    const places = classement([
      { membreId: "a", points: 7 },
      { membreId: "b", points: 7 },
    ]);
    expect(places.map((p) => p.points)).toEqual([10, 10]);
  });

  it("mais un seul écart suffit à rétablir le podium", () => {
    const places = classement([
      { membreId: "a", points: 7 },
      { membreId: "b", points: 7 },
      { membreId: "c", points: 6 },
    ]);
    expect(places.map((p) => p.points)).toEqual([40, 40, 15]);
  });
});
