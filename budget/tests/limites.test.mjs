import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

/* Les cas tordus : entrées vides, dates extrêmes, combinaisons rares. Ce
   sont eux qui cassent en silence, longtemps après. */

const P = chargerMoteur();
const liste = (x) => [...x];

test("un flux sans échéance dans la fenêtre ne casse pas la projection", () => {
  P.poserEtat({
    version: 2,
    parametres: { debutProjection: "2026-01-01", horizon: 6 },
    comptes: [{ id: "c1", nom: "C", solde: 100, soldeDate: "2026-01-01" }],
    flux: [{ id: "f", libelle: "Lointain", type: "depense", montant: 50, compteId: "c1", frequence: "annuel", debut: "2030-01-01" }],
  });
  const p = P.projeter({});
  assert.equal(liste(p.operations).length, 0);
  assert.equal(p.soldeFinal, 100);
  assert.equal(liste(p.mois).length, 6);
  assert.equal(p.totaux.tauxEpargne, null);
});

test("une échéance ajustée puis dépassée par la dernière échéance disparaît", () => {
  const e = P.normaliser({
    flux: [{ libelle: "X", montant: 10, frequence: "mensuel", debut: "2026-01-05", fin: "2026-02-05",
             exceptions: [{ date: "2026-03-05", montant: 99 }] }],
  });
  const oc = liste(P.occurrences(e.flux[0], "2026-01-01", "2026-12-31", "2026-01-01"));
  assert.deepEqual(oc.map((o) => o.date), ["2026-01-05", "2026-02-05"]);
});

test("un virement dont une échéance est sautée ne bouge sur aucun des deux comptes", () => {
  P.poserEtat({
    version: 2,
    parametres: { debutProjection: "2026-01-01", horizon: 3 },
    comptes: [{ id: "c1", nom: "A", solde: 1000, soldeDate: "2026-01-01" },
              { id: "c2", nom: "B", solde: 0, soldeDate: "2026-01-01" }],
    flux: [{ id: "v", libelle: "V", type: "virement", montant: 100, compteId: "c1", compteDest: "c2",
             frequence: "mensuel", debut: "2026-01-10", exceptions: [{ date: "2026-02-10", ignore: true }] }],
  });
  assert.equal(P.projeter({ compteId: "c1" }).soldeFinal, 1000 - 200);
  assert.equal(P.projeter({ compteId: "c2" }).soldeFinal, 200);
  assert.equal(P.projeter({}).soldeFinal, 1000);
});

test("un horizon d'un mois reste cohérent", () => {
  P.poserEtat({
    version: 2,
    parametres: { debutProjection: "2026-01-15", horizon: 3 },
    comptes: [{ id: "c1", nom: "C", solde: 0, soldeDate: "2026-01-15" }],
    flux: [{ id: "f", libelle: "Loyer", type: "depense", montant: 100, compteId: "c1", frequence: "mensuel", debut: "2026-01-20" }],
  });
  const p = P.projeter({});
  assert.equal(p.du, "2026-01-15");
  assert.equal(p.au, "2026-03-31");
  assert.equal(liste(p.mois).length, 3);
  assert.equal(liste(p.operations).length, 3);
});

test("un seul pointage ne produit ni biais ni bande", () => {
  P.poserEtat({
    version: 2,
    comptes: [{ id: "c1", nom: "C", solde: 900, soldeDate: "2026-02-01",
      releves: [{ date: "2026-02-01", solde: 900, prevu: 1000, jours: 20 }] }],
    flux: [],
  });
  const st = P.statistiquesDerive();
  assert.equal(st.n, 1);
  assert.equal(st.ecartType, 0);          // aucune dispersion mesurable
  assert.equal(st.exploitable, false);
  assert.equal(P.bandeIncertitude(P.projeter({}), st), null);
});

test("un relevé vide ou illisible ne produit aucune proposition", () => {
  assert.deepEqual(liste(P.detecterRecurrences([], { depuis: "2026-01-01" }).propositions), []);
  assert.equal(P.detecterRecurrences([], { depuis: "2026-01-01" }).variables, null);
  const a = P.analyserCsv("Date;Libelle;Montant\nn'importe quoi;;;\nencore;;;");
  const { operations, ignorees } = P.operationsCsv(a, a);
  assert.equal(liste(operations).length, 0);
  assert.equal(ignorees, 2);
});

