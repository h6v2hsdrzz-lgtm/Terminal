#!/usr/bin/env node
/*
 * pronostic/tickets.mjs — évaluation des deux combinés réels (tickets.json)
 *
 * Croise les deux modèles (petite finale + finale) pour pricer chaque jambe,
 * chaque ticket, puis le portefeuille complet — annulation de la jambe
 * « buteur » comprise (joueur non aligné ⇒ cote ramenée à 1,00).
 *
 * Usage :  node pronostic/tickets.mjs [--fast] [--seed N] [--json]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { predict } from "./model.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA_FILES = { finale: "data.json", petite: "data-petite.json" };

// --------------------------------------------------------------------------
// Cœur réutilisable (testé par test.mjs)
// --------------------------------------------------------------------------

// Probabilité d'une jambe : { p, pVoid } — p = jambe gagnée, pVoid = jambe
// annulée (cote 1,00), le reste = jambe perdue.
export function legProbability(prediction, leg) {
  if (leg.type === "resultat90") {
    return { p: prediction.mc.p90[leg.side], pVoid: 0 };
  }
  if (leg.type === "buteurEtGagne") {
    const sc = prediction.scorers[leg.side];
    if (!sc) throw new Error(`starScorer manquant pour la jambe « ${leg.label} »`);
    return { p: sc.playProbability * sc.pScoresAndWin90, pVoid: 1 - sc.playProbability };
  }
  throw new Error(`type de jambe inconnu : ${leg.type}`);
}

// Évalue un combiné : énumère gagné/annulé/perdu pour chaque jambe.
// legs = [{ p, pVoid, odds }] → { pFullWin, pAnyPayout, expReturn, scenarios }
export function evaluateTicket(legs, stake) {
  const scenarios = [];
  const n = legs.length;
  const walk = (i, prob, payoutOdds, nWon, nVoid) => {
    if (prob <= 0) return;
    if (i === n) {
      const payout = nWon + nVoid === n ? stake * payoutOdds : 0;
      scenarios.push({ prob, payout, nWon, nVoid });
      return;
    }
    const { p, pVoid, odds } = legs[i];
    walk(i + 1, prob * p, payoutOdds * odds, nWon + 1, nVoid);          // gagnée
    if (pVoid > 0) walk(i + 1, prob * pVoid, payoutOdds, nWon, nVoid + 1); // annulée
    walk(i + 1, prob * (1 - p - pVoid), payoutOdds, nWon, nVoid);       // perdue
  };
  walk(0, 1, 1, 0, 0);
  const pFullWin = scenarios.filter((s) => s.nWon === n).reduce((a, s) => a + s.prob, 0);
  const pAnyPayout = scenarios.filter((s) => s.payout > 0).reduce((a, s) => a + s.prob, 0);
  const expReturn = scenarios.reduce((a, s) => a + s.prob * s.payout, 0);
  return { pFullWin, pAnyPayout, expReturn, scenarios };
}

/*
 * Portefeuille joint des deux tickets : les jambes « France gagne » et
 * « Mbappé marque et la France gagne » portent sur le MÊME match — on énumère
 * donc les atomes joints de la petite finale plutôt que de supposer les
 * tickets indépendants. Approximation assumée : la probabilité de victoire
 * française est prise identique avec ou sans Mbappé (légèrement optimiste
 * pour le scénario « annulation »).
 */
export function portfolioJoint({ petite, finale, tickets }) {
  const sc = petite.scorers.a;
  const pi = sc.playProbability;
  const pW = petite.mc.p90.a;
  const pSW = sc.pScoresAndWin90;
  const pArg = finale.mc.p90.b;

  const [t2, t1] = [tickets[0], tickets[1]]; // t2 = 6GIUU93K, t1 = 6GIVMJZR
  const pay2 = t2.stake * t2.legs[0].odds * t2.legs[1].odds;
  const pay1Full = t1.stake * t1.legs[0].odds * t1.legs[1].odds;
  const pay1Void = t1.stake * t1.legs[1].odds; // jambe Mbappé annulée

  const atoms = [
    { label: "Mbappé joue, marque, la France gagne", p: pi * pSW, t1: pay1Full, t2: pay2 },
    { label: "La France gagne sans but de Mbappé", p: pi * (pW - pSW), t1: 0, t2: pay2 },
    { label: "Mbappé joue, la France ne gagne pas", p: pi * (1 - pW), t1: 0, t2: 0 },
    { label: "Mbappé forfait, la France gagne", p: (1 - pi) * pW, t1: pay1Void, t2: pay2 },
    { label: "Mbappé forfait, la France ne gagne pas", p: (1 - pi) * (1 - pW), t1: pay1Void, t2: 0 },
  ];

  const scenarios = [];
  for (const a of atoms) {
    scenarios.push({ label: `${a.label} · Argentine gagne à 90'`, prob: a.p * pArg, total: a.t1 + a.t2 });
    scenarios.push({ label: `${a.label} · l'Argentine ne gagne pas à 90'`, prob: a.p * (1 - pArg), total: 0 });
  }
  const merged = scenarios.filter((s) => s.total > 0).sort((x, y) => y.total - x.total);
  const pNothing = 1 - merged.reduce((a, s) => a + s.prob, 0);
  const expTotal = scenarios.reduce((a, s) => a + s.prob * s.total, 0);
  return { scenarios: merged, pNothing, expTotal, pArg, pW, pSW, pi };
}

