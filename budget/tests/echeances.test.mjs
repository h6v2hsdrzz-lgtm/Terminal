import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur, flux } from "./aide.mjs";

const P = chargerMoteur();
// les tableaux viennent du contexte vm : le spread les ramène dans le realm
// des tests, sinon deepStrictEqual bute sur deux Array.prototype différents
const dates = (oc) => [...oc].map((o) => o.date);
const montants = (oc) => [...oc].map((o) => o.montant);

test("un flux mensuel tombe une fois par mois, à son jour", () => {
  const f = flux(P, { frequence: "mensuel", debut: "2026-01-10" });
  assert.deepEqual(dates(P.occurrences(f, "2026-01-01", "2026-04-30")),
    ["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"]);
});

test("un mensuel du 31 revient au 31 dès que le mois le permet", () => {
  const f = flux(P, { frequence: "mensuel", debut: "2026-01-31" });
  assert.deepEqual(dates(P.occurrences(f, "2026-01-01", "2026-05-31")),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
});

test("un hebdomadaire garde son pas de 7 jours", () => {
  const f = flux(P, { frequence: "hebdo", debut: "2026-01-05" });
  assert.deepEqual(dates(P.occurrences(f, "2026-01-01", "2026-02-02")),
    ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"]);
});

test("la fenêtre est inclusive des deux côtés", () => {
  const f = flux(P, { frequence: "mensuel", debut: "2026-01-10" });
  assert.deepEqual(dates(P.occurrences(f, "2026-02-10", "2026-03-10")), ["2026-02-10", "2026-03-10"]);
  assert.deepEqual(dates(P.occurrences(f, "2026-02-11", "2026-03-09")), []);
});

test("le saut au premier rang utile ne perd pas d'échéance", () => {
  // début lointain : la boucle démarre par un calcul de rang, pas par 240 pas
  const f = flux(P, { frequence: "mensuel", debut: "2006-01-15" });
  const oc = P.occurrences(f, "2026-01-01", "2026-03-31");
  assert.deepEqual(dates(oc), ["2026-01-15", "2026-02-15", "2026-03-15"]);
});

test("un ponctuel n'apparaît qu'une fois, et seulement dans la fenêtre", () => {
  const f = flux(P, { frequence: "ponctuel", debut: "2026-06-01" });
  assert.deepEqual(dates(P.occurrences(f, "2026-01-01", "2026-12-31")), ["2026-06-01"]);
  assert.deepEqual(dates(P.occurrences(f, "2026-07-01", "2026-12-31")), []);
});

test("la dernière échéance arrête le flux — un crédit qui se solde", () => {
  const f = flux(P, { frequence: "mensuel", debut: "2026-01-05", fin: "2026-03-05" });
  assert.deepEqual(dates(P.occurrences(f, "2026-01-01", "2026-12-31")),
    ["2026-01-05", "2026-02-05", "2026-03-05"]);
});

test("un flux en pause ne produit rien", () => {
  const f = flux(P, { actif: false });
  assert.deepEqual([...P.occurrences(f, "2026-01-01", "2026-12-31")], []);
});

test("rien avant la première échéance", () => {
  const f = flux(P, { debut: "2026-06-10" });
  assert.deepEqual(dates(P.occurrences(f, "2026-01-01", "2026-05-31")), []);
});

test("les rythmes longs comptent en mois, pas en jours", () => {
  const t = flux(P, { frequence: "trimestriel", debut: "2026-01-15" });
  assert.deepEqual(dates(P.occurrences(t, "2026-01-01", "2026-12-31")),
    ["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
  const a = flux(P, { frequence: "annuel", debut: "2026-08-01" });
  assert.deepEqual(dates(P.occurrences(a, "2026-01-01", "2028-12-31")),
    ["2026-08-01", "2027-08-01", "2028-08-01"]);
});

test("la revalorisation s'applique par pas d'un an, à date anniversaire", () => {
  const f = flux(P, { frequence: "annuel", debut: "2026-01-10", montant: 1000, indexation: 10 });
  const oc = P.occurrences(f, "2026-01-01", "2029-12-31", "2026-01-01");
  assert.deepEqual(montants(oc), [1000, 1100, 1210, 1331]);
});

test("le montant saisi est celui d'aujourd'hui : rien n'est revalorisé avant la référence", () => {
  const f = flux(P, { frequence: "annuel", debut: "2020-05-01", montant: 500, indexation: 5 });
  const oc = P.occurrences(f, "2026-01-01", "2027-12-31", "2026-01-01");
  assert.deepEqual(montants(oc), [500, 525]);
});

test("sans revalorisation, le montant ne bouge pas sur dix ans", () => {
  const f = flux(P, { frequence: "annuel", debut: "2026-01-10", montant: 700 });
  const oc = P.occurrences(f, "2026-01-01", "2036-12-31", "2026-01-01");
  assert.equal(oc.length, 11);
  assert.ok([...oc].every((o) => o.montant === 700));
});
