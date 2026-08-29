import assert from "node:assert/strict";
import { test } from "node:test";

import { versCsv, versJson } from "../src/lib/export";
import type { Entree } from "../src/lib/types";

const journal: Entree[] = [
  {
    id: "a1",
    date: "2026-07-14",
    personne: "Momo",
    joie: 9,
    biberon: true,
    planteVerte: false,
    notes: 'Fête ; "grand" jour',
    creeLe: "2026-07-14T10:00:00.000Z",
    modifieLe: "2026-07-14T10:00:00.000Z",
  },
];

test("le CSV s'ouvre dans un tableur français", () => {
  const csv = versCsv(journal);
  const lignes = csv.split("\r\n");

  assert.ok(csv.startsWith("﻿"), "le BOM évite les accents cassés dans Excel");
  assert.equal(lignes[0], "﻿id;date;personne;joie;biberon;plante_verte;notes");
  assert.ok(lignes[1].startsWith("a1;14/07/2026;Momo;9;Vrai;Faux;"), lignes[1]);
});

test("les points-virgules et guillemets des notes sont échappés", () => {
  const champNotes = versCsv(journal).split("\r\n")[1].split(";").slice(6).join(";");
  assert.equal(champNotes, '"Fête ; ""grand"" jour"');
});

test("le JSON reprend les noms de colonnes des spécifications", () => {
  const [entree] = JSON.parse(versJson(journal));
  assert.deepEqual(entree, {
    id: "a1",
    date: "14/07/2026",
    personne: "Momo",
    joie: 9,
    biberon: true,
    plante_verte: false,
    notes: 'Fête ; "grand" jour',
  });
});
