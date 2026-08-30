import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();

/** Un foyer minimal et parfaitement prévisible. */
function foyer(patch) {
  return P.poserEtat(Object.assign({
    parametres: { debutProjection: "2026-01-01", horizon: 12, seuilAlerte: 0 },
    comptes: [
      { id: "c1", nom: "Courant", solde: 1000 },
      { id: "c2", nom: "Livret", type: "epargne", solde: 500 },
    ],
    categories: [
      { id: "k-sal", nom: "Salaire", type: "revenu", teinte: 2 },
      { id: "k-log", nom: "Logement", type: "depense", teinte: 1 },
      { id: "k-epa", nom: "Épargne", type: "depense", teinte: 3 },
    ],
    flux: [
      { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2000, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
      { id: "f-loy", libelle: "Loyer", type: "depense", montant: 800, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-03" },
      { id: "f-epa", libelle: "Virement épargne", type: "depense", montant: 200, categorieId: "k-epa", compteId: "c1", frequence: "mensuel", debut: "2026-01-10" },
    ],
  }, patch));
}

test("les totaux mensuels et le solde final suivent l'arithmétique", () => {
  foyer();
  const p = P.projeter({});
  assert.equal(p.mois.length, 12);              // douze mois pleins
  assert.equal(p.mois[0].revenus, 2000);
  assert.equal(p.mois[0].depenses, 1000);
  assert.equal(p.mois[0].net, 1000);
  assert.equal(p.mois[0].soldeFin, 2500);       // 1500 de départ + 1000
  assert.equal(p.totaux.netMensuel, 1000);
  assert.equal(p.soldeFinal, 1500 + 12 * 1000);
  assert.equal(p.soldeInitial, 1500);
});

test("le solde de départ est la somme des comptes", () => {
  foyer();
  assert.equal(P.projeter({}).soldeInitial, 1500);
  assert.equal(P.projeter({ compteId: "c2" }).soldeInitial, 500);
});

test("un périmètre par compte ne retient que les flux de ce compte", () => {
  foyer();
  const p = P.projeter({ compteId: "c2" });
  assert.equal(p.operations.length, 0);
  assert.equal(p.soldeFinal, 500);
});

test("le taux d'épargne est la part des revenus non dépensée", () => {
  foyer();
  const p = P.projeter({});
  assert.equal(Math.round(p.totaux.tauxEpargne), 50);   // 1000 gardés sur 2000
});

test("le découvert est daté au jour où le solde passe sous zéro", () => {
  foyer({
    comptes: [{ id: "c1", nom: "Courant", solde: 100 }],
    flux: [
      { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 1000, compteId: "c1", categorieId: "k-sal", frequence: "mensuel", debut: "2026-01-28" },
      { id: "f-loy", libelle: "Loyer", type: "depense", montant: 1200, compteId: "c1", categorieId: "k-log", frequence: "mensuel", debut: "2026-01-03" },
    ],
  });
  const p = P.projeter({});
  assert.equal(p.alerte.dateDecouvert, "2026-01-03");   // 100 − 1200
  assert.ok(p.alerte.soldeMin < 0);
  assert.ok(p.soldeFinal < 0);
});

test("le seuil de sécurité alerte avant le découvert", () => {
  foyer({ parametres: { debutProjection: "2026-01-01", horizon: 12, seuilAlerte: 3000 } });
  const p = P.projeter({});
  assert.equal(p.alerte.dateDecouvert, null);
  assert.equal(p.alerte.dateSousSeuil, "2026-01-03");   // 1500 − 800, sous 3000
});

test("aucune alerte quand la trajectoire ne descend jamais", () => {
  foyer();
  const p = P.projeter({});
  assert.equal(p.alerte.dateDecouvert, null);
  assert.equal(p.alerte.dateSousSeuil, null);
});

test("la courbe est un escalier : entre deux échéances, le solde ne bouge pas", () => {
  foyer();
  const p = P.projeter({});
  assert.equal(P.soldeALaDate(p, "2026-01-01"), 1500);
  assert.equal(P.soldeALaDate(p, "2026-01-03"), 700);    // après le loyer
  assert.equal(P.soldeALaDate(p, "2026-01-04"), 700);    // rien ce jour-là
  assert.equal(P.soldeALaDate(p, "2026-01-05"), 2700);   // après le salaire
  assert.equal(P.soldeALaDate(p, "2026-01-31"), 2500);
});

test("chaque mois de la fenêtre est présent, même sans opération", () => {
  foyer({
    flux: [{ id: "f-un", libelle: "Prime", type: "revenu", montant: 500, compteId: "c1", categorieId: "k-sal", frequence: "ponctuel", debut: "2026-06-15" }],
  });
  const p = P.projeter({});
  assert.equal(p.mois.length, 12);
  assert.equal(p.mois[0].operations.length, 0);
  assert.equal(p.mois[0].soldeFin, 1500);
  assert.equal(p.mois[5].revenus, 500);
  assert.equal(p.mois[11].soldeFin, 2000);
});

test("la répartition par catégorie somme les montants bruts", () => {
  foyer();
  const p = P.projeter({});
  assert.equal(p.parCategorie.get("k-log").total, 800 * 12);
  assert.equal(p.parCategorie.get("k-log").nombre, 12);
  assert.equal(p.parCategorie.get("k-sal").type, "revenu");
});

test("les enveloppes comparent la moyenne mensuelle au plafond", () => {
  foyer({
    categories: [
      { id: "k-sal", nom: "Salaire", type: "revenu" },
      { id: "k-log", nom: "Logement", type: "depense", plafond: 700 },
      { id: "k-epa", nom: "Épargne", type: "depense", plafond: 500 },
    ],
  });
  const env = [...P.enveloppes(P.projeter({}))];
  const logement = env.find((e) => e.categorie.id === "k-log");
  assert.equal(logement.mensuel, 800);
  assert.equal(logement.ecart, 100);            // 100 de trop chaque mois
  assert.ok(logement.ratio > 1);
  const epargne = env.find((e) => e.categorie.id === "k-epa");
  assert.equal(epargne.ecart, -300);            // 200 versés pour 500 permis
});

test("un rythme moyen lisse les charges non mensuelles", () => {
  foyer();
  const trimestriel = P.poserEtat({
    flux: [{ id: "f", libelle: "Eau", type: "depense", montant: 300, frequence: "trimestriel", debut: "2026-01-01" }],
  }).flux[0];
  assert.equal(P.mensualiteMoyenne(trimestriel), 100);
});

/* ── Virements entre comptes ──────────────────────────────────────────── */

function avecVirement() {
  return P.poserEtat({
    parametres: { debutProjection: "2026-01-01", horizon: 12 },
    comptes: [
      { id: "c1", nom: "Courant", solde: 1000 },
      { id: "c2", nom: "Livret", type: "epargne", solde: 500 },
    ],
    categories: [{ id: "k-sal", nom: "Salaire", type: "revenu" }, { id: "k-div", nom: "Divers", type: "depense" }],
    flux: [
      { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2000, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
      { id: "f-vir", libelle: "Virement épargne", type: "virement", montant: 300, compteId: "c1", compteDest: "c2", frequence: "mensuel", debut: "2026-01-10" },
    ],
  });
}

test("vu de tous les comptes, un virement ne crée ni revenu ni dépense", () => {
  avecVirement();
  const p = P.projeter({});
  assert.equal(p.totaux.revenus, 2000 * 12);
  assert.equal(p.totaux.depenses, 0);
  assert.equal(p.soldeFinal, 1500 + 2000 * 12);       // le patrimoine ne bouge pas d'un virement
});

test("le virement apparaît quand même à l'agenda, à montant nul", () => {
  avecVirement();
  const p = P.projeter({});
  const vir = [...p.operations].filter((o) => o.type === "virement");
  assert.equal(vir.length, 12);
  assert.equal(vir[0].sens, "interne");
  assert.equal(vir[0].montant, 0);
  assert.equal(vir[0].brut, 300);
});

test("sur le compte de départ, le virement est une sortie", () => {
  avecVirement();
  const p = P.projeter({ compteId: "c1" });
  assert.equal(p.totaux.depenses, 300 * 12);
  assert.equal(p.soldeFinal, 1000 + (2000 - 300) * 12);
});

test("sur le compte d'arrivée, c'est une entrée", () => {
  avecVirement();
  const p = P.projeter({ compteId: "c2" });
  assert.equal(p.totaux.revenus, 300 * 12);
  assert.equal(p.totaux.depenses, 0);
  assert.equal(p.soldeFinal, 500 + 300 * 12);
});

test("un virement n'entre dans aucune catégorie", () => {
  avecVirement();
  const p = P.projeter({});
  assert.equal([...p.parCategorie.keys()].includes(null), false);
  assert.equal(p.parCategorie.size, 1);               // le salaire seulement
});

test("un virement sans second compte redevient une dépense", () => {
  const e = P.normaliser({
    comptes: [{ id: "c1", nom: "Courant", solde: 0 }],
    flux: [{ libelle: "Épargne", type: "virement", montant: 100, compteId: "c1", frequence: "mensuel", debut: "2026-01-01" }],
  });
  assert.equal(e.flux[0].type, "depense");
  assert.equal(e.flux[0].compteDest, null);
});

test("une destination absente ou identique à la source est corrigée", () => {
  const e = P.normaliser({
    comptes: [{ id: "c1", nom: "Courant", solde: 0 }, { id: "c2", nom: "Livret", solde: 0 }],
    flux: [{ libelle: "V", type: "virement", montant: 100, compteId: "c1", compteDest: "c1", frequence: "mensuel", debut: "2026-01-01" }],
  });
  assert.equal(e.flux[0].compteDest, "c2");
});

test("les scénarios laissent les virements tranquilles", () => {
  avecVirement();
  const etat = P.poserEtat(Object.assign(JSON.parse(JSON.stringify(P.etat())), {
    scenarios: [{ id: "s", nom: "Coupe", ajustDepenses: -50 }],
  }));
  const flux = [...P.fluxDuScenario(etat.scenarios[0])];
  assert.equal(flux.find((f) => f.id === "f-vir").montant, 300);
});
