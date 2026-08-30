import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();

test("un état vide donne une application utilisable", () => {
  const e = P.normaliser(null);
  assert.equal(e.version, P.VERSION_ETAT);
  assert.ok(e.comptes.length >= 1);
  assert.ok(e.categories.some((c) => c.type === "revenu"));
  assert.ok(e.categories.some((c) => c.type === "depense"));
  assert.deepEqual([...e.flux], []);
});

test("des données absurdes ne cassent rien", () => {
  const e = P.normaliser({
    parametres: "n'importe quoi",
    comptes: [{ nom: 42, solde: "beaucoup" }, null, 7],
    categories: "pas une liste",
    flux: [{ libelle: "", montant: -300, frequence: "tous les mardis", debut: "hier" }, undefined],
    objectifs: [{ cible: "mille" }],
    scenarios: [{ ajustDepenses: 9999 }],
  });
  assert.equal(e.comptes.length, 1);
  assert.equal(e.comptes[0].solde, 0);
  assert.equal(e.flux.length, 1);
  assert.equal(e.flux[0].montant, 300);            // un montant est toujours positif
  assert.equal(e.flux[0].frequence, "mensuel");    // rythme inconnu → mensuel
  assert.equal(P.estIso(e.flux[0].debut), true);
  assert.equal(e.scenarios[0].ajustDepenses, 500); // borné
});

test("le sens du flux porte le signe, jamais le montant", () => {
  const e = P.normaliser({ flux: [{ libelle: "Salaire", type: "revenu", montant: -2000, frequence: "mensuel", debut: "2026-01-01" }] });
  assert.equal(e.flux[0].montant, 2000);
  assert.equal(e.flux[0].type, "revenu");
});

test("une dernière échéance antérieure au début est ramenée au début", () => {
  const e = P.normaliser({ flux: [{ libelle: "X", montant: 10, frequence: "mensuel", debut: "2026-06-01", fin: "2026-01-01" }] });
  assert.equal(e.flux[0].fin, "2026-06-01");
});

test("un flux orphelin est rattaché à un compte et à une catégorie existants", () => {
  const e = P.normaliser({
    comptes: [{ id: "c1", nom: "Courant", solde: 0 }],
    flux: [{ libelle: "X", type: "depense", montant: 10, frequence: "mensuel", debut: "2026-01-01", compteId: "inconnu", categorieId: "inconnue" }],
  });
  assert.equal(e.flux[0].compteId, "c1");
  assert.ok(e.categories.some((c) => c.id === e.flux[0].categorieId && c.type === "depense"));
});

test("un aller-retour par JSON conserve l'état", () => {
  const avant = P.jeuDemo();
  const apres = P.normaliser(JSON.parse(JSON.stringify(avant)));
  assert.deepEqual(JSON.parse(JSON.stringify(apres)), JSON.parse(JSON.stringify(avant)));
});

test("le jeu de démonstration est cohérent et projetable", () => {
  const e = P.poserEtat(P.jeuDemo());
  assert.ok(e.flux.length > 10);
  for (const f of e.flux) {
    assert.equal(P.estIso(f.debut), true);
    assert.ok(f.montant >= 0);
    assert.ok(e.comptes.some((c) => c.id === f.compteId), f.libelle + " : compte inconnu");
    if (f.type === "virement") {
      assert.ok(e.comptes.some((c) => c.id === f.compteDest), f.libelle + " : destination inconnue");
      assert.notEqual(f.compteDest, f.compteId);
      assert.equal(f.categorieId, null);
    } else {
      assert.ok(e.categories.some((c) => c.id === f.categorieId), f.libelle + " : catégorie inconnue");
    }
  }
  const p = P.projeter({});
  assert.ok(p.operations.length > 100);
  assert.ok(p.totaux.revenus > 0 && p.totaux.depenses > 0);
});

test("les paramètres hors bornes retombent sur des valeurs saines", () => {
  const e = P.normaliser({ parametres: { horizon: 999, devise: "BTC", seuilAlerte: -50 } });
  assert.equal(e.parametres.horizon, 24);
  assert.equal(e.parametres.devise, "EUR");
  assert.equal(e.parametres.seuilAlerte, 0);
});

test("mensualité de prêt : annuité constante, et division simple à taux nul", () => {
  assert.equal(P.mensualitePret(12000, 0, 24), 500);
  // 15 000 € sur 48 mois à 3,5 % : 335,34 € par mois
  assert.equal(P.mensualitePret(15000, 3.5, 48), 335.34);
  assert.equal(P.mensualitePret(0, 3, 48), 0);
  assert.equal(P.mensualitePret(1000, 3, 0), 0);
});

test("le total remboursé dépasse le capital du montant des intérêts", () => {
  const m = P.mensualitePret(20000, 4, 60);
  assert.ok(m * 60 > 20000);
  assert.ok(m * 60 < 20000 * 1.15);
});

test("les graduations couvrent l'intervalle avec des pas ronds", () => {
  const g = [...P.graduations(0, 1000, 4)];
  assert.equal(g[0], 0);
  assert.ok(g[g.length - 1] >= 1000);
  assert.ok(g.length >= 3 && g.length <= 8);
  const negatif = [...P.graduations(-500, 500, 4)];
  assert.ok(negatif[0] <= -500);
  assert.ok(negatif.includes(0));
});
