import test from "node:test";
import assert from "node:assert/strict";
import { chargerMoteur } from "./aide.mjs";

const P = chargerMoteur();
const liste = (x) => [...x];

/* ── Lecture des cellules ─────────────────────────────────────────────── */

test("les dates des relevés, dans les formats que les banques écrivent", () => {
  assert.equal(P.lireDate("12/09/2026"), "2026-09-12");
  assert.equal(P.lireDate("2026-09-12"), "2026-09-12");
  assert.equal(P.lireDate("12.09.2026"), "2026-09-12");
  assert.equal(P.lireDate("1/9/26"), "2026-09-01");
  assert.equal(P.lireDate("12/09/1998"), "1998-09-12");
  assert.equal(P.lireDate("31/02/2026"), null);      // ce jour n'existe pas
  assert.equal(P.lireDate("Monoprix"), null);
  assert.equal(P.lireDate(""), null);
});

test("les montants, dans les deux conventions décimales", () => {
  assert.equal(P.lireMontant("1 234,56"), 1234.56);
  assert.equal(P.lireMontant("1,234.56"), 1234.56);
  assert.equal(P.lireMontant("-1234.56"), -1234.56);
  assert.equal(P.lireMontant("−45,90"), -45.9);       // signe moins typographique
  assert.equal(P.lireMontant("(123,45)"), -123.45);   // débit entre parenthèses
  assert.equal(P.lireMontant("1 234,56 €"), 1234.56);
  assert.equal(P.lireMontant("+780"), 780);
  assert.equal(P.lireMontant("1.234"), 1234);         // milliers, pas décimales
  assert.equal(P.lireMontant("12,5"), 12.5);
  assert.equal(P.lireMontant("MONOPRIX"), null);
  assert.equal(P.lireMontant(""), null);
});

test("les guillemets protègent les séparateurs dans un libellé", () => {
  assert.deepEqual(liste(P.decouperLigne('12/09/2026;"MONOPRIX; PARIS";-45,90', ";")),
    ["12/09/2026", "MONOPRIX; PARIS", "-45,90"]);
  assert.deepEqual(liste(P.decouperLigne('a;"il a dit ""oui""";b', ";")),
    ["a", 'il a dit "oui"', "b"]);
});

test("le séparateur est celui qui découpe régulièrement", () => {
  assert.equal(P.detecterSeparateur(["a;b;c", "1;2;3"]), ";");
  assert.equal(P.detecterSeparateur(["a,b,c", "1,2,3"]), ",");
  assert.equal(P.detecterSeparateur(["a\tb\tc", "1\t2\t3"]), "\t");
});

/* ── Analyse d'un fichier ─────────────────────────────────────────────── */

const RELEVE = `Date;Libellé;Débit;Crédit
01/09/2026;VIR SEPA SALAIRE ACME;;2450,00
03/09/2026;PRLV SEPA LOYER GESTION;780,00;
05/09/2026;CARTE 04/09 MONOPRIX 4512 PARIS;62,30;
08/09/2026;PRLV EDF CLIENTS;118,00;
01/10/2026;VIR SEPA SALAIRE ACME;;2450,00
03/10/2026;PRLV SEPA LOYER GESTION;780,00;
06/10/2026;CARTE 05/10 MONOPRIX 4512 LYON;58,10;
08/10/2026;PRLV EDF CLIENTS;118,00;
01/11/2026;VIR SEPA SALAIRE ACME;;2450,00
03/11/2026;PRLV SEPA LOYER GESTION;780,00;
04/11/2026;CARTE 03/11 MONOPRIX 4512 PARIS;71,40;
08/11/2026;PRLV EDF CLIENTS;118,00;`;

