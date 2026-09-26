import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

/** Le moteur tourne sans navigateur : on lui pose un stockage local minimal. */
function moteurAvecStockage() {
  const memoire = new Map();
  const P = chargerMoteur({
    localStorage: {
      getItem: (c) => (memoire.has(c) ? memoire.get(c) : null),
      setItem: (c, v) => { memoire.set(c, String(v)); },
      removeItem: (c) => { memoire.delete(c); },
    },
  });
  return { P, memoire };
}

const HEURE = 3600 * 1000;

test("un instantané est pris, puis pas avant une heure", () => {
  const { P } = moteurAvecStockage();
  const t0 = 1_800_000_000_000;
  assert.ok(P.peutEtreSauvegarder('{"a":1}', t0));
  assert.equal(P.peutEtreSauvegarder('{"a":2}', t0 + HEURE / 2), null);
  assert.ok(P.peutEtreSauvegarder('{"a":3}', t0 + HEURE + 1000));
  assert.equal([...P.lireSauvegardes()].length, 2);
});

test("un état inchangé ne crée pas de doublon", () => {
  const { P } = moteurAvecStockage();
  const t0 = 1_800_000_000_000;
  P.peutEtreSauvegarder('{"a":1}', t0);
  assert.equal(P.peutEtreSauvegarder('{"a":1}', t0 + 2 * HEURE), null);
  assert.equal([...P.lireSauvegardes()].length, 1);
});

test("seuls les derniers instantanés sont gardés", () => {
  const { P } = moteurAvecStockage();
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < P.SAUVEGARDES_MAX + 4; i++) P.peutEtreSauvegarder('{"n":' + i + "}", t0 + i * HEURE);
  const liste = [...P.lireSauvegardes()];
  assert.equal(liste.length, P.SAUVEGARDES_MAX);
  assert.equal(JSON.parse(liste[liste.length - 1].etat).n, P.SAUVEGARDES_MAX + 3);
  assert.equal(JSON.parse(liste[0].etat).n, 4);   // les plus anciens sont tombés
});

test("un état trop gros n'est pas mis en sauvegarde", () => {
  const { P } = moteurAvecStockage();
  assert.equal(P.peutEtreSauvegarder("x".repeat(500 * 1024), 1_800_000_000_000), null);
  assert.equal([...P.lireSauvegardes()].length, 0);
});

test("un stockage abîmé se lit comme une liste vide", () => {
  const { P, memoire } = moteurAvecStockage();
  memoire.set(P.CLE_SAUVEGARDES, "{pas du json");
  assert.deepEqual([...P.lireSauvegardes()], []);
  memoire.set(P.CLE_SAUVEGARDES, '[{"n'.concat('":1}, null, 3]'));
  assert.deepEqual([...P.lireSauvegardes()], []);   // aucune entrée valide
});

test("un stockage qui refuse d'écrire ne fait pas échouer l'application", () => {
  const P = chargerMoteur({
    localStorage: {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
      removeItem: () => {},
    },
  });
  assert.doesNotThrow(() => P.peutEtreSauvegarder('{"a":1}', 1_800_000_000_000));
  assert.deepEqual([...P.lireSauvegardes()], []);
});
