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
  tempoProfile, simulateShootout, predict, entropyBits,
} from "./model.mjs";

const dataPath = join(dirname(fileURLToPath(import.meta.url)), "data.json");
const realData = JSON.parse(readFileSync(dataPath, "utf8"));

const FAST = { nBatches: 16, simsPerBatch: 2000, seed: 42 };

// Jeu de données synthétique : deux équipes parfaitement identiques.
function symmetricData() {
  const d = structuredClone(realData);
  const matches = [
    { stage: "m1", date: "2026-07-01", opponent: "X", oppElo: 1900, gf: 2, ga: 1, aet: false, postSnapshot: false },
    { stage: "m2", date: "2026-07-05", opponent: "Y", oppElo: 1950, gf: 1, ga: 1, aet: false, postSnapshot: false },
    { stage: "m3", date: "2026-07-10", opponent: "Z", oppElo: 2000, gf: 2, ga: 0, aet: false, postSnapshot: true },
  ];
  for (const k of ["esp", "arg"]) {
    d.teams[k].eloSnapshot = 2100;
    d.teams[k].restDays = 4;
    d.teams[k].extraTimeMinutesInTournament = 0;
    d.teams[k].lateSurge = 1.15;
    d.teams[k].penalties = { kickerConversion: 0.75, gkSaveEdge: 0.03 };
    d.matches[k] = structuredClone(matches);
  }
  d.priors.crowdEloBonusArg = 0;
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
  const total = realData.priors.baseGoalsPerMatch;
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

test("profil de tempo : masse totale conservée (90' et 30')", () => {
  const { reg, et } = tempoProfile();
  assert.ok(Math.abs(reg.reduce((a, b) => a + b, 0) - 90) < 1e-9);
  assert.ok(Math.abs(et.reduce((a, b) => a + b, 0) - 30) < 1e-9);
  assert.ok(reg[89] > reg[0], "l'intensité doit croître au fil du match");
});

test("tirs au but : bornes, avantage au meilleur tireur, déterminisme", () => {
  const n = 20000;
  let rng = mulberry32(7);
  let wins = 0;
  for (let i = 0; i < n; i++) if (simulateShootout(rng, 0.69, 0.76) === "arg") wins++;
  const pArg = wins / n;
  assert.ok(pArg > 0.5 && pArg < 0.75, `avantage t.a.b. argentin implausible : ${pArg}`);
  // équité parfaite quand les conversions sont égales
  rng = mulberry32(8);
  wins = 0;
  for (let i = 0; i < n; i++) if (simulateShootout(rng, 0.75, 0.75) === "arg") wins++;
  assert.ok(Math.abs(wins / n - 0.5) < 0.02);
});

test("équipes parfaitement symétriques → pièce équilibrée", () => {
  const r = predict(symmetricData(), { ...FAST, crowd: false, simsPerBatch: 6000 });
  assert.ok(Math.abs(r.mc.title.esp - 0.5) < 0.02, `P(esp)=${r.mc.title.esp}`);
  assert.ok(Math.abs(r.analytic.pHome - r.analytic.pAway) < 1e-9);
  assert.ok(Math.abs(r.mc.expGoals90.esp - r.mc.expGoals90.arg) < 0.05);
});

test("prédiction complète : lois de probabilité cohérentes", () => {
  const r = predict(realData, FAST);
  const { mc, analytic, verdict } = r;
  // partitions
  assert.ok(Math.abs(mc.title.esp + mc.title.arg - 1) < 1e-9);
  assert.ok(Math.abs(mc.p90.esp + mc.p90.draw + mc.p90.arg - 1) < 1e-9);
  const viaSum = mc.title.via.esp["90"] + mc.title.via.esp.et + mc.title.via.esp.tab +
    mc.title.via.arg["90"] + mc.title.via.arg.et + mc.title.via.arg.tab;
  assert.ok(Math.abs(viaSum - 1) < 1e-9);
  // un nul à 90' déclenche exactement une prolongation
  assert.ok(Math.abs(mc.pExtraTime - mc.p90.draw) < 1e-12);
  assert.ok(mc.pShootout <= mc.pExtraTime);
  // les victoires en 90' de la simulation sont celles du décompte 1X2
  assert.ok(Math.abs(mc.title.via.esp["90"] - mc.p90.esp) < 1e-12);
  // grille analytique et simulation dynamique doivent concorder (< 4 pts)
  assert.ok(verdict.crossCheck90.maxAbsGap < 0.04,
    `écart analytique/dynamique trop grand : ${verdict.crossCheck90.maxAbsGap}`);
  // intervalle de crédibilité ordonné et contenant la moyenne
  const [lo, hi] = mc.title.espCredible90;
  assert.ok(lo <= mc.title.esp && mc.title.esp <= hi);
  // reproductibilité stricte à graine égale
  const r2 = predict(realData, FAST);
  assert.equal(r2.mc.title.esp, mc.title.esp);
  // entropie d'une pièce équilibrée = 1 bit
  assert.ok(Math.abs(entropyBits([0.5, 0.5]) - 1) < 1e-12);
});

test("le contexte réel penche côté espagnol mais reste incertain", () => {
  const r = predict(realData, { ...FAST, simsPerBatch: 4000 });
  // le modèle doit préférer l'Espagne (défense + Elo + repos)…
  assert.ok(r.mc.title.esp > 0.5);
  // …sans jamais prétendre à la certitude : c'est le cœur du contrat
  assert.ok(r.mc.title.esp < 0.9);
  assert.ok(r.verdict.titleEntropyBits > 0.5);
});
