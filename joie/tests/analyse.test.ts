import assert from "node:assert/strict";
import { test } from "node:test";

import {
  comparaisonParPerimetre,
  declencheurLePlusInfluent,
  impactDeclencheurs,
  joursCouverts,
  moyenneGlobale,
  serieTemporelle,
  statistiquesParPersonne,
} from "../src/lib/analyse";
import type { Entree } from "../src/lib/types";

let compteur = 0;

function entree(partiel: Partial<Entree> & Pick<Entree, "personne" | "joie">): Entree {
  compteur += 1;
  return {
    id: `e${compteur}`,
    date: "2026-01-01",
    biberon: false,
    planteVerte: false,
    notes: null,
    creeLe: "2026-01-01T00:00:00.000Z",
    modifieLe: "2026-01-01T00:00:00.000Z",
    ...partiel,
  };
}

test("la moyenne globale est nulle sans mesure", () => {
  assert.equal(moyenneGlobale([]), null);
});

test("la moyenne globale porte sur toutes les personnes", () => {
  const journal = [
    entree({ personne: "Momo", joie: 4 }),
    entree({ personne: "Sam", joie: 8 }),
    entree({ personne: "Samy", joie: 6 }),
  ];
  assert.equal(moyenneGlobale(journal), 6);
});

test("le delta d'un déclencheur est la différence des moyennes avec et sans", () => {
  const journal = [
    entree({ personne: "Momo", joie: 8, biberon: true }),
    entree({ personne: "Sam", joie: 6, biberon: true }),
    entree({ personne: "Samy", joie: 4, biberon: false }),
    entree({ personne: "Momo", joie: 2, biberon: false }),
  ];

  const biberon = impactDeclencheurs(journal).find((i) => i.cle === "biberon")!;
  assert.equal(biberon.moyenneAvec, 7);
  assert.equal(biberon.moyenneSans, 3);
  assert.equal(biberon.delta, 4);
  assert.equal(biberon.nAvec, 2);
  assert.equal(biberon.fiable, false, "deux mesures par côté restent fragiles");
});

test("un déclencheur sans contre-exemple n'a pas de delta", () => {
  const journal = [
    entree({ personne: "Momo", joie: 9, biberon: true }),
    entree({ personne: "Sam", joie: 7, biberon: true }),
  ];
  const biberon = impactDeclencheurs(journal).find((i) => i.cle === "biberon")!;
  assert.equal(biberon.moyenneSans, null);
  assert.equal(biberon.delta, null);
});

test("le déclencheur le plus influent est celui au plus grand écart positif", () => {
  const journal = [
    entree({ personne: "Momo", joie: 9, biberon: true, planteVerte: true }),
    entree({ personne: "Sam", joie: 8, biberon: true, planteVerte: false }),
    entree({ personne: "Samy", joie: 3, biberon: false, planteVerte: true }),
    entree({ personne: "Momo", joie: 4, biberon: false, planteVerte: false }),
  ];

  const influent = declencheurLePlusInfluent(journal)!;
  assert.equal(influent.cle, "biberon");
  assert.equal(influent.delta, 5); // (9+8)/2 − (3+4)/2
});

test("aucun déclencheur influent quand tous les écarts sont négatifs", () => {
  const journal = [
    entree({ personne: "Momo", joie: 3, biberon: true }),
    entree({ personne: "Sam", joie: 9, biberon: false }),
  ];
  assert.equal(declencheurLePlusInfluent(journal), null);
});

test("la série temporelle range une colonne par personne et par jour", () => {
  const journal = [
    entree({ date: "2026-02-02", personne: "Sam", joie: 7 }),
    entree({ date: "2026-02-01", personne: "Momo", joie: 5, biberon: true }),
    entree({ date: "2026-02-01", personne: "Sam", joie: 6 }),
  ];

  const serie = serieTemporelle(journal);
  assert.deepEqual(
    serie.map((point) => point.date),
    ["2026-02-01", "2026-02-02"],
    "les points sont triés du plus ancien au plus récent",
  );
  assert.equal(serie[0].Momo, 5);
  assert.equal(serie[0].Samy, null, "une personne sans mesure ce jour-là reste vide");
  assert.equal(serie[0].declencheurs.Momo?.biberon, true);
});

test("la comparaison couvre le collectif puis chaque profil", () => {
  const journal = [
    entree({ personne: "Momo", joie: 8, planteVerte: true }),
    entree({ personne: "Momo", joie: 4, planteVerte: false }),
    entree({ personne: "Sam", joie: 6, planteVerte: true }),
  ];

  const barres = comparaisonParPerimetre(journal, "planteVerte");
  assert.deepEqual(
    barres.map((b) => b.perimetre),
    ["Collectif", "Momo", "Sam", "Samy"],
  );
  assert.equal(barres[0].avec, 7);
  assert.equal(barres[1].avec, 8);
  assert.equal(barres[3].avec, null, "Samy n'a rien mesuré");
});

test("les statistiques individuelles comptent les mesures de chacun", () => {
  const journal = [
    entree({ personne: "Momo", joie: 5, date: "2026-03-01" }),
    entree({ personne: "Momo", joie: 7, date: "2026-03-02" }),
    entree({ personne: "Sam", joie: 9, date: "2026-03-01" }),
  ];

  const stats = statistiquesParPersonne(journal);
  const momo = stats.find((s) => s.personne === "Momo")!;
  assert.equal(momo.moyenne, 6);
  assert.equal(momo.nombre, 2);
  assert.equal(momo.derniere?.date, "2026-03-02");
  assert.equal(stats.find((s) => s.personne === "Samy")!.moyenne, null);
});

test("les jours couverts ne comptent chaque date qu'une fois", () => {
  const journal = [
    entree({ personne: "Momo", joie: 5, date: "2026-04-01" }),
    entree({ personne: "Sam", joie: 5, date: "2026-04-01" }),
    entree({ personne: "Sam", joie: 5, date: "2026-04-02" }),
  ];
  assert.equal(joursCouverts(journal), 2);
});