test("l'en-tête, les colonnes et leurs rôles sont reconnus seuls", () => {
  const a = P.analyserCsv(RELEVE);
  assert.equal(a.separateur, ";");
  assert.deepEqual(liste(a.entete), ["Date", "Libellé", "Débit", "Crédit"]);
  assert.equal(liste(a.lignes).length, 12);
  assert.equal(a.colonneDate, 0);
  assert.equal(a.colonneLibelle, 1);
  assert.equal(a.colonneDebit, 2);
  assert.equal(a.colonneCredit, 3);
  assert.equal(a.colonneMontant, -1);
});

test("une colonne unique et signée est reconnue comme telle", () => {
  const a = P.analyserCsv("2026-09-01,SALAIRE,2450.00\n2026-09-03,LOYER,-780.00\n2026-10-01,SALAIRE,2450.00\n2026-10-03,LOYER,-780.00");
  assert.equal(a.entete, null);           // pas d'en-tête : la 1re ligne est une donnée
  assert.equal(a.colonneMontant, 2);
  assert.equal(a.colonneDebit, -1);
});

test("débit et crédit deviennent des montants signés", () => {
  const a = P.analyserCsv(RELEVE);
  const { operations, ignorees } = P.operationsCsv(a, a);
  assert.equal(liste(operations).length, 12);
  assert.equal(ignorees, 0);
  assert.equal(liste(operations)[0].montant, 2450);
  assert.equal(liste(operations)[1].montant, -780);
  assert.equal(liste(operations)[0].date, "2026-09-01");
});

test("les lignes inexploitables sont comptées, pas devinées", () => {
  const a = P.analyserCsv("Date;Libelle;Montant\n01/09/2026;X;10,00\nTOTAL;;;\n03/09/2026;Y;-5,00");
  const { operations, ignorees } = P.operationsCsv(a, a);
  assert.equal(liste(operations).length, 2);
  assert.equal(ignorees, 1);
});

test("un fichier trop court est refusé proprement", () => {
  assert.ok(P.analyserCsv("").erreur);
  assert.ok(P.analyserCsv("juste une ligne").erreur);
});

/* ── Reconnaissance des libellés ──────────────────────────────────────── */

test("un libellé est réduit à ce qui l'identifie", () => {
  assert.equal(P.normaliserLibelle("CARTE 12/09 MONOPRIX 4512 PARIS"), "MONOPRIX PARIS");
  assert.equal(P.normaliserLibelle("PRLV SEPA EDF CLIENTS"), "EDF CLIENTS");
  assert.equal(P.normaliserLibelle("VIR SEPA SALAIRE ACME SAS"), "SALAIRE ACME SAS");
  assert.equal(P.normaliserLibelle("Prélèvement Électricité"), "ELECTRICITE");
  assert.equal(P.normaliserLibelle(""), "SANS LIBELLE");
});

test("deux passages du même commerçant se regroupent", () => {
  assert.equal(P.normaliserLibelle("CARTE 04/09 MONOPRIX 4512 PARIS"),
               P.normaliserLibelle("CARTE 05/10 MONOPRIX 4512 PARIS"));
});

/* ── Détection du rythme ──────────────────────────────────────────────── */

const suite = (debut, pas, n) => Array.from({ length: n }, (_, i) => P.ajouterJours(debut, i * pas));

test("les rythmes réguliers sont reconnus", () => {
  assert.equal(P.detecterRythme(suite("2026-01-05", 7, 6)).frequence, "hebdo");
  assert.equal(P.detecterRythme(suite("2026-01-05", 14, 5)).frequence, "quinzaine");
  assert.equal(P.detecterRythme(["2026-01-03", "2026-02-03", "2026-03-03", "2026-04-03"]).frequence, "mensuel");
  assert.equal(P.detecterRythme(["2026-01-15", "2026-04-15", "2026-07-15"]).frequence, "trimestriel");
  assert.equal(P.detecterRythme(["2025-06-01", "2026-06-01"]).frequence, "annuel");
});