// --------------------------------------------------------------------------
// Exécutable
// --------------------------------------------------------------------------

export function run(argv = process.argv.slice(2)) {
  const has = (f) => argv.includes(f);
  const numArg = (f, dflt) => {
    const i = argv.indexOf(f);
    const v = i !== -1 ? Number(argv[i + 1]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };
  const opts = {
    nBatches: has("--fast") ? 32 : 64,
    simsPerBatch: has("--fast") ? 1000 : 4000,
    seed: Math.round(numArg("--seed", 20260719)),
  };

  const book = JSON.parse(readFileSync(join(DIR, "tickets.json"), "utf8"));
  const predictions = {};
  for (const key of ["petite", "finale"])
    predictions[key] = predict(JSON.parse(readFileSync(join(DIR, DATA_FILES[key]), "utf8")), opts);

  const evaluated = book.tickets.map((t) => {
    const legs = t.legs.map((leg) => ({ ...leg, ...legProbability(predictions[leg.match], leg) }));
    return { ...t, legs, ...evaluateTicket(legs, t.stake) };
  });
  const joint = portfolioJoint({
    petite: predictions.petite,
    finale: predictions.finale,
    tickets: book.tickets,
  });
  return { book, predictions, evaluated, joint, opts };
}

function main() {
  const argv = process.argv.slice(2);
  const { book, evaluated, joint } = run(argv);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ evaluated, joint }, null, 2));
    return;
  }

  const tty = process.stdout.isTTY;
  const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const gold = (s) => c("38;5;178", s);
  const dim = (s) => c("2", s);
  const bold = (s) => c("1", s);
  const line = (ch = "─") => dim(ch.repeat(74));
  const pct = (p, d = 1) => `${(100 * p).toFixed(d)} %`;
  const eur = (x) => `${x.toFixed(2).replace(".", ",")} €`;

  console.log();
  console.log(line("═"));
  console.log(bold(gold("  ÉVALUATION DES TICKETS — modèles finale + petite finale croisés")));
  console.log(line("═"));

  let totalStake = 0, totalExp = 0;
  for (const t of evaluated) {
    totalStake += t.stake;
    totalExp += t.expReturn;
    console.log(bold(`\n  Ticket ${t.ref}`) + dim(`  · mise ${eur(t.stake)} · cote ${t.totalOdds.toFixed(2)} · gain potentiel ${eur(t.potentialWin)}`));
    console.log(line());
    for (const leg of t.legs) {
      const implied = 1 / leg.odds;
      const value = leg.p * leg.odds;
      console.log(`  ${leg.label}`);
      console.log(dim(`    modèle ${pct(leg.p)}${leg.pVoid > 0 ? ` (+${pct(leg.pVoid, 0)} annulation)` : ""} · bookmaker ${pct(implied)} (cote ${leg.odds.toFixed(2)}) · valeur ${value.toFixed(2)}`));
    }
    console.log(`  → Combiné gagné : ${bold(pct(t.pFullWin))}` +
      (t.pAnyPayout > t.pFullWin + 1e-9 ? `  (un paiement quelconque : ${pct(t.pAnyPayout)})` : ""));
    console.log(`  → Espérance de retour : ${bold(eur(t.expReturn))} pour ${eur(t.stake)} misés` +
      dim(`  (${(100 * (t.expReturn / t.stake - 1)).toFixed(0)} %)`));
    console.log(`  → Cashout proposé : ${bold(eur(t.cashoutOffer))} — ` +
      (t.cashoutOffer > t.expReturn ? gold("supérieur à l'espérance du modèle") : "inférieur à l'espérance du modèle"));
  }

  console.log(bold("\n  PORTEFEUILLE (corrélations entre tickets prises en compte)"));
  console.log(line());
  for (const s of joint.scenarios)
    console.log(`  ${pct(s.prob).padStart(7)}  ${dim("→")} ${bold(eur(s.total))}  ${dim(s.label)}`);
  console.log(`  ${pct(joint.pNothing).padStart(7)}  ${dim("→")} ${bold("0,00 €")}  ${dim("tous les autres scénarios (tickets perdus)")}`);
  console.log(`\n  Mise totale : ${bold(eur(totalStake))} · espérance totale : ${bold(eur(joint.expTotal))} ` +
    dim(`(net ${eur(joint.expTotal - totalStake)})`));
  console.log(`  Cashout total proposé : ${bold(eur(book.totalCashoutOffer))} — ` +
    (book.totalCashoutOffer > joint.expTotal
      ? gold("mathématiquement meilleur que de laisser courir (selon ce modèle)")
      : "inférieur à l'espérance du modèle"));
  console.log(dim(`\n  Rappel : jambe « Résultat » = 90 minutes. Une Argentine titrée en prolongation`));
  console.log(dim(`  ou aux t.a.b. fait PERDRE les deux tickets. Point de bascule : samedi soir`));
  console.log(dim(`  après France-Angleterre — si la jambe passe, recomparer cashout et maintien.`));
  console.log(line("═"));
  console.log();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
