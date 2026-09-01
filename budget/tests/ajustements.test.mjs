import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();
const dates = (oc) => [...oc].map((o) => o.date);
const montants = (oc) => [...oc].map((o) => o.montant);

function foyer(exceptions) {
  return P.poserEtat({
    parametres: { debutProjection: "2026-01-01", horizon: 6 },
    comptes: [{ id: "c1", nom: "Courant", solde: 1000 }],
    categories: [{ id: "k-sal", nom: "Salaire", type: "revenu" },
                 { id: "k-log", nom: "Logement", type: "depense", essentiel: true },
                 { id: "k-loi", nom: "Loisirs", type: "depense", essentiel: false }],
    flux: [
      { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2000, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
      { id: "f-nrj", libelle: "Énergie", type: "depense", montant: 100, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-08", exceptions },
      { id: "f-loi", libelle: "Sorties", type: "depense", montant: 150, categorieId: "k-loi", compteId: "c1", frequence: "mensuel", debut: "2026-01-20" },
    ],
  });
}

/* ── Ajuster une échéance ─────────────────────────────────────────────── */

test("une échéance corrigée ne change que sa propre date", () => {
  const e = foyer([{ date: "2026-02-08", montant: 260 }]);
  const oc = P.occurrences(e.flux[1], "2026-01-01", "2026-04-30", "2026-01-01");
  assert.deepEqual(montants(oc), [100, 260, 100, 100]);
  assert.equal([...oc][1].ajuste, true);
  assert.equal([...oc][0].ajuste, undefined);
});

test("une échéance sautée ne produit rien", () => {
  const e = foyer([{ date: "2026-03-08", ignore: true }]);
  const oc = P.occurrences(e.flux[1], "2026-01-01", "2026-04-30", "2026-01-01");
  assert.deepEqual(dates(oc), ["2026-01-08", "2026-02-08", "2026-04-08"]);
});

test("l'ajustement se retrouve dans la projection et dans le solde", () => {
  const sans = foyer([]);
  const avant = P.projeter({}).soldeFinal;
  foyer([{ date: "2026-02-08", montant: 300 }]);
  const apres = P.projeter({}).soldeFinal;
  assert.equal(arrondi(avant - apres), 200);         // 300 au lieu de 100
  assert.equal(sans.flux[1].exceptions.length, 0);
});

test("un ajustement porte aussi la catégorie et le mois", () => {
  foyer([{ date: "2026-02-08", montant: 300 }]);
  const p = P.projeter({});
  const fevrier = [...p.mois].find((m) => m.cle === "2026-02");
  assert.equal(fevrier.depenses, 300 + 150);
  assert.equal(p.parCategorie.get("k-log").total, 100 * 5 + 300);
});

test("poserException pose, remplace et retire", () => {
  foyer([]);
  P.poserException("f-nrj", "2026-02-08", { montant: 250 });
  assert.equal(P.exceptionDe(P.etat().flux[1], "2026-02-08").montant, 250);
  P.poserException("f-nrj", "2026-02-08", { ignore: true });
  assert.equal(P.exceptionDe(P.etat().flux[1], "2026-02-08").ignore, true);
  assert.equal(P.etat().flux[1].exceptions.length, 1);   // remplacée, pas empilée
  P.poserException("f-nrj", "2026-02-08", null);
  assert.equal(P.exceptionDe(P.etat().flux[1], "2026-02-08"), null);
});

test("les ajustements douteux sont écartés à la lecture", () => {
  const propres = P.normaliserExceptions([
    { date: "2026-02-08", montant: -80 },     // un montant reste positif
    { date: "pas une date", montant: 10 },
    { date: "2026-03-08" },                   // ni montant ni saut : sans effet
    { date: "2026-04-08", ignore: true },
    { date: "2026-02-08", montant: 999 },     // doublon de date
    null,
  ]);
  assert.deepEqual([...propres].map((e) => e.date), ["2026-02-08", "2026-04-08"]);
  assert.equal([...propres][0].montant, 80);
  assert.equal([...propres][1].ignore, true);
});

test("dupliquer un flux ne recopie pas ses ajustements", () => {
  const e = P.normaliser({
    flux: [{ id: "f", libelle: "X", montant: 10, frequence: "mensuel", debut: "2026-01-01",
             exceptions: [{ date: "2026-02-01", montant: 20 }] }],
  });
  assert.equal(e.flux[0].exceptions.length, 1);
});

/* ── Reste à vivre ────────────────────────────────────────────────────── */

test("le reste à vivre retire les seules dépenses contraintes", () => {
  foyer([]);
  const r = P.resteAVivre(P.projeter({}));
  assert.equal(r.revenus, 2000);
  assert.equal(r.contraint, 100);
  assert.equal(r.libre, 150);
  assert.equal(r.reste, 1900);
  assert.equal(r.parJour, arrondi(1900 / 30.44));
});

test("une catégorie non classée est comptée comme contrainte", () => {
  const e = P.normaliser({ categories: [{ nom: "Divers", type: "depense" }] });
  assert.equal(e.categories.find((c) => c.type === "depense").essentiel, true);
});

/* ── Calendrier ───────────────────────────────────────────────────────── */

test("le calendrier rend tous les jours du mois, dans le bon ordre", () => {
  foyer([]);
  const cal = P.calendrier(P.projeter({}), "2026-02");
  assert.equal([...cal.jours].length, 28);
  assert.equal([...cal.jours][0].date, "2026-02-01");
  assert.equal([...cal.jours][27].date, "2026-02-28");
});

test("chaque jour porte ses opérations, ses totaux et le solde du soir", () => {
  foyer([]);
  const p = P.projeter({});
  const cal = P.calendrier(p, "2026-01");
  const cinq = [...cal.jours].find((j) => j.date === "2026-01-05");
  assert.equal([...cinq.operations].length, 1);
  assert.equal(cinq.entrees, 2000);
  assert.equal(cinq.sorties, 0);
  assert.equal(cinq.solde, 3000);
  const huit = [...cal.jours].find((j) => j.date === "2026-01-08");
  assert.equal(huit.sorties, 100);
  assert.equal(huit.solde, 2900);
  const vide = [...cal.jours].find((j) => j.date === "2026-01-06");
  assert.equal([...vide.operations].length, 0);
  assert.equal(vide.solde, 3000);              // le solde ne bouge pas
});

test("le décalage place le 1er du mois sous le bon jour de semaine", () => {
  assert.equal(P.jourSemaine("2026-01-01"), 3);   // un jeudi
  assert.equal(P.jourSemaine("2026-01-05"), 0);   // un lundi
  assert.equal(P.jourSemaine("2026-01-04"), 6);   // un dimanche
  foyer([]);
  assert.equal(P.calendrier(P.projeter({}), "2026-01").decalage, 3);
});

test("un mois hors fenêtre garde ses jours, sans solde", () => {
  foyer([]);
  const cal = P.calendrier(P.projeter({}), "2026-07");   // l'horizon s'arrête fin juin
  const jours = [...cal.jours];
  assert.equal(jours.length, 31);
  assert.equal(jours[jours.length - 1].dedans, false);
  assert.equal(jours[jours.length - 1].solde, null);
});

function arrondi(v) { return Math.round(v * 100) / 100; }
