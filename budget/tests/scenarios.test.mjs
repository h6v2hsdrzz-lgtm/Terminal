import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();

function base() {
  return P.poserEtat({
    parametres: { debutProjection: "2026-01-01", horizon: 12 },
    comptes: [{ id: "c1", nom: "Courant", solde: 1000 }],
    categories: [
      { id: "k-sal", nom: "Salaire", type: "revenu" },
      { id: "k-log", nom: "Logement", type: "depense" },
    ],
    flux: [
      { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2000, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
      { id: "f-loy", libelle: "Loyer", type: "depense", montant: 800, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-03" },
    ],
    scenarios: [
      { id: "s1", nom: "Coupe", ajustDepenses: -25 },
      { id: "s2", nom: "Chômage", ajustRevenus: -40, soldeDelta: 2000 },
      { id: "s3", nom: "Sans loyer", exclus: ["f-loy"] },
    ],
  });
}

test("un pourcentage de dépenses s'applique à chaque flux de dépense", () => {
  base();
  const p = P.projeterScenario(P.etat().scenarios[0], "2026-01-01", "2026-12-31");
  assert.equal(p.totaux.depenses, 600 * 12);
  assert.equal(p.totaux.revenus, 2000 * 12);   // les revenus ne bougent pas
});

test("un scénario ne touche pas les flux d'origine", () => {
  base();
  P.projeterScenario(P.etat().scenarios[0], "2026-01-01", "2026-12-31");
  assert.equal(P.etat().flux.find((f) => f.id === "f-loy").montant, 800);
  assert.equal(P.projeter({}).totaux.depenses, 800 * 12);
});

test("un delta de solde décale le point de départ", () => {
  base();
  const p = P.projeterScenario(P.etat().scenarios[1], "2026-01-01", "2026-12-31");
  assert.equal(p.soldeInitial, 3000);
  assert.equal(p.totaux.revenus, 1200 * 12);
});

test("un flux exclu disparaît de la trajectoire", () => {
  base();
  const s = P.etat().scenarios[2];
  assert.equal([...P.fluxDuScenario(s)].length, 1);
  const p = P.projeterScenario(s, "2026-01-01", "2026-12-31");
  assert.equal(p.totaux.depenses, 0);
  assert.equal(p.soldeFinal, 1000 + 2000 * 12);
});

test("un flux ajouté par le scénario s'ajoute aux autres", () => {
  base();
  const etat = P.poserEtat(Object.assign(JSON.parse(JSON.stringify(P.etat())), {
    scenarios: [{
      id: "s4", nom: "Déménagement", exclus: ["f-loy"],
      extras: [{ id: "x1", libelle: "Nouveau loyer", type: "depense", montant: 950, compteId: "c1", categorieId: "k-log", frequence: "mensuel", debut: "2026-01-03" }],
    }],
  }));
  const p = P.projeterScenario(etat.scenarios[0], "2026-01-01", "2026-12-31");
  assert.equal(p.totaux.depenses, 950 * 12);
});

test("sans scénario, la liste de flux est celle du budget", () => {
  base();
  assert.equal([...P.fluxDuScenario(null)].length, 2);
});
