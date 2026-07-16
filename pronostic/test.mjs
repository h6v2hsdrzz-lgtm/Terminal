/*
 * pronostic/test.mjs — tests d'invariants du moteur de prédiction
 *
 * Lancement :  node pronostic/test.mjs   (ou : node --test pronostic/)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mulberry32, deriveSeed, eloWinExpectancy, eloMarginMultiplier, eloUpdate,
  poissonPmfArray, lambdasFromElo, calibrateEloSlope, dixonColesGrid,
  scorerMarket, tempoProfile, simulateShootout, predict, entropyBits,
} from "./model.mjs";
import { legProbability, evaluateTicket } from "./tickets.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const finaleData = JSON.parse(readFileSync(join(DIR, "data.json"), "utf8"));
const petiteData = JSON.parse(readFileSync(join(DIR, "data-petite.json"), "utf8"));

const FAST = { nBatches: 16, simsPerBatch: 2000, seed: 42 };

// Jeu de données synthétique : deux équipes parfaitement identiques.
function symmetricData() {
  const d = structuredClone(finaleData);
  const matches = [
    { stage: "m1", date: "2026-07-01", opponent: "X", oppElo: 1900, gf: 2, ga: 1, aet: false, postSnapshot: false },
    { stage: "m2", date: "2026-07-05", opponent: "Y", oppElo: 1950, gf: 1, ga: 1, aet: false, postSnapshot: false },
    { stage: "m3", date: "2026-07-10", opponent: "Z", oppElo: 2000, gf: 2, ga: 0, aet: false, postSnapshot: true },
  ];
  for (const k of ["a", "b"]) {
    d.teams[k].eloSnapshot = 2100;
    d.teams[k].restDays = 4;
    d.teams[k].extraTimeMinutesInTournament = 0;
    d.teams[k].lateSurge = 1.15;
    d.teams[k].penalties = { kickerConversion: 0.75, gkSaveEdge: 0.03 };
    delete d.teams[k].starScorer;
    d.matches[k] = structuredClone(matches);
  }
  d.priors.crowdEloBonusB = 0;
  return d;
}

test("le générateur seedé est déterministe et à peu près uniforme", () => {
  const a = mulberry32(123), b = mulberry32(123);
  let sum = 0;
  for (let i = 0; i < 10000; i++) {
    const va = a();
    assert.equal(va, b());
    assert.ok(va >= 0 && va < 1);
    sum += va;
  }
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02);
  assert.notEqual(deriveSeed(1, 0), deriveSeed(1, 1));
});

test("barème Elo : espérance, marge, mise à jour", () => {
  assert.ok(Math.abs(eloWinExpectancy(0) - 0.5) < 1e-12);
  assert.ok(Math.abs(eloWinExpectancy(400) - 10 / 11) < 1e-9);
  assert.equal(eloMarginMultiplier(1), 1);
  assert.equal(eloMarginMultiplier(2), 1.5);
  assert.equal(eloMarginMultiplier(3), 14 / 8);
  // victoire → gain ; nul contre plus faible → perte
  assert.ok(eloUpdate(2100, 2000, 2, 0, 60) > 2100);
  assert.ok(eloUpdate(2100, 2000, 1, 1, 60) < 2100);
  // gain symétrique : ce que l'un gagne à Elo égal, l'autre le perd
  const gain = eloUpdate(2000, 2000, 1, 0, 60) - 2000;
  const loss = 2000 - eloUpdate(2000, 2000, 0, 1, 60);
  assert.ok(Math.abs(gain - loss) < 1e-9);
});

test("la pente Elo→buts auto-calibrée reproduit l'espérance Elo", () => {
  const total = finaleData.priors.baseGoalsPerMatch;
  const slope = calibrateEloSlope(total);
  assert.ok(slope > 0.4 && slope < 2.0, `pente hors plage : ${slope}`);
  // à ΔElo = 0, les deux λ sont égaux et somment au total
  const [l1, l2] = lambdasFromElo(total, 0, slope);
  assert.ok(Math.abs(l1 - l2) < 1e-12);
  assert.ok(Math.abs(l1 + l2 - total) < 1e-9);
  // monotonie : plus l'écart Elo grandit, plus λ1 grandit et λ2 diminue
  const [h1, h2] = lambdasFromElo(total, 300, slope);
  assert.ok(h1 > l1 && h2 < l2);
});

test("grille Dixon-Coles : normalisée, et rho<0 gonfle 0-0 / 1-1", () => {
  const l1 = 1.4, l2 = 0.9;
  const dc = dixonColesGrid(l1, l2, -0.1);
  const plain = dixonColesGrid(l1, l2, 0);
  let sum = 0;
  for (const row of dc.grid) for (const p of row) { sum += p; assert.ok(p >= 0); }
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(Math.abs(dc.pHome + dc.pDraw + dc.pAway - 1) < 1e-9);
  assert.ok(dc.grid[0][0] > plain.grid[0][0], "0-0 doit être plus probable avec rho<0");
  assert.ok(dc.grid[1][1] > plain.grid[1][1], "1-1 doit être plus probable avec rho<0");
  assert.ok(dc.grid[1][0] < plain.grid[1][0], "1-0 doit être moins probable avec rho<0");
  // les marginales restent proches de Poisson
  const marg0 = dc.grid[0].reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(marg0 - poissonPmfArray(l1, 12)[0]) < 0.02);
});

test("marché buteur : amincissement de Poisson cohérent", () => {
  const dc = dixonColesGrid(1.5, 1.0, -0.1);
  // part nulle → jamais buteur ; part totale → P(équipe marque ≥ 1)
  assert.equal(scorerMarket(dc, "a", 0).pScores, 0);
  const full = scorerMarket(dc, "a", 1);
  const pTeamScores = 1 - dc.grid[0].reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(full.pScores - pTeamScores) < 1e-9);
  // monotonie en la part de buts
  const s30 = scorerMarket(dc, "a", 0.3), s60 = scorerMarket(dc, "a", 0.6);
  assert.ok(s60.pScores > s30.pScores);
  // conjonction ≤ chaque marginale
  assert.ok(s60.pScoresAndWin <= Math.min(s60.pScores, s60.pWin) + 1e-12);
  // symétrie des côtés : side b avec grille transposée ≈ side a
  const dcT = dixonColesGrid(1.0, 1.5, -0.1);
  assert.ok(Math.abs(scorerMarket(dcT, "b", 0.5).pScoresAndWin - scorerMarket(dc, "a", 0.5).pScoresAndWin) < 1e-9);
});

test("profil de tempo : masse totale conservée (90' et 30')", () => {
  const { reg, et } = tempoProfile();
  assert.ok(Math.abs(reg.reduce((a, b) => a + b, 0) - 90) < 1e-9);
  assert.ok(Math.abs(et.reduce((a, b) => a + b, 0) - 30) < 1e-9);
  assert.ok(reg[89] > reg[0], "l'intensité doit croître au fil du match");
});

test("tirs au but : bornes, avantage au meilleur tireur, équité", () => {
  const n = 20000;
  let rng = mulberry32(7);
  let wins = 0;
  for (let i = 0; i < n; i++) if (simulateShootout(rng, 0.69, 0.76) === "b") wins++;
  const pB = wins / n;
  assert.ok(pB > 0.5 && pB < 0.75, `avantage t.a.b. implausible : ${pB}`);
  // équité parfaite quand les conversions sont égales
  rng = mulberry32(8);
  wins = 0;
  for (let i = 0; i < n; i++) if (simulateShootout(rng, 0.75, 0.75) === "b") wins++;
  assert.ok(Math.abs(wins / n - 0.5) < 0.02);
});

test("équipes parfaitement symétriques → pièce équilibrée", () => {
  const r = predict(symmetricData(), { ...FAST, crowd: false, simsPerBatch: 6000 });
  assert.ok(Math.abs(r.mc.title.a - 0.5) < 0.02, `P(a)=${r.mc.title.a}`);
  assert.ok(Math.abs(r.analytic.pHome - r.analytic.pAway) < 1e-9);
  assert.ok(Math.abs(r.mc.expGoals90.a - r.mc.expGoals90.b) < 0.05);
});

test("prédiction complète (finale) : lois de probabilité cohérentes", () => {
  const r = predict(finaleData, FAST);
  const { mc, verdict } = r;
  // partitions
  assert.ok(Math.abs(mc.title.a + mc.title.b - 1) < 1e-9);
  assert.ok(Math.abs(mc.p90.a + mc.p90.draw + mc.p90.b - 1) < 1e-9);
  const viaSum = mc.title.via.a["90"] + mc.title.via.a.et + mc.title.via.a.tab +
    mc.title.via.b["90"] + mc.title.via.b.et + mc.title.via.b.tab;
  assert.ok(Math.abs(viaSum - 1) < 1e-9);
  // un nul à 90' déclenche exactement une prolongation
  assert.ok(Math.abs(mc.pExtraTime - mc.p90.draw) < 1e-12);
  assert.ok(mc.pShootout <= mc.pExtraTime);
  // les victoires en 90' de la simulation sont celles du décompte 1X2
  assert.ok(Math.abs(mc.title.via.a["90"] - mc.p90.a) < 1e-12);
  // grille analytique et simulation dynamique doivent concorder (< 4 pts)
  assert.ok(verdict.crossCheck90.maxAbsGap < 0.04,
    `écart analytique/dynamique trop grand : ${verdict.crossCheck90.maxAbsGap}`);
  // intervalle de crédibilité ordonné et contenant la moyenne
  const [lo, hi] = mc.title.aCredible90;
  assert.ok(lo <= mc.title.a && mc.title.a <= hi);
  // marché Messi présent et borné
  assert.ok(r.scorers.b && r.scorers.b.pScoresAndWin90 > 0 && r.scorers.b.pScoresAndWin90 < mc.p90.b);
  // reproductibilité stricte à graine égale
  const r2 = predict(finaleData, FAST);
  assert.equal(r2.mc.title.a, mc.title.a);
  // entropie d'une pièce équilibrée = 1 bit
  assert.ok(Math.abs(entropyBits([0.5, 0.5]) - 1) < 1e-12);
});

test("petite finale : France favorite modérée, marché Mbappé cohérent", () => {
  const r = predict(petiteData, FAST);
  // favorite, mais dans un match ouvert : jamais écrasante
  assert.ok(r.mc.title.a > 0.5 && r.mc.title.a < 0.75, `P(FRA)=${r.mc.title.a}`);
  // petite finale plus ouverte que la finale : plus de buts attendus
  const rf = predict(finaleData, FAST);
  assert.ok(r.model.lambdas.total > rf.model.lambdas.total);
  // Mbappé : marque-et-gagne < marque < 1 ; et < P(France gagne 90')
  const sc = r.scorers.a;
  assert.ok(sc.pScoresAndWin90 < sc.pScores90 && sc.pScores90 < 1);
  assert.ok(sc.pScoresAndWin90 < r.mc.p90.a);
});

test("évaluateur de tickets : scénarios exhaustifs, annulation comprise", () => {
  // deux jambes sûres → gain certain au produit des cotes
  const sure = evaluateTicket([{ p: 1, pVoid: 0, odds: 2 }, { p: 1, pVoid: 0, odds: 3 }], 10);
  assert.ok(Math.abs(sure.pFullWin - 1) < 1e-12);
  assert.ok(Math.abs(sure.expReturn - 60) < 1e-9);
  // combiné indépendant simple : 0,5 × 0,4
  const combo = evaluateTicket([{ p: 0.5, pVoid: 0, odds: 2 }, { p: 0.4, pVoid: 0, odds: 3 }], 100);
  assert.ok(Math.abs(combo.pFullWin - 0.2) < 1e-12);
  assert.ok(Math.abs(combo.expReturn - 0.2 * 600) < 1e-9);
  // annulation : jambe void ⇒ payé à la cote restante
  const voided = evaluateTicket([{ p: 0.4, pVoid: 0.1, odds: 2.9 }, { p: 0.5, pVoid: 0, odds: 2 }], 100);
  const expected = 0.4 * 0.5 * 580 + 0.1 * 0.5 * 200;
  assert.ok(Math.abs(voided.expReturn - expected) < 1e-9);
  assert.ok(Math.abs(voided.pAnyPayout - (0.4 * 0.5 + 0.1 * 0.5)) < 1e-12);
  // la masse des scénarios somme à 1
  const mass = voided.scenarios.reduce((a, s) => a + s.prob, 0);
  assert.ok(Math.abs(mass - 1) < 1e-9);
});

test("legProbability branche les marchés sur les bons chiffres du modèle", () => {
  const r = predict(petiteData, FAST);
  const res90 = legProbability(r, { type: "resultat90", side: "a" });
  assert.equal(res90.p, r.mc.p90.a);
  assert.equal(res90.pVoid, 0);
  const buteur = legProbability(r, { type: "buteurEtGagne", side: "a", label: "x" });
  const sc = r.scorers.a;
  assert.ok(Math.abs(buteur.p - sc.playProbability * sc.pScoresAndWin90) < 1e-12);
  assert.ok(Math.abs(buteur.pVoid - (1 - sc.playProbability)) < 1e-12);
  assert.throws(() => legProbability(r, { type: "inconnu", side: "a", label: "x" }));
});

test("le contexte réel penche côté espagnol mais reste incertain", () => {
  const r = predict(finaleData, { ...FAST, simsPerBatch: 4000 });
  // le modèle doit préférer l'Espagne (défense + Elo + repos)…
  assert.ok(r.mc.title.a > 0.5);
  // …sans jamais prétendre à la certitude : c'est le cœur du contrat
  assert.ok(r.mc.title.a < 0.9);
  assert.ok(r.verdict.titleEntropyBits > 0.5);
});
