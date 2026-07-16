/*
 * pronostic/model.mjs — moteur de prédiction générique deux équipes (A vs B)
 *
 * Affiches fournies : finale Espagne–Argentine (data.json) et petite finale
 * France–Angleterre (data-petite.json) de la Coupe du monde 2026.
 *
 * Pipeline en six étages, zéro dépendance :
 *
 *   1. Elo « vivant »        instantané officiel mis à jour match par match
 *                            (barème eloratings : K=60, multiplicateur de
 *                            marge) jusqu'à la veille du match.
 *   2. Auto-calibration      la pente Elo→buts est résolue numériquement pour
 *                            que la grille de Poisson reproduise l'espérance de
 *                            gain Elo (aucune constante magique).
 *   3. Forme attaque/défense ratios observé/attendu sur les 7 matchs du
 *                            tournoi, pondérés par récence (demi-vie 4 matchs)
 *                            et rétrécis vers 1 (empirical Bayes).
 *   4. Grille Dixon-Coles    probabilités exactes de chaque score à 90'
 *                            (correction de dépendance aux scores fermés),
 *                            plus marchés « buteur vedette » par amincissement
 *                            de Poisson.
 *   5. Monte-Carlo dynamique simulation minute par minute : tempo croissant,
 *                            équipe menée qui pousse, équipe menant qui gère,
 *                            « pattern remontada », prolongation avec fatigue,
 *                            séance de tirs au but tir par tir.
 *   6. Incertitude           les paramètres eux-mêmes sont rééchantillonnés à
 *                            chaque lot (Elo, forme, rho, contexte, t.a.b.) →
 *                            intervalle de crédibilité sur la probabilité de
 *                            victoire, pas seulement une moyenne.
 *
 * L'« exactitude » est mathématiquement impossible : un match de football est
 * un processus stochastique. Ce que le modèle fournit de mieux qu'un verdict,
 * c'est la distribution complète et son incertitude.
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
// du match (les scores a.p. comptent tels quels, convention eloratings).
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
// l'espérance de gain Elo à ΔElo = 100 (zone pertinente pour ces affiches).
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
  const context = opts.context !== false; // contexte de l'affiche + repos + fatigue

  const slope = calibrateEloSlope(priors.baseGoalsPerMatch);

  const eloA = liveElo(teams.a, matches.a, priors.eloK);
  const eloB = liveElo(teams.b, matches.b, priors.eloK);

  const formA = teamForm(teams.a, matches.a, priors, slope);
  const formB = teamForm(teams.b, matches.b, priors, slope);

  // Contexte : repos différentiel, prolongations déjà disputées, public
  const meanRest = (teams.a.restDays + teams.b.restDays) / 2;
  const restMult = (t) => (context ? 1 + priors.restDayEffectPerDay * (t.restDays - meanRest) : 1);
  const carryMult = (t) =>
    context ? 1 - priors.extraTimeCarryPenaltyPer30Min * (t.extraTimeMinutesInTournament / 30) : 1;
  const etFatigue = (t) =>
    clamp(1 - priors.extraTimeEtFatiguePer30Min * (t.extraTimeMinutesInTournament / 30), 0.8, 1);

  // Bonus de public exprimé en points Elo au bénéfice de l'équipe B
  const crowdBonus = crowd ? priors.crowdEloBonusB : 0;
  const dEloMatch = eloA.elo - eloB.elo - crowdBonus;

  // Multiplicateur de buts propre à l'affiche (finale fermée : 0,90 ;
  // petite finale ouverte : > 1)
  const contextMult = context ? priors.contextGoalMultiplier : 1;
  const total = priors.baseGoalsPerMatch * contextMult;
  const [shareA, shareB] = lambdasFromElo(total, dEloMatch, slope);

  const lambdaA = shareA * formA.attack * formB.defense * restMult(teams.a) * carryMult(teams.a);
  const lambdaB = shareB * formB.attack * formA.defense * restMult(teams.b) * carryMult(teams.b);

  return {
    data, opts: { crowd, context }, slope,
    elo: { a: eloA, b: eloB, diff: eloA.elo - eloB.elo, diffWithCrowd: dEloMatch, crowdBonus },
    form: { a: formA, b: formB },
    lambdas: { a: lambdaA, b: lambdaB, total: lambdaA + lambdaB },
    etFatigue: { a: etFatigue(teams.a), b: etFatigue(teams.b) },
    penalties: {
      aConversion: clamp(teams.a.penalties.kickerConversion - teams.b.penalties.gkSaveEdge, 0.4, 0.95),
      bConversion: clamp(teams.b.penalties.kickerConversion - teams.a.penalties.gkSaveEdge, 0.4, 0.95),
    },
    eloExpectancyA: eloWinExpectancy(dEloMatch),
  };
}

// ---------------------------------------------------------------------------
// Étage 4 — grille Dixon-Coles analytique (90 minutes) + marché buteur
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

/*
 * Marché « buteur vedette » par amincissement de Poisson : si l'équipe marque
 * k buts et que la star signe une part s des buts de son équipe (tirage
 * indépendant but à but), alors P(star marque | k buts) = 1 − (1−s)^k.
 * Exact pour un processus de Poisson aminci ; très bonne approximation sur la
 * grille Dixon-Coles (la correction τ ne touche que les scores 0/1).
 * Les probabilités renvoyées sont inconditionnelles à la titularisation :
 * multiplier par playProbability pour le marché réel (non-participation ⇒
 * pari généralement annulé, cote ramenée à 1,00).
 */
