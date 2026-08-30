import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();

function avecObjectif(cible, dateCible, compteId) {
  return P.poserEtat({
    parametres: { debutProjection: "2026-01-01", horizon: 24 },
    comptes: [
      { id: "c1", nom: "Courant", solde: 1000 },
      { id: "c2", nom: "Livret", type: "epargne", solde: 2000 },
    ],
    categories: [{ id: "k-sal", nom: "Salaire", type: "revenu" }, { id: "k-div", nom: "Divers", type: "depense" }],
    flux: [
      { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 1500, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
      { id: "f-dep", libelle: "Vie courante", type: "depense", montant: 1200, categorieId: "k-div", compteId: "c1", frequence: "mensuel", debut: "2026-01-06" },
      { id: "f-liv", libelle: "Versement livret", type: "revenu", montant: 100, categorieId: "k-sal", compteId: "c2", frequence: "mensuel", debut: "2026-01-07" },
    ],
    objectifs: [{ id: "o1", nom: "Cible", cible, dateCible, compteId: compteId || null }],
  });
}

test("un objectif atteint est reconnu comme tel", () => {
  const etat = avecObjectif(5000, "2026-12-31");
  const e = P.evaluerObjectif(etat.objectifs[0], P.projeter({}));
  // 3000 au départ, +400 par mois pendant 12 mois → 7800
  assert.equal(e.verdict, "atteint");
  assert.ok(e.projete > 5000);
  assert.equal(e.effortMensuel, 0);
});

test("un objectif hors d'atteinte chiffre l'effort mensuel manquant", () => {
  const etat = avecObjectif(20000, "2026-12-31");
  const e = P.evaluerObjectif(etat.objectifs[0], P.projeter({}));
  assert.equal(e.verdict, "insuffisant");
  assert.equal(e.moisRestants, 11);
  assert.equal(e.effortMensuel, Math.round((20000 - e.projete) / 11 * 100) / 100);
  assert.ok(e.manque > 0);
});

test("un objectif suivi sur un compte ne compte que ce compte", () => {
  const etat = avecObjectif(3000, "2026-12-31", "c2");
  const e = P.evaluerObjectif(etat.objectifs[0], P.projeter({}));
  assert.equal(e.actuel, 2000);                 // solde du livret seul
  assert.equal(e.projete, 2000 + 100 * 12);     // ses seuls versements
  assert.equal(e.verdict, "atteint");
});

test("une date au-delà de l'horizon n'est pas jugée", () => {
  const etat = avecObjectif(3000, "2030-01-01");
  const e = P.evaluerObjectif(etat.objectifs[0], P.projeter({}));
  assert.equal(e.verdict, "hors-horizon");
  assert.equal(e.projete, null);
});

test("la progression reste bornée entre 0 et 1", () => {
  const etat = avecObjectif(1000, "2026-12-31");
  const e = P.evaluerObjectif(etat.objectifs[0], P.projeter({}));
  assert.equal(e.progression, 1);
  assert.ok(e.progressionActuelle > 0 && e.progressionActuelle <= 1);
});
