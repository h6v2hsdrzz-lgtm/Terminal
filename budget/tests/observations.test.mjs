import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();
const liste = (x) => [...x];
const trouver = (obs, id) => liste(obs).find((o) => o.id === id);
/* Les montants sont mis en forme par Intl : l'espace des milliers est une
   espace fine insécable, pas une espace ordinaire. */
const normal = (t) => String(t).replace(/[\u00a0\u202f]/g, " ");
const contient = (texte, attendu) => assert.ok(normal(texte).includes(attendu),
  JSON.stringify(normal(texte)) + " ne contient pas " + JSON.stringify(attendu));

function foyer(patch) {
  return P.poserEtat(Object.assign({
    version: 2,
    parametres: { debutProjection: "2026-01-01", horizon: 12, seuilAlerte: 500 },
    comptes: [
      { id: "c1", nom: "Courant", solde: 2000, soldeDate: "2026-01-01" },
      { id: "c2", nom: "Livret", type: "epargne", solde: 4000, soldeDate: "2026-01-01" },
    ],
    categories: [
      { id: "k-sal", nom: "Salaire", type: "revenu" },
      { id: "k-log", nom: "Logement", type: "depense", essentiel: true },
      { id: "k-cou", nom: "Courses", type: "depense", essentiel: true },
      { id: "k-loi", nom: "Loisirs", type: "depense", essentiel: false },
      { id: "k-imp", nom: "Impôts", type: "depense", essentiel: true },
    ],
    flux: [
      { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2400, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
      { id: "f-loy", libelle: "Loyer", type: "depense", montant: 800, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-03" },
      { id: "f-cou", libelle: "Courses", type: "depense", montant: 400, categorieId: "k-cou", compteId: "c1", frequence: "mensuel", debut: "2026-01-10" },
      { id: "f-loi", libelle: "Sorties", type: "depense", montant: 120, categorieId: "k-loi", compteId: "c1", frequence: "mensuel", debut: "2026-01-20" },
    ],
  }, patch));
}

test("le premier poste de dépense est nommé, avec sa part", () => {
  foyer();
  const o = trouver(P.observations(P.projeter({})), "poste-principal");
  assert.ok(o);
  assert.ok(o.titre.startsWith("Logement"));
  contient(o.texte, "800");
});

test("le poids du logement se mesure sur les revenus", () => {
  foyer({ flux: [
    { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2400, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
    { id: "f-loy", libelle: "Loyer", type: "depense", montant: 780, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-03" },
  ] });
  const o = trouver(P.observations(P.projeter({})), "poids-logement");
  contient(o.titre, "32,5 %");    // 780 sur 2400
  assert.equal(o.ton, "info");
});

test("au-dessus d'un tiers, le logement passe en attention", () => {
  foyer({ flux: [
    { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2000, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
    { id: "f-loy", libelle: "Loyer", type: "depense", montant: 900, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-03" },
  ] });
  const o = trouver(P.observations(P.projeter({})), "poids-logement");
  assert.equal(o.ton, "attention");
  contient(o.texte, "taux d'effort");
});

test("les charges qui tombent en une fois sont chiffrées à l'année et au mois", () => {
  foyer({ flux: [
    { id: "f-ass", libelle: "Assurance", type: "depense", montant: 480, categorieId: "k-log", compteId: "c1", frequence: "annuel", debut: "2026-03-15" },
    { id: "f-imp", libelle: "Impôt", type: "depense", montant: 300, categorieId: "k-imp", compteId: "c1", frequence: "trimestriel", debut: "2026-02-15" },
  ] });
  const o = trouver(P.observations(P.projeter({})), "charges-lourdes");
  contient(o.titre, "2 charges");
  contient(o.texte, "1 680 €");   // 480 + 4 × 300
  contient(o.texte, "140 €");     // par mois
});

test("un flux qui se termine est annoncé comme une mensualité libérée", () => {
  foyer({ flux: [
    { id: "f-cre", libelle: "Crédit auto", type: "depense", montant: 250, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-05", fin: "2026-08-05" },
  ] });
  const o = trouver(P.observations(P.projeter({})), "flux-fini");
  assert.ok(o.titre.includes("Crédit auto"));
  assert.equal(o.ton, "bien");
  contient(o.texte, "3 000 €");   // 250 × 12
});

test("la couverture de l'épargne se compte en mois de charges contraintes", () => {
  foyer();
  const o = trouver(P.observations(P.projeter({})), "couverture");
  // 4 000 € pour 1 200 € de charges contraintes par mois
  contient(o.titre, "3,3 mois");
  assert.equal(o.ton, "bien");
});

test("une épargne trop courte passe en attention et chiffre le manque", () => {
  foyer({ comptes: [
    { id: "c1", nom: "Courant", solde: 2000, soldeDate: "2026-01-01" },
    { id: "c2", nom: "Livret", type: "epargne", solde: 1000, soldeDate: "2026-01-01" },
  ] });
  const o = trouver(P.observations(P.projeter({})), "couverture");
  assert.equal(o.ton, "attention");
  contient(o.texte, "2 600 €");   // 3 × 1 200 − 1 000
});

test("les revalorisations sont chiffrées à un an", () => {
  foyer({ flux: [
    { id: "f-loy", libelle: "Loyer", type: "depense", montant: 1000, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-03", indexation: 5 },
  ] });
  const o = trouver(P.observations(P.projeter({})), "revalorisation");
  contient(o.texte, "50 €");      // 5 % de 1 000, par mois
  contient(o.titre, "600 €");     // sur l'année
});

test("le jour du mois qui concentre les sorties est repéré", () => {
  foyer({ flux: [
    { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2400, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-28" },
    { id: "f-loy", libelle: "Loyer", type: "depense", montant: 800, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-03" },
    { id: "f-a", libelle: "A", type: "depense", montant: 60, categorieId: "k-cou", compteId: "c1", frequence: "mensuel", debut: "2026-01-07" },
    { id: "f-b", libelle: "B", type: "depense", montant: 60, categorieId: "k-cou", compteId: "c1", frequence: "mensuel", debut: "2026-01-11" },
    { id: "f-c", libelle: "C", type: "depense", montant: 60, categorieId: "k-loi", compteId: "c1", frequence: "mensuel", debut: "2026-01-16" },
    { id: "f-d", libelle: "D", type: "depense", montant: 60, categorieId: "k-loi", compteId: "c1", frequence: "mensuel", debut: "2026-01-22" },
  ] });
  const o = trouver(P.observations(P.projeter({})), "jour-charge");
  assert.ok(o.titre.includes("Le 3 "), o.titre);
});

test("sans revalorisation ni fin de flux, ces constats se taisent", () => {
  foyer();
  const obs = P.observations(P.projeter({}));
  assert.equal(trouver(obs, "revalorisation"), undefined);
  assert.equal(trouver(obs, "flux-fini"), undefined);
});

test("un compte pointé il y a longtemps le signale", () => {
  const vieux = P.ajouterJours(new Date().toISOString().slice(0, 10), -80);
  foyer({ comptes: [{ id: "c1", nom: "Courant", solde: 2000, soldeDate: vieux }] });
  const o = trouver(P.observations(P.projeter({})), "pointage-vieux");
  contient(o.titre, "80 jours");
});

test("la dérive mesurée devient un constat", () => {
  const releves = [-90, -90, -90].map((ecart, i) => ({
    date: "2026-0" + (i + 1) + "-15", solde: 1000 + ecart, prevu: 1000, jours: 30,
  }));
  foyer({ comptes: [{ id: "c1", nom: "Courant", solde: 2000, soldeDate: "2026-01-01", releves }] });
  const o = trouver(P.observations(P.projeter({})), "derive");
  assert.ok(o.titre.includes("optimiste"));
  assert.equal(o.ton, "attention");
});

test("les constats sont rangés du plus lourd au plus léger", () => {
  foyer();
  const obs = liste(P.observations(P.projeter({})));
  assert.ok(obs.length >= 3);
  for (let i = 1; i < obs.length; i++) assert.ok(obs[i - 1].poids >= obs[i].poids);
});

test("un budget vide ne produit aucun constat bancal", () => {
  P.poserEtat({ version: 2, comptes: [{ id: "c1", nom: "C", solde: 0, soldeDate: "2026-01-01" }], flux: [] });
  const obs = liste(P.observations(P.projeter({})));
  assert.deepEqual(obs.filter((o) => !o.titre || !o.texte), []);
});
