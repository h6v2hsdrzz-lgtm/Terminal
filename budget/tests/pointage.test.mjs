import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();
const aujourdhui = new Date().toISOString().slice(0, 10);

/** Un foyer dont le compte a été pointé il y a un mois. */
function foyer(patch) {
  return P.poserEtat(Object.assign({
    version: 2,
    parametres: { debutProjection: "2026-03-01", horizon: 12 },
    comptes: [
      { id: "c1", nom: "Courant", solde: 1000, soldeDate: "2026-02-01", releves: [] },
      { id: "c2", nom: "Livret", type: "epargne", solde: 5000, soldeDate: "2026-02-01", releves: [] },
    ],
    categories: [{ id: "k-sal", nom: "Salaire", type: "revenu" }, { id: "k-log", nom: "Logement", type: "depense" }],
    flux: [
      { id: "f-sal", libelle: "Salaire", type: "revenu", montant: 2000, categorieId: "k-sal", compteId: "c1", frequence: "mensuel", debut: "2026-01-05" },
      { id: "f-loy", libelle: "Loyer", type: "depense", montant: 800, categorieId: "k-log", compteId: "c1", frequence: "mensuel", debut: "2026-01-03" },
    ],
  }, patch));
}

/* ── Report du solde depuis son relevé ────────────────────────────────── */

test("un solde daté est reporté jusqu'au départ de la projection", () => {
  const e = foyer();
  // du 2 au 28 février : le loyer du 3 et le salaire du 5 sont déjà passés
  assert.equal(P.soldeRoule(e.comptes[0], "2026-03-01"), 1000 - 800 + 2000);
  assert.equal(P.projeter({}).soldeInitial, 2200 + 5000);
});

test("un relevé du jour n'est reporté de rien", () => {
  const e = foyer({ comptes: [{ id: "c1", nom: "Courant", solde: 1000, soldeDate: "2026-03-01" }] });
  assert.equal(P.soldeRoule(e.comptes[0], "2026-03-01"), 1000);
});

test("un relevé postérieur à la date demandée n'est pas rejoué à l'envers", () => {
  const e = foyer();
  assert.equal(P.soldeRoule(e.comptes[0], "2026-01-15"), 1000);
});

test("le report ne touche que les flux du compte", () => {
  const e = foyer();
  assert.equal(P.soldeRoule(e.comptes[1], "2026-03-01"), 5000);
});

test("un virement est reporté des deux côtés", () => {
  const e = foyer({
    flux: [{ id: "f-vir", libelle: "Épargne", type: "virement", montant: 200, compteId: "c1", compteDest: "c2", frequence: "mensuel", debut: "2026-01-10" }],
  });
  assert.equal(P.soldeRoule(e.comptes[0], "2026-03-01"), 800);
  assert.equal(P.soldeRoule(e.comptes[1], "2026-03-01"), 5200);
});

/* ── Pointer ──────────────────────────────────────────────────────────── */

test("pointer enregistre le réel, le prévu, et avance la date du solde", () => {
  const e = foyer({ comptes: [{ id: "c1", nom: "Courant", solde: 1000, soldeDate: "2026-02-01" }] });
  const r = P.pointerSolde("c1", "2026-03-01", 2050);
  assert.equal(r.solde, 2050);
  assert.equal(r.prevu, 2200);          // ce que la projection annonçait
  assert.equal(r.jours, 28);
  assert.equal(e.comptes[0].solde, 2050);
  assert.equal(e.comptes[0].soldeDate, "2026-03-01");
  assert.equal([...e.comptes[0].releves].length, 1);
});

test("un pointage dans le futur ou antérieur au dernier est refusé", () => {
  foyer();
  assert.equal(P.pointerSolde("c1", "2030-01-01", 1), null);
  assert.equal(P.pointerSolde("c1", "2026-01-01", 1), null);
  assert.equal(P.pointerSolde("inconnu", "2026-03-01", 1), null);
});

test("deux pointages le même jour : le second corrige le premier", () => {
  const e = foyer();
  P.pointerSolde("c1", "2026-03-01", 2050);
  P.pointerSolde("c1", "2026-03-01", 2075);
  assert.equal([...e.comptes[0].releves].length, 1);
  assert.equal(e.comptes[0].solde, 2075);
});

test("un pointage du jour même est une correction, pas une dérive", () => {
  const e = foyer({ comptes: [{ id: "c1", nom: "Courant", solde: 1000, soldeDate: "2026-02-01" }] });
  P.pointerSolde("c1", "2026-02-01", 950);
  assert.equal([...e.comptes[0].releves][0].jours, 0);
  assert.deepEqual([...P.derives()], []);
});

/* ── Dérive ───────────────────────────────────────────────────────────── */