export function scorerMarket(dc, side, share) {
  const grid = dc.grid;
  let pScores = 0, pScoresAndWin = 0, pWin = 0;
  for (let x = 0; x < grid.length; x++)
    for (let y = 0; y < grid.length; y++) {
      const p = grid[x][y];
      const g = side === "a" ? x : y;
      const win = side === "a" ? x > y : y > x;
      const pStar = 1 - Math.pow(1 - share, g);
      pScores += p * pStar;
      if (win) { pWin += p; pScoresAndWin += p * pStar; }
    }
  return { pScores, pScoresAndWin, pWin };
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

// Probabilité qu'au moins un but tombe dans la minute (approx. 1−e^{−m} par
// développement limité : m ≤ 0,1 ⇒ erreur < 0,02 %, deux buts la même minute
// négligés sciemment).
const goalProb = (m) => m - 0.5 * m * m;

/**
 * Simule un match complet. `P` est un jeu de paramètres (éventuellement
 * bruités par l'étage 6) :
 *   { lA, lB, etIntensity, etFatigueA, etFatigueB, pkA, pkB, state,
 *     surgeA, surgeB }
 * Renvoie { gA, gB, g90A, g90B, winner: 'a'|'b', via: '90'|'et'|'tab' }
 */
export function simulateFinal(rng, P) {
  let gA = 0, gB = 0;
  const baseA = P.lA / 90, baseB = P.lB / 90;

  for (let t = 0; t < 90; t++) {
    const w = TEMPO.reg[t];
    const surge = clamp((t + 1 - 75) / 15, 0, 1);
    const mA = baseA * w * stateMultiplier(gA - gB, t + 1, P.state) * (1 + (P.surgeA - 1) * surge);
    const mB = baseB * w * stateMultiplier(gB - gA, t + 1, P.state) * (1 + (P.surgeB - 1) * surge);
    if (rng() < goalProb(mA)) gA++;
    if (rng() < goalProb(mB)) gB++;
  }
  const g90A = gA, g90B = gB;
  if (gA !== gB) return { gA, gB, g90A, g90B, winner: gA > gB ? "a" : "b", via: "90" };

  // Prolongation : intensité réduite, fatigue différentielle, surge maintenu
  for (let t = 0; t < 30; t++) {
    const w = TEMPO.et[t];
    const min = 91 + t;
    const mA = baseA * P.etIntensity * P.etFatigueA * w * stateMultiplier(gA - gB, min, P.state) * P.surgeA;
    const mB = baseB * P.etIntensity * P.etFatigueB * w * stateMultiplier(gB - gA, min, P.state) * P.surgeB;
    if (rng() < goalProb(mA)) gA++;
    if (rng() < goalProb(mB)) gB++;
  }
  if (gA !== gB) return { gA, gB, g90A, g90B, winner: gA > gB ? "a" : "b", via: "et" };

  // Tirs au but : 5 tirs chacun puis mort subite, premier tireur au hasard
  const winner = simulateShootout(rng, P.pkA, P.pkB);
  return { gA, gB, g90A, g90B, winner, via: "tab" };
}

export function simulateShootout(rng, pA, pB) {
  const aFirst = rng() < 0.5;
  const kicks = aFirst ? ["a", "b"] : ["b", "a"];
  let sA = 0, sB = 0;
  for (let round = 1; round <= 5; round++) {
    for (const side of kicks) {
      if (side === "a") { if (rng() < pA) sA++; }
      else if (rng() < pB) sB++;
    }
    // arrêt anticipé quand la séance est mathématiquement pliée (simple
    // optimisation : sous tirs i.i.d., finir les tirs ne change pas l'issue)
    const left = 5 - round;
    if (sA > sB + left || sB > sA + left) break;
  }
  if (sA !== sB) return sA > sB ? "a" : "b";
  for (let i = 0; i < 40; i++) { // mort subite
    const okA = rng() < pA, okB = rng() < pB;
    if (okA !== okB) return okA ? "a" : "b";
  }
  return rng() < 0.5 ? "a" : "b"; // garde-fou théorique
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
    winA: 0, winB: 0,
    via: { a: { 90: 0, et: 0, tab: 0 }, b: { 90: 0, et: 0, tab: 0 } },
    p90: { a: 0, draw: 0, b: 0 },
    goals90A: new Array(11).fill(0),
    goals90B: new Array(11).fill(0),
    scores90: new Map(),
    sumG90A: 0, sumG90B: 0,
    extraTime: 0, shootouts: 0,
    batchTitleA: [],
  };

  for (let b = 0; b < nBatches; b++) {
    const rng = mulberry32(deriveSeed(seed, b));

    // — tirage des paramètres du lot (incertitude épistémique) —
    const dEloNoise = U.eloSigma * gaussian(rng) - U.eloSigma * gaussian(rng); // deux Elo indépendants
    const total = priors.baseGoalsPerMatch *
      (model.opts.context ? clamp(priors.contextGoalMultiplier + U.contextSigma * gaussian(rng), 0.6, 1.4) : 1);
    const [shareA, shareB] = lambdasFromElo(total, model.elo.diffWithCrowd + dEloNoise, model.slope);
    const fA = model.form.a, fB = model.form.b;
    const noisy = (m) => m * Math.exp(U.formSigmaLog * gaussian(rng));
    const meanRest = (teams.a.restDays + teams.b.restDays) / 2;
    const rest = (t) => (model.opts.context ? 1 + priors.restDayEffectPerDay * (t.restDays - meanRest) : 1);
    const carry = (t) => (model.opts.context ? 1 - priors.extraTimeCarryPenaltyPer30Min * (t.extraTimeMinutesInTournament / 30) : 1);

    const P = {
      lA: clamp(shareA * noisy(fA.attack) * noisy(fB.defense) * rest(teams.a) * carry(teams.a), 0.15, 5),
      lB: clamp(shareB * noisy(fB.attack) * noisy(fA.defense) * rest(teams.b) * carry(teams.b), 0.15, 5),
      etIntensity: priors.extraTimeIntensity,
      etFatigueA: model.etFatigue.a,
      etFatigueB: model.etFatigue.b,
      pkA: clamp(model.penalties.aConversion + U.penaltySigma * gaussian(rng), 0.4, 0.95),
      pkB: clamp(model.penalties.bConversion + U.penaltySigma * gaussian(rng), 0.4, 0.95),
      state: S,
      surgeA: teams.a.lateSurge,
      surgeB: teams.b.lateSurge,
    };

    let batchA = 0;
    for (let i = 0; i < simsPerBatch; i++) {
      const r = simulateFinal(rng, P);
      agg.n++;
      if (r.winner === "a") { agg.winA++; batchA++; } else agg.winB++;
      agg.via[r.winner][r.via]++;
      if (r.via !== "90") agg.extraTime++;
      if (r.via === "tab") agg.shootouts++;
      if (r.g90A > r.g90B) agg.p90.a++;
      else if (r.g90A === r.g90B) agg.p90.draw++;
      else agg.p90.b++;
      agg.goals90A[Math.min(10, r.g90A)]++;
      agg.goals90B[Math.min(10, r.g90B)]++;
      agg.sumG90A += r.g90A;
      agg.sumG90B += r.g90B;
      const key = `${r.g90A}-${r.g90B}`;
      agg.scores90.set(key, (agg.scores90.get(key) || 0) + 1);
    }
    agg.batchTitleA.push(batchA / simsPerBatch);
  }

  const n = agg.n;
  const sorted = [...agg.batchTitleA].sort((x, y) => x - y);
  const q = (p) => sorted[clamp(Math.round(p * (sorted.length - 1)), 0, sorted.length - 1)];
  const scores90 = [...agg.scores90.entries()]
    .map(([score, c]) => ({ score, p: c / n }))
    .sort((x, y) => y.p - x.p);

  return {
    n, nBatches, simsPerBatch, seed,
    title: {
      a: agg.winA / n,
      b: agg.winB / n,
      aCredible90: [q(0.05), q(0.95)],
      via: {
        a: { 90: agg.via.a["90"] / n, et: agg.via.a.et / n, tab: agg.via.a.tab / n },
        b: { 90: agg.via.b["90"] / n, et: agg.via.b.et / n, tab: agg.via.b.tab / n },
      },
    },
    p90: { a: agg.p90.a / n, draw: agg.p90.draw / n, b: agg.p90.b / n },
    pExtraTime: agg.extraTime / n,
    pShootout: agg.shootouts / n,
    expGoals90: { a: agg.sumG90A / n, b: agg.sumG90B / n },
    goals90Dist: {
      a: agg.goals90A.map((c) => c / n),
      b: agg.goals90B.map((c) => c / n),
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
  const analytic = dixonColesGrid(model.lambdas.a, model.lambdas.b, data.priors.dixonColesRho);
  const mc = runMonteCarlo(model, opts);

  // Marchés « buteur vedette » (si renseignés dans les données)
  const scorers = {};
  for (const side of ["a", "b"]) {
    const star = data.teams[side].starScorer;
    if (!star) continue;
    const m = scorerMarket(analytic, side, star.goalShare);
    scorers[side] = {
      name: star.name,
      goalShare: star.goalShare,
      playProbability: star.playProbability,
      pScores90: m.pScores,
      pScoresAndWin90: m.pScoresAndWin,
    };
  }

  const favorite = mc.title.a >= mc.title.b ? "a" : "b";
  const verdict = {
    favorite,
    favoriteName: data.teams[favorite].name,
    pTitleFavorite: Math.max(mc.title.a, mc.title.b),
    mostLikelyScore90: mc.topScores90[0],
    mostLikelyScoreAnalytic: analytic.topScores[0],
    titleEntropyBits: entropyBits([mc.title.a, mc.title.b]),
    // validation croisée : la grille analytique et la simulation dynamique
    // doivent raconter la même histoire à 90'
    crossCheck90: {
      analytic: { a: analytic.pHome, draw: analytic.pDraw, b: analytic.pAway },
      simulated: mc.p90,
      maxAbsGap: Math.max(
        Math.abs(analytic.pHome - mc.p90.a),
        Math.abs(analytic.pDraw - mc.p90.draw),
        Math.abs(analytic.pAway - mc.p90.b)
      ),
    },
  };

  return { model, analytic, mc, scorers, verdict };
}