test("un CSV à deux colonnes se lit quand même", () => {
  const a = P.analyserCsv([
    "01/09/2026;-45,90", "03/09/2026;-780,00", "01/10/2026;-45,90",
    "03/10/2026;-780,00", "01/11/2026;-45,90", "03/11/2026;-780,00",
  ].join("\n"));
  assert.equal(a.colonneDate, 0);
  assert.equal(a.colonneMontant, 1);
  const { operations } = P.operationsCsv(a, a);
  assert.equal(liste(operations).length, 6);
});

test("un montant nul est ignoré : ce n'est pas une opération", () => {
  const a = P.analyserCsv("Date;Libelle;Montant\n01/09/2026;RIEN;0,00\n02/09/2026;VRAI;-10,00");
  const { operations, ignorees } = P.operationsCsv(a, a);
  assert.equal(liste(operations).length, 1);
  assert.equal(ignorees, 1);
});

test("des relevés mal formés sont écartés sans emporter le compte", () => {
  const e = P.normaliser({
    comptes: [{ id: "c1", nom: "C", solde: 10, soldeDate: "2026-01-01", releves: [
      { date: "2026-01-01", solde: 10, prevu: null, jours: 0 },
      { date: "pas une date", solde: 5 },
      null, 42,
      { date: "2025-12-01", solde: 8, prevu: 9, jours: 30 },
    ] }],
  });
  const releves = liste(e.comptes[0].releves);
  assert.equal(releves.length, 2);
  assert.equal(releves[0].date, "2025-12-01");   // remis dans l'ordre
  assert.equal(releves[1].date, "2026-01-01");
});

test("une date de projection très ancienne ne fait pas boucler le moteur", () => {
  P.poserEtat({
    version: 2,
    parametres: { debutProjection: "2026-01-01", horizon: 12 },
    comptes: [{ id: "c1", nom: "C", solde: 0, soldeDate: "2026-01-01" }],
    flux: [{ id: "f", libelle: "Vieux", type: "depense", montant: 10, compteId: "c1", frequence: "hebdo", debut: "1990-01-01" }],
  });
  const p = P.projeter({});
  assert.ok(liste(p.operations).length > 50 && liste(p.operations).length < 55, liste(p.operations).length);
  assert.equal(liste(p.operations)[0].date >= "2026-01-01", true);
});

test("un objectif à zéro ou sans compte ne divise par rien", () => {
  const e = P.poserEtat({
    version: 2,
    parametres: { debutProjection: "2026-01-01", horizon: 12 },
    comptes: [{ id: "c1", nom: "C", solde: 500, soldeDate: "2026-01-01" }],
    flux: [],
    objectifs: [{ id: "o", nom: "Zéro", cible: 0, dateCible: "2026-06-01" }],
  });
  const ev = P.evaluerObjectif(e.objectifs[0], P.projeter({}));
  assert.equal(ev.progression, 0);
  assert.equal(ev.verdict, "atteint");
  assert.equal(ev.effortMensuel, 0);
});

test("le reste à vivre survit à un budget sans revenu", () => {
  P.poserEtat({
    version: 2,
    parametres: { debutProjection: "2026-01-01", horizon: 6 },
    comptes: [{ id: "c1", nom: "C", solde: 0, soldeDate: "2026-01-01" }],
    categories: [{ id: "k", nom: "Divers", type: "depense", essentiel: true }],
    flux: [{ id: "f", libelle: "X", type: "depense", montant: 100, categorieId: "k", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" }],
  });
  const r = P.resteAVivre(P.projeter({}));
  assert.equal(r.revenus, 0);
  assert.equal(r.contraint, 100);
  assert.equal(r.reste, -100);
  assert.equal(r.partContrainte, null);
});

test("les graduations d'un intervalle plat restent utilisables", () => {
  const g = liste(P.graduations(1000, 1000, 4));
  assert.ok(g.length >= 1);
  assert.ok(g.every((v) => isFinite(v)));
  assert.deepEqual(liste(P.graduations(NaN, NaN, 4)), [0]);
});

test("un état contenant des types inattendus ne fait pas tomber la normalisation", () => {
  assert.doesNotThrow(() => P.normaliser({
    version: "deux", parametres: [], comptes: {}, categories: 7, flux: "non",
    objectifs: null, scenarios: [[]],
  }));
  const e = P.normaliser({ version: 99, comptes: [{ id: "c", nom: "C", solde: 1 }] });
  assert.equal(e.version, 2);   // une version inconnue est ramenée à celle du code
});