/** Un relevé couvre un nombre entier de jours : la dérive mensuelle est
 *  donc l'écart ramené à 30,44 jours, pas l'écart brut. */
const parMois = (ecart, jours) => Math.round((ecart / jours) * 30.44 * 100) / 100;

function avecDerives(ecarts) {
  const releves = ecarts.map((ecart, i) => ({
    date: "2026-0" + (i + 1) + "-15", solde: 1000 + ecart, prevu: 1000, jours: 30,
  }));
  return foyer({ comptes: [{ id: "c1", nom: "Courant", solde: 1000, soldeDate: "2026-02-01", releves }] });
}

test("la dérive compare réel et prévu, ramenés au mois", () => {
  foyer({ comptes: [{ id: "c1", nom: "Courant", solde: 900, soldeDate: "2026-03-01",
    releves: [{ date: "2026-03-01", solde: 900, prevu: 1000, jours: 15 }] }] });
  const d = [...P.derives()];
  assert.equal(d.length, 1);
  assert.equal(d[0].ecart, -100);
  assert.equal(d[0].parMois, Math.round((-100 / 15) * 30.44 * 100) / 100);
});

test("le biais et la dispersion se lisent sur l'historique", () => {
  avecDerives([-100, -100, -100]);
  const st = P.statistiquesDerive();
  assert.equal(st.n, 3);
  assert.equal(st.biais, parMois(-100, 30));   // systématiquement 100 € de trop dépensés
  assert.equal(st.ecartType, 0);
  assert.equal(st.exploitable, true);
});

test("sous trois pointages, la dérive n'est pas exploitée", () => {
  avecDerives([-100, 50]);
  const st = P.statistiquesDerive();
  assert.equal(st.n, 2);
  assert.equal(st.exploitable, false);
  assert.equal(P.bandeIncertitude(P.projeter({}), st), null);
});

test("sans aucun pointage, les statistiques sont neutres", () => {
  foyer();
  const st = P.statistiquesDerive();
  assert.deepEqual({ n: st.n, biais: st.biais, exploitable: st.exploitable }, { n: 0, biais: 0, exploitable: false });
});

/* ── Bande d'incertitude ──────────────────────────────────────────────── */

test("la bande s'ouvre en racine du temps et suit le biais", () => {
  avecDerives([-100, -100, -100, 100, 100, 100]);   // biais nul, dispersion ~110
  const st = P.statistiquesDerive();
  assert.equal(st.biais, 0);
  assert.ok(st.ecartType > 100 && st.ecartType < 120);
  const p = P.projeter({});
  const bande = [...P.bandeIncertitude(p, st)];
  const large = (b) => b.haut - b.bas;
  assert.equal(large(bande[0]), 0);                      // au départ, aucune marge
  const un = bande.find((b) => b.date >= "2026-04-01");
  const quatre = bande.find((b) => b.date >= "2026-07-01");
  // quatre fois plus de temps, deux fois plus large — pas quatre
  assert.ok(Math.abs(large(quatre) / large(un) - 2) < 0.25, large(quatre) / large(un));
});

test("un biais systématique décale le centre de la bande", () => {
  avecDerives([-120, -120, -120]);
  const p = P.projeter({});
  const bande = [...P.bandeIncertitude(p, P.statistiquesDerive())];
  const six = bande.find((b) => b.date >= "2026-09-01");
  const prevu = P.soldeALaDate(p, six.date);
  assert.ok(six.centre < prevu - 600, six.centre + " vs " + prevu);
});

/* ── Migration ────────────────────────────────────────────────────────── */

test("un état v1 est migré : les comptes reçoivent un solde daté", () => {
  const v1 = { version: 1, comptes: [{ id: "c1", nom: "Courant", solde: 500 }], flux: [] };
  const migre = P.migrer(JSON.parse(JSON.stringify(v1)));
  assert.equal(migre.version, 2);
  assert.equal(migre.comptes[0].soldeDate, aujourdhui);
  assert.deepEqual([...migre.comptes[0].releves], []);
});

test("un état sans numéro de version est traité comme un v1", () => {
  const e = P.normaliser({ comptes: [{ id: "c1", nom: "C", solde: 10 }] });
  assert.equal(e.version, 2);
  assert.equal(e.comptes[0].soldeDate, aujourdhui);
});

test("un état déjà à jour n'est pas migré deux fois", () => {
  const e = P.normaliser({ version: 2, comptes: [{ id: "c1", nom: "C", solde: 10, soldeDate: "2026-01-01" }] });
  assert.equal(e.comptes[0].soldeDate, "2026-01-01");
});

test("un solde constaté dans le futur est ramené à aujourd'hui", () => {
  const e = P.normaliser({ comptes: [{ id: "c1", nom: "C", solde: 10, soldeDate: "2099-01-01" }] });
  assert.equal(e.comptes[0].soldeDate, aujourdhui);
});
