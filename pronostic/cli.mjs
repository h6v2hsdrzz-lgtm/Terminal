#!/usr/bin/env node
/*
 * pronostic/cli.mjs — pronostics Coupe du monde 2026
 *
 * Usage :
 *   node pronostic/cli.mjs [options]
 *
 * Options :
 *   --match finale|petite   affiche : finale Espagne-Argentine (défaut) ou
 *                           petite finale France-Angleterre
 *   --sims N        nombre total de simulations (défaut 512000)
 *   --batches N     nombre de lots bayésiens (défaut 64)
 *   --seed N        graine du générateur aléatoire (défaut 20260719)
 *   --no-crowd      neutralise le bonus de public
 *   --raw           désactive tous les ajustements contextuels
 *                   (contexte de l'affiche, repos, fatigue des prolongations)
 *   --json          sortie JSON brute (pour scripts)
 *   --fast          mode rapide (64000 simulations)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { predict } from "./model.mjs";

// --------------------------------------------------------------------------
// Arguments
// --------------------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const str = (f, dflt) => {
  const i = argv.indexOf(f);
  return i !== -1 && i < argv.length - 1 ? argv[i + 1] : dflt;
};
const num = (f, dflt) => {
  const v = Number(str(f, NaN));
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

if (has("--help") || has("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\n/, ""));
  process.exit(0);
}

const DATA_FILES = { finale: "data.json", petite: "data-petite.json" };
const matchKey = str("--match", "finale");
if (!DATA_FILES[matchKey]) {
  console.error(`Affiche inconnue : « ${matchKey} » (attendu : ${Object.keys(DATA_FILES).join(" | ")})`);
  process.exit(1);
}

const nBatches = Math.max(8, Math.round(num("--batches", 64)));
const totalSims = has("--fast") ? 64000 : Math.round(num("--sims", 512000));
const simsPerBatch = Math.max(200, Math.round(totalSims / nBatches));
const opts = {
  nBatches,
  simsPerBatch,
  seed: Math.round(num("--seed", 20260719)),
  crowd: !has("--no-crowd"),
  context: !has("--raw"),
};

// --------------------------------------------------------------------------
// Modèle
// --------------------------------------------------------------------------

const dataPath = join(dirname(fileURLToPath(import.meta.url)), DATA_FILES[matchKey]);
const data = JSON.parse(readFileSync(dataPath, "utf8"));

const t0 = Date.now();
const result = predict(data, opts);
const elapsed = Date.now() - t0;

if (has("--json")) {
  console.log(JSON.stringify({ opts, match: matchKey, ...result, elapsedMs: elapsed }, null, 2));
  process.exit(0);
}

// --------------------------------------------------------------------------
// Rendu terminal (thème sombre, accent doré — comme le reste du dépôt)
// --------------------------------------------------------------------------

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const gold = (s) => c("38;5;178", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const red = (s) => c("38;5;167", s);
const blue = (s) => c("38;5;110", s);

const W = 74;
const line = (ch = "─") => dim(ch.repeat(W));
const pct = (p, digits = 1) => `${(100 * p).toFixed(digits)} %`;

function bar(p, width, color) {
  const full = Math.round(p * width);
  return color("█".repeat(full)) + dim("░".repeat(Math.max(0, width - full)));
}

const { model, analytic, mc, scorers, verdict } = result;
const T = data.teams;

console.log();
console.log(line("═"));
console.log(bold(gold(`  PRONOSTIC ULTRA SOPHISTIQUÉ — ${data.meta.competition.toUpperCase()}`)));
console.log(`  ${bold(`${T.a.name} — ${T.b.name}`)}  ${dim(`· ${data.meta.date} · ${data.meta.venue}`)}`);
console.log(line("═"));

// --- données d'entrée -----------------------------------------------------
console.log(bold("\n  DONNÉES CALIBRÉES SUR LE TOURNOI RÉEL"));
console.log(line());
const f = model.form;
const rows = [
  [`Elo (instantané ${T.a.eloSnapshotDate})`, T.a.eloSnapshot, T.b.eloSnapshot],
  ["Elo « vivant » (veille du match)", model.elo.a.elo.toFixed(0), model.elo.b.elo.toFixed(0)],
  ["Multiplicateur d'attaque (forme)", f.a.attack.toFixed(3), f.b.attack.toFixed(3)],
  ["Multiplicateur de défense (forme)", f.a.defense.toFixed(3), f.b.defense.toFixed(3)],
  ["Jours de repos avant le match", T.a.restDays, T.b.restDays],
  ["Minutes de prolongation subies", T.a.extraTimeMinutesInTournament, T.b.extraTimeMinutesInTournament],
  ["Pattern « money-time » (surge)", T.a.lateSurge.toFixed(2), T.b.lateSurge.toFixed(2)],
  ["Conversion attendue aux t.a.b.", pct(model.penalties.aConversion, 0), pct(model.penalties.bConversion, 0)],
];
console.log(dim(`  ${"".padEnd(36)}${T.a.shortName.padStart(14)}${T.b.shortName.padStart(16)}`));
for (const [label, a, b] of rows)
  console.log(`  ${String(label).padEnd(36)}${String(a).padStart(14)}${String(b).padStart(16)}`);
console.log(dim(`  Défense < 1 = encaisse moins que l'Elo adverse ne le prédit ; « surge » =`));
console.log(dim(`  intensité après la 75e, calibrée sur les buts tardifs réels du tournoi.`));
console.log(dim(`\n  Pente Elo→buts auto-calibrée : ${model.slope.toFixed(3)} · ` +
  `écart Elo effectif : ${model.elo.diffWithCrowd >= 0 ? "+" : ""}${model.elo.diffWithCrowd.toFixed(0)} ${T.a.shortName}` +
  (model.opts.crowd && model.elo.crowdBonus !== 0 ? ` (public : −${data.priors.crowdEloBonusB} pts)` : "")));
console.log(dim(`  Buts attendus sur 90' : ${T.a.shortName} ${model.lambdas.a.toFixed(2)} · ${T.b.shortName} ${model.lambdas.b.toFixed(2)}`));

// --- 90 minutes -----------------------------------------------------------
console.log(bold("\n  LES 90 MINUTES") + dim("   (grille Dixon-Coles analytique × simulation dynamique)"));
console.log(line());
const p90 = mc.p90;
const bw = 30;
console.log(`  ${T.a.name.padEnd(20)} ${bar(p90.a, bw, red)} ${bold(pct(p90.a))}`);
console.log(`  ${"Nul (→ prolongation)".padEnd(20)} ${bar(p90.draw, bw, dim)} ${bold(pct(p90.draw))}`);
console.log(`  ${T.b.name.padEnd(20)} ${bar(p90.b, bw, blue)} ${bold(pct(p90.b))}`);
console.log(dim(`\n  Validation croisée analytique vs dynamique : écart max ` +
  `${(100 * verdict.crossCheck90.maxAbsGap).toFixed(1)} pt — les deux moteurs concordent.`));

// --- scores exacts ----------------------------------------------------------
console.log(bold("\n  SCORES LES PLUS PROBABLES À 90'"));
console.log(line());
const top = mc.topScores90.slice(0, 6);
const maxP = top[0].p;
for (const s of top) {
  const [ga, gb] = s.score.split("-");
  console.log(`  ${bold(`${T.a.shortName} ${ga}-${gb} ${T.b.shortName}`)}   ${bar(s.p / maxP * 0.9, 24, gold)} ${pct(s.p)}`);
}

// --- marché buteur vedette ---------------------------------------------------
const scorerSides = Object.keys(scorers);
if (scorerSides.length > 0) {
  console.log(bold("\n  MARCHÉ « BUTEUR VEDETTE »") + dim("   (amincissement de Poisson sur la grille, 90')"));
  console.log(line());
  for (const side of scorerSides) {
    const sc = scorers[side];
    const teamName = T[side].name;
    const pPlayAdj = sc.playProbability * sc.pScoresAndWin90;
    console.log(`  ${bold(sc.name)} ${dim(`(${teamName} · ${pct(sc.goalShare, 0)} des buts de son équipe · joue à ${pct(sc.playProbability, 0)})`)}`);
    console.log(`    Marque (s'il joue)                    ${bold(pct(sc.pScores90))}   ${dim(`cote juste ${(1 / sc.pScores90).toFixed(2)}`)}`);
    console.log(`    Marque ET son équipe gagne à 90'      ${bold(pct(sc.pScoresAndWin90))}   ${dim(`cote juste ${(1 / sc.pScoresAndWin90).toFixed(2)}`)}`);
    console.log(`    Idem, risque de non-titularisation inclus ${bold(pct(pPlayAdj))}   ${dim(`cote juste ${(1 / pPlayAdj).toFixed(2)}`)}`);
  }
}

// --- issue finale -----------------------------------------------------------
console.log(bold(`\n  ${data.meta.questionLabel}`) + dim(`   (${mc.n.toLocaleString("fr-FR")} matchs simulés, prolongation et t.a.b. compris)`));
console.log(line());
console.log(`  ${bold(T.a.name.padEnd(11))} ${bar(mc.title.a, 34, red)} ${bold(pct(mc.title.a))}`);
console.log(`  ${bold(T.b.name.padEnd(11))} ${bar(mc.title.b, 34, blue)} ${bold(pct(mc.title.b))}`);
console.log(dim(`\n  Intervalle de crédibilité à 90 % (incertitude du modèle lui-même) :`));
console.log(dim(`    P(${T.a.name} ${data.meta.outcomeLabel}) ∈ [${pct(mc.title.aCredible90[0])} ; ${pct(mc.title.aCredible90[1])}]`));
console.log(`\n  Prolongation : ${bold(pct(mc.pExtraTime))}   ·   Tirs au but : ${bold(pct(mc.pShootout))}`);
const via = mc.title.via;
console.log(dim(`  Chemins vers la victoire — ${T.a.shortName} : ${pct(via.a["90"])} en 90' + ${pct(via.a.et)} en prol. + ${pct(via.a.tab)} aux t.a.b.`));
console.log(dim(`                             ${T.b.shortName} : ${pct(via.b["90"])} en 90' + ${pct(via.b.et)} en prol. + ${pct(via.b.tab)} aux t.a.b.`));
if (mc.pShootout > 0.001) {
  const tabFav = via.a.tab >= via.b.tab ? "a" : "b";
  console.log(dim(`  Si séance de tirs au but : ${T[tabFav].name} l'emporte ` +
    `${pct(via[tabFav].tab / mc.pShootout, 0)} du temps.`));
}

// --- verdict ----------------------------------------------------------------
console.log(bold(gold("\n  VERDICT")));
console.log(line());
const s0 = verdict.mostLikelyScore90.score.split("-");
console.log(`  Résultat le plus probable : ${bold(`${T.a.name} ${s0[0]} – ${s0[1]} ${T.b.name}`)} à 90' ${dim(`(${pct(verdict.mostLikelyScore90.p)})`)}`);
console.log(`  Favori du modèle : ${bold(gold(verdict.favoriteName))} — ${data.meta.outcomeLabel} dans ${bold(pct(verdict.pTitleFavorite))} des simulations.`);
console.log(dim(`\n  Honnêteté statistique : l'entropie de l'issue vaut ` +
  `${verdict.titleEntropyBits.toFixed(2)} bit sur 1. « Déterminer avec exactitude »`));
console.log(dim(`  le résultat est mathématiquement impossible ; ce modèle fournit mieux : la`));
console.log(dim(`  distribution complète, calibrée sur le tournoi réel, avec son incertitude.`));
console.log(dim(`\n  ${mc.n.toLocaleString("fr-FR")} simulations · ${nBatches} lots bayésiens · graine ${opts.seed} · ${elapsed} ms`));
console.log(line("═"));
console.log();
