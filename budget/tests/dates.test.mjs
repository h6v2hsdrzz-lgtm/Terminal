import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();

test("ajouterMois rabat sur le dernier jour du mois", () => {
  assert.equal(P.ajouterMois("2026-01-31", 1), "2026-02-28");
  assert.equal(P.ajouterMois("2028-01-31", 1), "2028-02-29");   // bissextile
  assert.equal(P.ajouterMois("2026-01-31", 3), "2026-04-30");
  assert.equal(P.ajouterMois("2026-12-15", 1), "2027-01-15");
  assert.equal(P.ajouterMois("2026-03-15", -3), "2025-12-15");
});

test("l'ancre rend le rabattement non contaminant", () => {
  // un 31 rabattu en février doit revenir au 31 en mars, pas rester au 28
  assert.equal(P.ajouterMois("2026-01-31", 2, 31), "2026-03-31");
});

test("moisEntre compte des mois entiers", () => {
  assert.equal(P.moisEntre("2026-01-15", "2026-02-15"), 1);
  assert.equal(P.moisEntre("2026-01-15", "2026-02-14"), 0);
  assert.equal(P.moisEntre("2026-01-15", "2027-01-15"), 12);
  assert.equal(P.moisEntre("2026-03-10", "2026-01-10"), -2);
});

test("joursEntre franchit les changements d'heure sans dériver", () => {
  assert.equal(P.joursEntre("2026-03-28", "2026-03-30"), 2);   // heure d'été
  assert.equal(P.joursEntre("2026-10-24", "2026-10-26"), 2);   // heure d'hiver
  assert.equal(P.joursEntre("2027-12-31", "2028-01-01"), 1);
});

test("joursDansMois et estIso", () => {
  assert.equal(P.joursDansMois(2026, 2), 28);
  assert.equal(P.joursDansMois(2028, 2), 29);
  assert.equal(P.estIso("2026-02-29"), false);
  assert.equal(P.estIso("2026-13-01"), false);
  assert.equal(P.estIso("2026-2-01"), false);
  assert.equal(P.estIso("2026-02-28"), true);
});

test("finDeMois et moisSuivant", () => {
  assert.equal(P.finDeMois("2026-02"), "2026-02-28");
  assert.equal(P.moisSuivant("2026-12"), "2027-01");
});
