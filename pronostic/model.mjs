/*
 * pronostic/model.mjs — moteur de prédiction Espagne–Argentine (finale CM 2026)
 *
 * Pipeline en six étages, zéro dépendance :
 *
 *   1. Elo « vivant »        instantané officiel du 07/07 mis à jour match par
 *                            match (barème eloratings : K=60, multiplicateur de
 *                            marge) jusqu'à la veille de la finale.
 *   2. Auto-calibration      la pente Elo→buts est résolue numériquement pour
 *                            que la grille de Poisson reproduise l'espérance de
 *                            gain Elo (aucune constante magique).
 *   3. Forme attaque/défense ratios observé/attendu sur les 7 matchs du
 *                            tournoi, pondérés par récence (demi-vie 4 matchs)
 *                            et rétrécis vers 1 (empirical Bayes).
 *   4. Grille Dixon-Coles    probabilités exactes de chaque score à 90'
 *                            (correction de dépendance aux scores fermés).
 *   5. Monte-Carlo dynamique simulation minute par minute : tempo croissant,
 *                            équipe menée qui pousse, équipe menant qui gère,
 *                            « pattern remontada », prolongation avec fatigue,
 *                            séance de tirs au but tir par tir.
 *   6. Incertitude           les paramètres eux-mêmes sont rééchantillonnés à
 *                            chaque lot (Elo, forme, rho, prudence, t.a.b.) →
 *                            intervalle de crédibilité sur la probabilité de
 *                            titre, pas seulement une moyenne.
 *
 * L'« exactitude » demandée est mathématiquement impossible : un match de
 * football est un processus stochastique. Ce que le modèle fournit de mieux
 * qu'un verdict, c'est la distribution complète et son incertitude.
 */