test("un mensuel décalé par les week-ends reste mensuel", () => {
  assert.equal(P.detecterRythme(["2026-01-03", "2026-02-02", "2026-03-05", "2026-04-03"]).frequence, "mensuel");
});

test("des dates irrégulières ne produisent aucun rythme", () => {
  assert.equal(P.detecterRythme(["2026-01-03", "2026-01-09", "2026-02-27", "2026-03-02"]), null);
  assert.equal(P.detecterRythme(["2026-01-03"]), null);
  assert.equal(P.detecterRythme([]), null);
});

test("deux occurrences ne suffisent pas pour un rythme court", () => {
  assert.equal(P.detecterRythme(["2026-01-05", "2026-01-12"]), null);
  assert.equal(P.detecterRythme(["2026-01-05", "2026-02-05"]), null);
});

test("la prochaine échéance est prévue après aujourd'hui", () => {
  const d = P.prochaineEcheancePrevue(["2026-01-03", "2026-02-03", "2026-03-03"], "mensuel", "2026-05-20");
  assert.equal(d, "2026-06-03");
});

/* ── Propositions ─────────────────────────────────────────────────────── */

test("le relevé se transforme en flux proposés, le plus lourd d'abord", () => {
  const a = P.analyserCsv(RELEVE);
  const { operations } = P.operationsCsv(a, a);
  const r = P.detecterRecurrences(operations, { depuis: "2026-11-15" });
  const props = liste(r.propositions);
  assert.equal(props.length, 4);
  assert.equal(props[0].libelle, "Salaire acme");
  assert.equal(props[0].type, "revenu");
  assert.equal(props[0].montant, 2450);
  assert.equal(props[0].frequence, "mensuel");
  assert.equal(props[0].debut, "2026-12-01");
  const loyer = props.find((x) => x.libelle.startsWith("Loyer"));
  assert.equal(loyer.montant, 780);
  assert.equal(loyer.type, "depense");
});

test("un montant qui varie donne la médiane, et sa dispersion", () => {
  const a = P.analyserCsv(RELEVE);
  const { operations } = P.operationsCsv(a, a);
  const courses = liste(P.detecterRecurrences(operations, { depuis: "2026-11-15" }).propositions)
    .find((x) => x.libelle.startsWith("Monoprix"));
  assert.equal(courses.montant, 62.3);      // médiane de 62,30 / 58,10 / 71,40
  assert.ok(courses.dispersion > 0);
  assert.equal(courses.nombre, 3);
});

test("ce qui ne se répète pas devient une enveloppe de dépenses variables", () => {
  const lignes = ["Date;Libelle;Montant"];
  // trois mois de loyer réguliers, et sept sorties uniques
  for (const m of ["09", "10", "11"]) lignes.push("03/" + m + "/2026;PRLV LOYER;-780,00");
  const uniques = [["04/09/2026", "RESTAURANT LE BEC", 45], ["11/09/2026", "FNAC", 89],
    ["19/09/2026", "GARAGE MARTIN", 210], ["02/10/2026", "CINEMA UGC", 24],
    ["14/10/2026", "PHARMACIE CENTRALE", 32], ["27/10/2026", "DECATHLON", 76],
    ["09/11/2026", "COIFFEUR", 38]];
  for (const [d, l, m] of uniques) lignes.push(d + ";" + l + ";-" + m + ",00");
  const a = P.analyserCsv(lignes.join("\n"));
  const { operations } = P.operationsCsv(a, a);
  const r = P.detecterRecurrences(operations, { depuis: "2026-11-15" });
  assert.equal(liste(r.propositions).length, 1);
  assert.equal(r.variables.nombre, 7);
  assert.equal(r.variables.total, 514);
  assert.ok(r.variables.montant > 150 && r.variables.montant < 250, r.variables.montant);
  assert.equal(r.variables.frequence, "mensuel");
});

