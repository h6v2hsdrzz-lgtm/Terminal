import assert from "node:assert/strict";
import { test } from "node:test";

import { NOTES_MAX, validerSaisie } from "../src/lib/validation";

const valide = {
  date: "2026-06-01",
  personne: "Sam",
  joie: 7,
  biberon: true,
  planteVerte: false,
  notes: "  une note  ",
};

test("une saisie correcte est acceptée et les notes sont détourées", () => {
  const resultat = validerSaisie(valide);
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(resultat.valeur.notes, "une note");
  assert.equal(resultat.valeur.biberon, true);
});

test("une note vide devient null plutôt qu'une chaîne vide", () => {
  const resultat = validerSaisie({ ...valide, notes: "   " });
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(resultat.valeur.notes, null);
});

test("la joie doit être un entier de 1 à 10", () => {
  for (const joie of [0, 11, 4.5, "sept", null]) {
    const resultat = validerSaisie({ ...valide, joie });
    assert.equal(resultat.ok, false, `joie=${String(joie)} devrait être refusée`);
  }
});

test("une personne hors liste est refusée", () => {
  const resultat = validerSaisie({ ...valide, personne: "Bob" });
  assert.equal(resultat.ok, false);
  if (resultat.ok) return;
  assert.ok(resultat.erreurs.personne);
});

test("la date doit être au format ISO", () => {
  const resultat = validerSaisie({ ...valide, date: "01/06/2026" });
  assert.equal(resultat.ok, false);
  if (resultat.ok) return;
  assert.ok(resultat.erreurs.date);
});

test("une note trop longue est refusée", () => {
  const resultat = validerSaisie({ ...valide, notes: "a".repeat(NOTES_MAX + 1) });
  assert.equal(resultat.ok, false);
});

test("les champs inconnus sont ignorés", () => {
  const resultat = validerSaisie({ ...valide, id: "injection", creeLe: "hier" });
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.deepEqual(Object.keys(resultat.valeur).sort(), [
    "biberon",
    "date",
    "joie",
    "notes",
    "personne",
    "planteVerte",
  ]);
});