// ---------------------------------------------------------------------------
// Générateur pseudo-aléatoire seedé (mulberry32) + dérivation de sous-seeds
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed(masterSeed, index) {
  // splitmix32 : sous-seeds décorrélés pour chaque lot de simulation
  let z = (masterSeed + 0x9e3779b9 * (index + 1)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

export function gaussian(rng) {
  // Box-Muller (une valeur par appel, sans cache : simplicité > micro-perf)
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------------------
// Étage 1 — Elo vivant
// ---------------------------------------------------------------------------

export function eloWinExpectancy(dElo) {
  return 1 / (1 + Math.pow(10, -dElo / 400));
}

// Multiplicateur de marge du barème eloratings.net
export function eloMarginMultiplier(goalDiff) {
  const d = Math.abs(goalDiff);
  if (d <= 1) return 1;
  if (d === 2) return 1.5;
  return (11 + d) / 8;
}

export function eloUpdate(elo, oppElo, gf, ga, K) {
  const W = gf > ga ? 1 : gf === ga ? 0.5 : 0;
  const We = eloWinExpectancy(elo - oppElo);
  return elo + K * eloMarginMultiplier(gf - ga) * (W - We);
}

// Rejoue les matchs postérieurs à l'instantané pour obtenir l'Elo à la veille
// de la finale (les scores a.p. comptent tels quels, convention eloratings).
export function liveElo(team, matches, K) {
  let elo = team.eloSnapshot;
  const steps = [];
  for (const m of matches) {
    if (!m.postSnapshot) continue;
    const next = eloUpdate(elo, m.oppElo, m.gf, m.ga, K);
    steps.push({ opponent: m.opponent, score: `${m.gf}-${m.ga}${m.aet ? " a.p." : ""}`, before: elo, after: next });
    elo = next;
  }
  return { elo, steps };
}

// ---------------------------------------------------------------------------
// Étage 2 — correspondance Elo → buts, auto-calibrée
// ---------------------------------------------------------------------------

export function poissonPmfArray(lambda, maxGoals) {
  const p = new Array(maxGoals + 1);
  p[0] = Math.exp(-lambda);
  for (let k = 1; k <= maxGoals; k++) p[k] = (p[k - 1] * lambda) / k;
  return p;
}

// Écart Elo « effectif » : compression tanh des gros écarts (la relation
// exponentielle Elo→buts surestime les cartons contre les équipes faibles ;
// au voisinage de 0 la correction est neutre : tanh(x) ≈ x).
export const effectiveEloDiff = (dElo) => 400 * Math.tanh(dElo / 400);

// λ des deux équipes pour un total attendu T et un écart Elo d :
//   λ1 = T/2 · e^{ a·d̃/400 },  λ2 = T/2 · e^{ −a·d̃/400 }
export function lambdasFromElo(totalGoals, dElo, slope) {
  const x = (slope * effectiveEloDiff(dElo)) / 400;
  return [
    clamp((totalGoals / 2) * Math.exp(x), 0.12, 5.5),
    clamp((totalGoals / 2) * Math.exp(-x), 0.12, 5.5),
  ];
}

// Espérance de gain (victoire + demi-nul) d'une grille de Poisson simple
function poissonWinExpectancy(l1, l2, maxGoals = 12) {
  const p1 = poissonPmfArray(l1, maxGoals);
  const p2 = poissonPmfArray(l2, maxGoals);
  let win = 0, draw = 0;
  for (let x = 0; x <= maxGoals; x++)
    for (let y = 0; y <= maxGoals; y++) {
      const p = p1[x] * p2[y];
      if (x > y) win += p;
      else if (x === y) draw += p;
    }
  return win + 0.5 * draw;
}

// Résout par dichotomie la pente a telle que la grille de Poisson redonne
// l'espérance de gain Elo à ΔElo = 100 (zone pertinente pour cette finale).
export function calibrateEloSlope(totalGoals, refDiff = 100) {
  const target = eloWinExpectancy(refDiff);
  let lo = 0.2, hi = 3.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const [l1, l2] = lambdasFromElo(totalGoals, refDiff, mid);
    if (poissonWinExpectancy(l1, l2) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Étage 3 — forme attaque/défense (observé vs attendu, récence, rétrécissement)
// ---------------------------------------------------------------------------

export function teamForm(team, matches, priors, slope) {
  const H = priors.recencyHalfLifeMatches;
  const n = matches.length;
  let wSum = 0, gfSum = 0, gaSum = 0, expForSum = 0, expAgainstSum = 0;
  const detail = [];
  matches.forEach((m, i) => {
    const w = Math.pow(0.5, (n - 1 - i) / H); // le plus récent pèse 1
    const minutes = m.aet ? 120 : 90;
    const [lFor, lAgainst] = lambdasFromElo(priors.baseGoalsPerMatch, team.eloSnapshot - m.oppElo, slope);
    const scale = minutes / 90; // un match a.p. offre plus de temps pour marquer
    wSum += w;
    gfSum += w * m.gf;
    gaSum += w * m.ga;
    expForSum += w * lFor * scale;
    expAgainstSum += w * lAgainst * scale;
    detail.push({ opponent: m.opponent, weight: w, expFor: lFor * scale, expAgainst: lAgainst * scale, gf: m.gf, ga: m.ga });
  });
  const rawAttack = gfSum / expForSum;
  const rawDefense = gaSum / expAgainstSum; // >1 = encaisse plus qu'attendu
  const kA = priors.formShrinkage.attack;
  const kD = priors.formShrinkage.defense;
  return {
    attack: (kA + wSum * rawAttack) / (kA + wSum),
    defense: (kD + wSum * rawDefense) / (kD + wSum),
    rawAttack, rawDefense, effectiveMatches: wSum, detail,
  };
}

// ---------------------------------------------------------------------------
// Construction du modèle central (paramètres moyens, sans bruit)
// ---------------------------------------------------------------------------

export function buildModel(data, opts = {}) {
  const { teams, matches, priors } = data;
  const crowd = opts.crowd !== false;
  const context = opts.context !== false; // prudence de finale + repos + fatigue

  const slope = calibrateEloSlope(priors.baseGoalsPerMatch);

  const eloEsp = liveElo(teams.esp, matches.esp, priors.eloK);
  const eloArg = liveElo(teams.arg, matches.arg, priors.eloK);

  const formEsp = teamForm(teams.esp, matches.esp, priors, slope);
  const formArg = teamForm(teams.arg, matches.arg, priors, slope);

  // Contexte : repos différentiel, prolongations déjà disputées, public
  const meanRest = (teams.esp.restDays + teams.arg.restDays) / 2;
  const restMult = (t) => (context ? 1 + priors.restDayEffectPerDay * (t.restDays - meanRest) : 1);
  const carryMult = (t) =>
    context ? 1 - priors.extraTimeCarryPenaltyPer30Min * (t.extraTimeMinutesInTournament / 30) : 1;
  const etFatigue = (t) =>
    clamp(1 - priors.extraTimeEtFatiguePer30Min * (t.extraTimeMinutesInTournament / 30), 0.8, 1);

  const crowdBonus = crowd ? priors.crowdEloBonusArg : 0;
  const dEloMatch = eloEsp.elo - eloArg.elo - crowdBonus;

  const caginess = context ? priors.finalCaginess : 1;
  const total = priors.baseGoalsPerMatch * caginess;
  const [shareEsp, shareArg] = lambdasFromElo(total, dEloMatch, slope);

  const lambdaEsp = shareEsp * formEsp.attack * formArg.defense * restMult(teams.esp) * carryMult(teams.esp);
  const lambdaArg = shareArg * formArg.attack * formEsp.defense * restMult(teams.arg) * carryMult(teams.arg);

  return {
    data, opts: { crowd, context }, slope,
    elo: { esp: eloEsp, arg: eloArg, diff: eloEsp.elo - eloArg.elo, diffWithCrowd: dEloMatch, crowdBonus },
    form: { esp: formEsp, arg: formArg },
    lambdas: { esp: lambdaEsp, arg: lambdaArg, total: lambdaEsp + lambdaArg },
    etFatigue: { esp: etFatigue(teams.esp), arg: etFatigue(teams.arg) },
    penalties: {
      espConversion: clamp(teams.esp.penalties.kickerConversion - teams.arg.penalties.gkSaveEdge, 0.4, 0.95),
      argConversion: clamp(teams.arg.penalties.kickerConversion - teams.esp.penalties.gkSaveEdge, 0.4, 0.95),
    },
    eloExpectancyEsp: eloWinExpectancy(dEloMatch),
  };
}

// ---------------------------------------------------------------------------
// Étage 4 — grille Dixon-Coles analytique (90 minutes)
// ---------------------------------------------------------------------------

export function dixonColesTau(x, y, l1, l2, rho) {
  if (x === 0 && y === 0) return 1 - l1 * l2 * rho;
  if (x === 0 && y === 1) return 1 + l1 * rho;
  if (x === 1 && y === 0) return 1 + l2 * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function dixonColesGrid(l1, l2, rho, maxGoals = 12) {
  const p1 = poissonPmfArray(l1, maxGoals);
  const p2 = poissonPmfArray(l2, maxGoals);
  const grid = [];
  let sum = 0;
  for (let x = 0; x <= maxGoals; x++) {
    grid.push(new Array(maxGoals + 1));
    for (let y = 0; y <= maxGoals; y++) {
      const p = Math.max(0, p1[x] * p2[y] * dixonColesTau(x, y, l1, l2, rho));
      grid[x][y] = p;
      sum += p;
    }
  }
  let win = 0, draw = 0, loss = 0;
  const scores = [];
  for (let x = 0; x <= maxGoals; x++)
    for (let y = 0; y <= maxGoals; y++) {
      const p = (grid[x][y] /= sum); // renormalisation (troncature + tau)
      if (x > y) win += p;
      else if (x === y) draw += p;
      else loss += p;
      scores.push({ score: `${x}-${y}`, x, y, p });
    }
  scores.sort((a, b) => b.p - a.p);
  return { grid, pHome: win, pDraw: draw, pAway: loss, topScores: scores.slice(0, 10) };
}

// ---------------------------------------------------------------------------
// Étage 5 — simulation dynamique minute par minute
// ---------------------------------------------------------------------------

// Profil de tempo : intensité croissante + pics aux temps additionnels.
// Normalisé pour que Σω(t) = durée (le niveau global vient de λ).
export function tempoProfile() {
  const reg = new Array(90);
  let s = 0;
  for (let t = 0; t < 90; t++) {
    reg[t] = 0.85 + (0.30 * t) / 89;
    if (t === 44) reg[t] += 0.35; // temps additionnel de la 1re période
    if (t === 89) reg[t] += 0.55; // temps additionnel de la 2de période
    s += reg[t];
  }
  for (let t = 0; t < 90; t++) reg[t] *= 90 / s;

  const et = new Array(30);
  s = 0;
  for (let t = 0; t < 30; t++) {
    et[t] = 0.95;
    if (t === 14) et[t] += 0.25;
    if (t === 29) et[t] += 0.45;
    s += et[t];
  }
  for (let t = 0; t < 30; t++) et[t] *= 30 / s;
  return { reg, et };
}

const TEMPO = tempoProfile();

// Multiplicateur d'état : l'équipe menée pousse (de plus en plus fort après
// la 60e), l'équipe qui mène gère. « surge » = pattern de fin de match propre
// à chaque équipe (remontadas argentines), actif dans le dernier quart d'heure
// quel que soit le score — Lautaro a frappé à 90+3 sur un score de parité.
function stateMultiplier(diff, minute, S) {
  if (diff === 0) return 1;
  if (diff >= 2) return S.shellTwoGoals;
  if (diff === 1) return S.shellOneGoal;
  const ramp = clamp((minute - S.chaseRampStart) / 30, 0, 1);
  const chase = S.chaseBase + S.chaseRampFull * ramp;
  if (diff === -1) return chase;
  if (diff === -2) return chase * S.chaseTwoGoalsDamp;
  return chase * 0.8; // mené de 3+ : la poussée retombe
}

function lateSurge(team, minute) {
  return 1 + (team.lateSurge - 1) * clamp((minute - 75) / 15, 0, 1);
}

// Probabilité qu'au moins un but tombe dans la minute (approx. 1−e^{−m} par
// développement limité : m ≤ 0,1 ⇒ erreur < 0,02 %, deux buts la même minute
// négligés sciemment).
const goalProb = (m) => m - 0.5 * m * m;

/**
 * Simule une finale complète. `P` est un jeu de paramètres (éventuellement
 * bruités par l'étage 6) :
 *   { lEsp, lArg, etIntensity, etFatigueEsp, etFatigueArg,
 *     pkEsp, pkArg, state, surgeEsp, surgeArg }
 * Renvoie { gEsp, gArg, g90Esp, g90Arg, winner: 'esp'|'arg', via: '90'|'et'|'tab' }
 */
export function simulateFinal(rng, P) {
  let gE = 0, gA = 0;
  const baseE = P.lEsp / 90, baseA = P.lArg / 90;

  for (let t = 0; t < 90; t++) {
    const w = TEMPO.reg[t];
    const mE = baseE * w * stateMultiplier(gE - gA, t + 1, P.state) * (1 + (P.surgeEsp - 1) * clamp((t + 1 - 75) / 15, 0, 1));
    const mA = baseA * w * stateMultiplier(gA - gE, t + 1, P.state) * (1 + (P.surgeArg - 1) * clamp((t + 1 - 75) / 15, 0, 1));
    if (rng() < goalProb(mE)) gE++;
    if (rng() < goalProb(mA)) gA++;
  }
  const g90E = gE, g90A = gA;
  if (gE !== gA) return { gEsp: gE, gArg: gA, g90Esp: g90E, g90Arg: g90A, winner: gE > gA ? "esp" : "arg", via: "90" };

  // Prolongation : intensité réduite, fatigue différentielle, surge maintenu
  for (let t = 0; t < 30; t++) {
    const w = TEMPO.et[t];
    const min = 91 + t;
    const mE = baseE * P.etIntensity * P.etFatigueEsp * w * stateMultiplier(gE - gA, min, P.state) * P.surgeEsp;
    const mA = baseA * P.etIntensity * P.etFatigueArg * w * stateMultiplier(gA - gE, min, P.state) * P.surgeArg;
    if (rng() < goalProb(mE)) gE++;
    if (rng() < goalProb(mA)) gA++;
  }
  if (gE !== gA) return { gEsp: gE, gArg: gA, g90Esp: g90E, g90Arg: g90A, winner: gE > gA ? "esp" : "arg", via: "et" };

  // Tirs au but : 5 tirs chacun puis mort subite, premier tireur au hasard
  const winner = simulateShootout(rng, P.pkEsp, P.pkArg);
  return { gEsp: gE, gArg: gA, g90Esp: g90E, g90Arg: g90A, winner, via: "tab" };
}

export function simulateShootout(rng, pEsp, pArg) {
  const espFirst = rng() < 0.5;
  const kicks = espFirst ? ["esp", "arg"] : ["arg", "esp"];
  let sE = 0, sA = 0;
  for (let round = 1; round <= 5; round++) {
    for (const side of kicks) {
      if (side === "esp") { if (rng() < pEsp) sE++; }
      else if (rng() < pArg) sA++;
    }
    // arrêt anticipé quand la séance est mathématiquement pliée (simple
    // optimisation : sous tirs i.i.d., finir les tirs ne change pas l'issue)
    const left = 5 - round;
    if (sE > sA + left || sA > sE + left) break;
  }
  if (sE !== sA) return sE > sA ? "esp" : "arg";
  for (let i = 0; i < 40; i++) { // mort subite
    const okE = rng() < pEsp, okA = rng() < pArg;
    if (okE !== okA) return okE ? "esp" : "arg";
  }
  return rng() < 0.5 ? "esp" : "arg"; // garde-fou théorique
}

// ---------------------------------------------------------------------------
// Étage 6 — Monte-Carlo avec incertitude paramétrique (lots bayésiens)
// ---------------------------------------------------------------------------

export function runMonteCarlo(model, { nBatches = 64, simsPerBatch = 8000, seed = 20260719 } = {}) {
  const { priors } = model.data;
  const U = priors.uncertainty;
  const S = priors.stateEffects;
  const teams = model.data.teams;

  const agg = {
    n: 0,
    winEsp: 0, winArg: 0,
    via: { esp: { 90: 0, et: 0, tab: 0 }, arg: { 90: 0, et: 0, tab: 0 } },
    p90: { esp: 0, draw: 0, arg: 0 },
    goals90Esp: new Array(11).fill(0),
    goals90Arg: new Array(11).fill(0),
    scores90: new Map(),
    sumG90Esp: 0, sumG90Arg: 0,
    extraTime: 0, shootouts: 0,
    batchTitleEsp: [],
  };

  for (let b = 0; b < nBatches; b++) {
    const rng = mulberry32(deriveSeed(seed, b));

    // — tirage des paramètres du lot (incertitude épistémique) —
    const dEloNoise = U.eloSigma * gaussian(rng) - U.eloSigma * gaussian(rng); // deux Elo indépendants
    const total = priors.baseGoalsPerMatch *
      (model.opts.context ? clamp(priors.finalCaginess + U.caginessSigma * gaussian(rng), 0.7, 1.1) : 1);
    const [shareE, shareA] = lambdasFromElo(total, model.elo.diffWithCrowd + dEloNoise, model.slope);
    const fE = model.form.esp, fA = model.form.arg;
    const noisy = (m) => m * Math.exp(U.formSigmaLog * gaussian(rng));
    const meanRest = (teams.esp.restDays + teams.arg.restDays) / 2;
    const rest = (t) => (model.opts.context ? 1 + priors.restDayEffectPerDay * (t.restDays - meanRest) : 1);
    const carry = (t) => (model.opts.context ? 1 - priors.extraTimeCarryPenaltyPer30Min * (t.extraTimeMinutesInTournament / 30) : 1);

    const P = {
      lEsp: clamp(shareE * noisy(fE.attack) * noisy(fA.defense) * rest(teams.esp) * carry(teams.esp), 0.15, 5),
      lArg: clamp(shareA * noisy(fA.attack) * noisy(fE.defense) * rest(teams.arg) * carry(teams.arg), 0.15, 5),
      etIntensity: priors.extraTimeIntensity,
      etFatigueEsp: model.etFatigue.esp,
      etFatigueArg: model.etFatigue.arg,
      pkEsp: clamp(model.penalties.espConversion + U.penaltySigma * gaussian(rng), 0.4, 0.95),
      pkArg: clamp(model.penalties.argConversion + U.penaltySigma * gaussian(rng), 0.4, 0.95),
      state: S,
      surgeEsp: teams.esp.lateSurge,
      surgeArg: teams.arg.lateSurge,
    };

    let batchEsp = 0;
    for (let i = 0; i < simsPerBatch; i++) {
      const r = simulateFinal(rng, P);
      agg.n++;
      if (r.winner === "esp") { agg.winEsp++; batchEsp++; } else agg.winArg++;
      agg.via[r.winner][r.via]++;
      if (r.via !== "90") agg.extraTime++;
      if (r.via === "tab") agg.shootouts++;
      if (r.g90Esp > r.g90Arg) agg.p90.esp++;
      else if (r.g90Esp === r.g90Arg) agg.p90.draw++;
      else agg.p90.arg++;
      agg.goals90Esp[Math.min(10, r.g90Esp)]++;
      agg.goals90Arg[Math.min(10, r.g90Arg)]++;
      agg.sumG90Esp += r.g90Esp;
      agg.sumG90Arg += r.g90Arg;
      const key = `${r.g90Esp}-${r.g90Arg}`;
      agg.scores90.set(key, (agg.scores90.get(key) || 0) + 1);
    }
    agg.batchTitleEsp.push(batchEsp / simsPerBatch);
  }

  const n = agg.n;
  const sorted = [...agg.batchTitleEsp].sort((a, b) => a - b);
  const q = (p) => sorted[clamp(Math.round(p * (sorted.length - 1)), 0, sorted.length - 1)];
  const scores90 = [...agg.scores90.entries()]
    .map(([score, c]) => ({ score, p: c / n }))
    .sort((a, b) => b.p - a.p);

  return {
    n, nBatches, simsPerBatch, seed,
    title: {
      esp: agg.winEsp / n,
      arg: agg.winArg / n,
      espCredible90: [q(0.05), q(0.95)],
      via: {
        esp: { 90: agg.via.esp["90"] / n, et: agg.via.esp.et / n, tab: agg.via.esp.tab / n },
        arg: { 90: agg.via.arg["90"] / n, et: agg.via.arg.et / n, tab: agg.via.arg.tab / n },
      },
    },
    p90: { esp: agg.p90.esp / n, draw: agg.p90.draw / n, arg: agg.p90.arg / n },
    pExtraTime: agg.extraTime / n,
    pShootout: agg.shootouts / n,
    expGoals90: { esp: agg.sumG90Esp / n, arg: agg.sumG90Arg / n },
    goals90Dist: {
      esp: agg.goals90Esp.map((c) => c / n),
      arg: agg.goals90Arg.map((c) => c / n),
    },
    topScores90: scores90.slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// Prédiction complète
// ---------------------------------------------------------------------------

export function entropyBits(ps) {
  return -ps.filter((p) => p > 0).reduce((s, p) => s + p * Math.log2(p), 0);
}

export function predict(data, opts = {}) {
  const model = buildModel(data, opts);
  const analytic = dixonColesGrid(model.lambdas.esp, model.lambdas.arg, data.priors.dixonColesRho);
  const mc = runMonteCarlo(model, opts);

  const favorite = mc.title.esp >= mc.title.arg ? "esp" : "arg";
  const verdict = {
    favorite,
    favoriteName: data.teams[favorite].name,
    pTitleFavorite: Math.max(mc.title.esp, mc.title.arg),
    mostLikelyScore90: mc.topScores90[0],
    mostLikelyScoreAnalytic: analytic.topScores[0],
    titleEntropyBits: entropyBits([mc.title.esp, mc.title.arg]),
    // validation croisée : la grille analytique et la simulation dynamique
    // doivent raconter la même histoire à 90'
    crossCheck90: {
      analytic: { esp: analytic.pHome, draw: analytic.pDraw, arg: analytic.pAway },
      simulated: mc.p90,
      maxAbsGap: Math.max(
        Math.abs(analytic.pHome - mc.p90.esp),
        Math.abs(analytic.pDraw - mc.p90.draw),
        Math.abs(analytic.pAway - mc.p90.arg)
      ),
    },
  };

  return { model, analytic, mc, verdict };
}