test("sans assez d'opérations isolées, aucune enveloppe n'est proposée", () => {
  const a = P.analyserCsv("Date;Libelle;Montant\n01/09/2026;UNIQUE;-10,00\n02/09/2026;AUTRE;-20,00");
  const { operations } = P.operationsCsv(a, a);
  assert.equal(P.detecterRecurrences(operations, { depuis: "2026-09-30" }).variables, null);
});

test("la médiane résiste à une valeur extrême", () => {
  assert.equal(P.mediane([1, 2, 3, 4, 1000]), 3);
  assert.equal(P.mediane([2, 4]), 3);
  assert.equal(P.mediane([]), 0);
});

test("un commerçant dont la ville change se regroupe au second tour", () => {
  const a = P.analyserCsv(RELEVE);
  const { operations } = P.operationsCsv(a, a);
  const props = liste(P.detecterRecurrences(operations, { depuis: "2026-11-15" }).propositions);
  const courses = props.find((x) => x.libelle.startsWith("Monoprix"));
  assert.equal(courses.libelle, "Monoprix");    // sans la ville
  assert.equal(courses.nombre, 3);
  assert.equal(courses.frequence, "mensuel");
});

test("deux passages à deux mois d'écart ne font pas un bimestriel", () => {
  assert.equal(P.detecterRythme(["2026-01-05", "2026-03-06"]), null);
  assert.equal(P.detecterRythme(["2026-01-05", "2026-03-06", "2026-05-05"]).frequence, "bimestriel");
});

test("une colonne de solde courant n'est pas prise pour la colonne montant", () => {
  const a = P.analyserCsv([
    "Date;Libelle;Montant;Solde",
    "01/09/2026;SALAIRE;2450,00;3450,00",
    "03/09/2026;LOYER;-780,00;2670,00",
    "05/09/2026;COURSES;-62,30;2607,70",
    "08/09/2026;EDF;-118,00;2489,70",
  ].join("\n"));
  assert.equal(a.colonneMontant, 2);
  const { operations } = P.operationsCsv(a, a);
  assert.equal(liste(operations)[0].montant, 2450);
  assert.equal(liste(operations)[1].montant, -780);
});

test("un relevé sans en-tête et au format américain reste lisible", () => {
  const a = P.analyserCsv([
    "2026-09-01,ACME PAYROLL,2450.00",
    "2026-09-03,RENT PAYMENT,-780.00",
    "2026-10-01,ACME PAYROLL,2450.00",
    "2026-10-03,RENT PAYMENT,-780.00",
    "2026-11-01,ACME PAYROLL,2450.00",
    "2026-11-03,RENT PAYMENT,-780.00",
  ].join("\n"));
  const { operations, ignorees } = P.operationsCsv(a, a);
  assert.equal(ignorees, 0);
  const props = liste(P.detecterRecurrences(operations, { depuis: "2026-11-15" }).propositions);
  assert.equal(props.length, 2);
  assert.equal(props[0].type, "revenu");
  assert.equal(props[0].frequence, "mensuel");
});

test("une colonne crédit presque vide reste reconnue comme telle", () => {
  // six salaires pour quarante prélèvements : la colonne crédit est rare,
  // mais c'est bien une colonne de montants
  const lignes = ["Date;Libelle;Debit;Credit"];
  for (let m = 4; m <= 9; m++) {
    const mm = String(m).padStart(2, "0");
    lignes.push(`01/${mm}/2026;VIR SALAIRE;;2450,00`);
    for (let j = 3; j <= 9; j++) lignes.push(`0${j}/${mm}/2026;PRLV CHARGE ${j};${j * 10},00;`);
  }
  const a = P.analyserCsv(lignes.join("\n"));
  assert.equal(a.colonneDebit, 2);
  assert.equal(a.colonneCredit, 3);
  const { operations } = P.operationsCsv(a, a);
  const ops = liste(operations);
  assert.equal(ops.filter((o) => o.montant > 0).length, 6);
  assert.equal(ops.filter((o) => o.montant < 0).length, 42);
});
