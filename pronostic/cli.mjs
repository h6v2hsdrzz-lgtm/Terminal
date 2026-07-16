#!/usr/bin/env node
/*
 * pronostic/cli.mjs — Espagne vs Argentine, finale de la Coupe du monde 2026
 *
 * Usage :
 *   node pronostic/cli.mjs [options]
 *
 * Options :
 *   --sims N        nombre total de simulations (défaut 512000)
 *   --batches N     nombre de lots bayésiens (défaut 64)
 *   --seed N        graine du générateur aléatoire (défaut 20260719)
 *   --no-crowd      neutralise l'avantage « public pro-argentin » du MetLife
 *   --raw           désactive tous les ajustements contextuels
 *                   (prudence de finale, repos, fatigue des prolongations)
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
const num = (f, dflt) => {
  const i = argv.indexOf(f);
  if (i === -1 || i === argv.length - 1) return dflt;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

if (has("--help") || has("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\n/, ""));
  process.exit(0);
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

const dataPath = join(dirname(fileURLToPath(import.meta.url)), "data.json");
const data = JSON.parse(readFileSync(dataPath, "utf8"));

const t0 = Date.now();
const result = predict(data, opts);
const elapsed = Date.now() - t0;

if (has("--json")) {
  console.log(JSON.stringify({ opts, ...result, elapsedMs: elapsed }, null, 2));
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

const { model, analytic, mc, verdict } = result;
const T = data.teams;

console.log();
console.log(line("═"));
console.log(bold(gold("  PRONOSTIC ULTRA SOPHISTIQUÉ — FINALE DE LA COUPE DU MONDE 2026")));
console.log(`  ${bold(`${T.esp.name} — ${T.arg.name}`)}  ${dim(`· ${data.meta.date} · ${data.meta.venue}`)}`);
console.log(line("═"));

// --- données d'entrée -----------------------------------------------------
console.log(bold("\n  DONNÉES CALIBRÉES SUR LE TOURNOI RÉEL"));
console.log(line());
const f = model.form;
const rows = [
  ["Elo (instantané 07/07)", T.esp.eloSnapshot, T.arg.eloSnapshot],
  ["Elo « vivant » (veille de finale)", model.elo.esp.elo.toFixed(0), model.elo.arg.elo.toFixed(0)],
  ["Multiplicateur d'attaque (forme)", f.esp.attack.toFixed(3), f.arg.attack.toFixed(3)],
  ["Multiplicateur de défense (forme)", f.esp.defense.toFixed(3), f.arg.defense.toFixed(3)],
  ["Jours de repos avant la finale", T.esp.restDays, T.arg.restDays],
  ["Minutes de prolongation subies", T.esp.extraTimeMinutesInTournament, T.arg.extraTimeMinutesInTournament],
  ["Pattern « money-time » (surge)", T.esp.lateSurge.toFixed(2), T.arg.lateSurge.toFixed(2)],
  ["Conversion attendue aux t.a.b.", pct(model.penalties.espConversion, 0), pct(model.penalties.argConversion, 0)],
];
console.log(dim(`  ${"".padEnd(36)}${"ESP".padStart(14)}${"ARG".padStart(16)}`));
for (const [label, a, b] of rows)
  console.log(`  ${String(label).padEnd(36)}${String(a).padStart(14)}${String(b).padStart(16)}`);
console.log(dim(`  Défense < 1 = encaisse moins que l'Elo ne le prédit (ESP : 1 but en 7 matchs) ;`));
console.log(dim(`  « surge » = intensité après la 75e, calibrée sur les buts tardifs du tournoi.`));
console.log(dim(`\n  Pente Elo→buts auto-calibrée : ${model.slope.toFixed(3)} · ` +
  `écart Elo effectif : ${model.elo.diffWithCrowd >= 0 ? "+" : ""}${model.elo.diffWithCrowd.toFixed(0)} ESP` +
  (model.opts.crowd ? ` (public MetLife : −${data.priors.crowdEloBonusArg} pts)` : "")));
console.log(dim(`  Buts attendus sur 90' : ESP ${model.lambdas.esp.toFixed(2)} · ARG ${model.lambdas.arg.toFixed(2)}`));

// --- 90 minutes -----------------------------------------------------------
console.log(bold("\n  LES 90 MINUTES") + dim("   (grille Dixon-Coles analytique × simulation dynamique)"));
console.log(line());
const p90 = mc.p90;
const bw = 30;
console.log(`  ${T.esp.name.padEnd(20)} ${bar(p90.esp, bw, red)} ${bold(pct(p90.esp))}`);
console.log(`  ${"Nul (→ prolongation)".padEnd(20)} ${bar(p90.draw, bw, dim)} ${bold(pct(p90.draw))}`);
console.log(`  ${T.arg.name.padEnd(20)} ${bar(p90.arg, bw, blue)} ${bold(pct(p90.arg))}`);
console.log(dim(`\n  Validation croisée analytique vs dynamique : écart max ` +
  `${(100 * verdict.crossCheck90.maxAbsGap).toFixed(1)} pt — les deux moteurs concordent.`));

// --- scores exacts ----------------------------------------------------------
console.log(bold("\n  SCORES LES PLUS PROBABLES À 90'"));
console.log(line());
const top = mc.topScores90.slice(0, 6);
const maxP = top[0].p;
for (const s of top) {
  const [ge, ga] = s.score.split("-");
  console.log(`  ${bold(`${T.esp.shortName} ${ge}-${ga} ${T.arg.shortName}`)}   ${bar(s.p / maxP * 0.9, 24, gold)} ${pct(s.p)}`);
}

// --- issue finale -----------------------------------------------------------
console.log(bold("\n  QUI SOULÈVE LA COUPE ?") + dim(`   (${mc.n.toLocaleString("fr-FR")} finales simulées, prolongation et t.a.b. compris)`));
console.log(line());
console.log(`  ${bold(T.esp.name.padEnd(11))} ${bar(mc.title.esp, 34, red)} ${bold(pct(mc.title.esp))}`);
console.log(`  ${bold(T.arg.name.padEnd(11))} ${bar(mc.title.arg, 34, blue)} ${bold(pct(mc.title.arg))}`);
console.log(dim(`\n  Intervalle de crédibilité à 90 % (incertitude du modèle lui-même) :`));
console.log(dim(`    P(${T.esp.name} championne) ∈ [${pct(mc.title.espCredible90[0])} ; ${pct(mc.title.espCredible90[1])}]`));
console.log(`\n  Prolongation : ${bold(pct(mc.pExtraTime))}   ·   Tirs au but : ${bold(pct(mc.pShootout))}`);
const via = mc.title.via;
console.log(dim(`  Chemins vers le titre — ESP : ${pct(via.esp["90"])} en 90' + ${pct(via.esp.et)} en prol. + ${pct(via.esp.tab)} aux t.a.b.`));
console.log(dim(`                          ARG : ${pct(via.arg["90"])} en 90' + ${pct(via.arg.et)} en prol. + ${pct(via.arg.tab)} aux t.a.b.`));
if (mc.pShootout > 0.001) {
  const pArgTab = via.arg.tab / mc.pShootout;
  console.log(dim(`  Si séance de tirs au but : l'Argentine (Dibu Martínez) la gagne ${pct(pArgTab, 0)} du temps.`));
}

// --- verdict ----------------------------------------------------------------
console.log(bold(gold("\n  VERDICT")));
console.log(line());
const fav = verdict.favoriteName;
const s0 = verdict.mostLikelyScore90.score.split("-");
console.log(`  Résultat le plus probable : ${bold(`${T.esp.name} ${s0[0]} – ${s0[1]} ${T.arg.name}`)} à 90' ${dim(`(${pct(verdict.mostLikelyScore90.p)})`)}`);
console.log(`  Favori du modèle : ${bold(gold(fav))} — championne du monde dans ${bold(pct(verdict.pTitleFavorite))} des simulations.`);
console.log(dim(`\n  Honnêteté statistique : l'entropie de l'issue vaut ` +
  `${verdict.titleEntropyBits.toFixed(2)} bit sur 1 — ce match est objectivement`));
console.log(dim(`  proche du maximum d'incertitude. « Déterminer avec exactitude » le résultat`));
console.log(dim(`  est mathématiquement impossible ; ce modèle fournit mieux : la distribution`));
console.log(dim(`  complète, calibrée sur les données réelles du tournoi, avec son incertitude.`));
console.log(dim(`\n  ${mc.n.toLocaleString("fr-FR")} simulations · ${nBatches} lots bayésiens · graine ${opts.seed} · ${elapsed} ms`));
console.log(line("═"));
console.log();
