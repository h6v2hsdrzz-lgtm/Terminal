import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decalerIso,
  estDateIso,
  frVersIso,
  isoVersFr,
  isoVersJourMois,
  versIso,
} from "../src/lib/date";

test("l'aller-retour ISO ↔ français conserve la date", () => {
  assert.equal(isoVersFr("2026-03-12"), "12/03/2026");
  assert.equal(frVersIso("12/03/2026"), "2026-03-12");
});

test("une date française invalide n'est pas convertie", () => {
  assert.equal(frVersIso("31/02/2026"), null, "le 31 février n'existe pas");
  assert.equal(frVersIso("2026-03-12"), null);
  assert.equal(frVersIso("bonjour"), null);
});

test("estDateIso rejette les jours qui n'existent pas", () => {
  assert.equal(estDateIso("2026-02-29"), false, "2026 n'est pas bissextile");
  assert.equal(estDateIso("2024-02-29"), true);
  assert.equal(estDateIso("2026-13-01"), false);
  assert.equal(estDateIso("2026-3-1"), false, "les zéros de tête sont obligatoires");
});

test("versIso lit la date locale, pas la date UTC", () => {
  // 23 h 30 heure locale : `toISOString()` bascule au lendemain sur tout
  // fuseau à l'est de Greenwich, versIso non.
  const tard = new Date(2026, 4, 17, 23, 30);
  assert.equal(versIso(tard), "2026-05-17");
});

test("le décalage de dates traverse les mois", () => {
  assert.equal(decalerIso("2026-03-01", -1), "2026-02-28");
  assert.equal(decalerIso("2026-12-31", 1), "2027-01-01");
  assert.equal(decalerIso("2026-05-10", -30), "2026-04-10");
});

test("l'axe des graphiques n'affiche que le jour et le mois", () => {
  assert.equal(isoVersJourMois("2026-03-12"), "12/03");
});
