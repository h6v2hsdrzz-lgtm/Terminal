/* ════════════════════════════════════════════════════════════
   metrics.js — lecture analytique du COT.

   Un net brut ne dit rien seul : 135 000 contrats longs sur l'or,
   c'est beaucoup ou peu selon l'open interest du moment et selon
   les vingt dernières années. Ce module replace donc chaque chiffre
   dans trois référentiels :
     • sa propre histoire  → COT index, z-score, percentile
     • la taille du marché → % d'open interest, net par opérateur
     • le prix             → divergence positionnement / cours

   Toutes les fonctions sont pures : elles prennent des séries
   normalisées par cftc.js et ne touchent ni au DOM ni au réseau.
   ════════════════════════════════════════════════════════════ */
'use strict';

/* fenêtres d'analyse, en semaines de publication */
const LOOKBACKS = [
  { key: 26, label: '6 mois' },
  { key: 52, label: '1 an' },
  { key: 156, label: '3 ans' },
  { key: 260, label: '5 ans' },
  { key: 0, label: 'tout l\'historique' },
];

const Metrics = {
  LOOKBACKS,

  /* ── Séries ─────────────────────────────────────────────── */

  /* extrait une grandeur d'une cohorte sous forme de série temporelle */
  series(rows, cohortKey, field = 'net') {
    const out = [];
    for (const r of rows) {
      const c = r.cohorts[cohortKey];
      if (!c) continue;
      out.push({ ts: r.ts, date: r.date, value: c[field] });
    }
    return out;
  },

  seriesOf(rows, pick) {
    return rows.map((r) => ({ ts: r.ts, date: r.date, value: pick(r) }));
  },

  /* n dernières valeurs (0 = toute la série) */
  tail(arr, n) {
    return n && n > 0 && arr.length > n ? arr.slice(-n) : arr;
  },

  /* ── Statistiques de position ───────────────────────────── */

  /* COT index de Larry Williams : où se situe la valeur courante dans
     l'amplitude de la fenêtre. 0 = plancher de la période, 100 = sommet.
     C'est la mesure d'extrême la plus lisible, parce qu'elle est bornée. */
  cotIndex(values, lookback) {
    const w = this.tail(values, lookback).map((v) => (typeof v === 'number' ? v : v.value));
    if (w.length < 2) return null;
    const min = Math.min(...w);
    const max = Math.max(...w);
    if (max === min) return 50;
    return ((w[w.length - 1] - min) / (max - min)) * 100;
  },

  /* écart à la moyenne en nombre d'écarts-types — sensible aux queues,
     complémentaire du COT index qui écrase les distributions */
  zScore(values, lookback) {
    const w = this.tail(values, lookback).map((v) => (typeof v === 'number' ? v : v.value));
    if (w.length < 8) return null;
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const varc = w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1);
    const sd = Math.sqrt(varc);
    if (!sd) return 0;
    return (w[w.length - 1] - mean) / sd;
  },

  /* rang de percentile de la dernière valeur dans la fenêtre */
  percentile(values, lookback) {
    const w = this.tail(values, lookback).map((v) => (typeof v === 'number' ? v : v.value));
    if (w.length < 2) return null;
    const last = w[w.length - 1];
    let below = 0;
    for (const v of w) if (v < last) below++;
    return (below / (w.length - 1)) * 100;
  },

  /* variation sur n publications (1 = semaine sur semaine) */
  change(values, n = 1) {
    const w = values.map((v) => (typeof v === 'number' ? v : v.value));
    if (w.length <= n) return null;
    return w[w.length - 1] - w[w.length - 1 - n];
  },

  /* plus haut / plus bas de la fenêtre, avec leur date */
  extremes(series, lookback) {
    const w = this.tail(series, lookback);
    if (!w.length) return null;
    let hi = w[0], lo = w[0];
    for (const p of w) {
      if (p.value > hi.value) hi = p;
      if (p.value < lo.value) lo = p;
    }
    return { high: hi, low: lo };
  },

  /* ── Portrait complet d'une cohorte ─────────────────────── */
  cohortStats(rows, cohortKey, market, price) {
    const last = rows[rows.length - 1];
    const c = last && last.cohorts[cohortKey];
    if (!c) return null;

    const net = this.series(rows, cohortKey, 'net');
    const netValues = net.map((p) => p.value);
    const traders = (c.tradersLong || 0) + (c.tradersShort || 0);

    return {
      key: cohortKey,
      date: last.date,
      long: c.long,
      short: c.short,
      spread: c.spread,
      net: c.net,
      gross: c.gross,
      bias: c.bias,
      dLong: c.dLong,
      dShort: c.dShort,
      dNet: c.dNet,
      pctLong: c.pctLong,
      pctShort: c.pctShort,
      pctOi: last.oi ? (c.net / last.oi) * 100 : 0,
      tradersLong: c.tradersLong,
      tradersShort: c.tradersShort,
      traders,
      /* concentration interne : plus le net est porté par peu d'opérateurs,
         plus un débouclage est brutal */
      netPerTrader: traders ? c.net / traders : null,
      /* notionnel : la position traduite en dollars, la seule unité qui
         permette de comparer l'or et l'argent entre eux */
      ounces: c.net * (market ? market.size : 0),
      notional: price ? c.net * (market ? market.size : 0) * price : null,
      chg4w: this.change(netValues, 4),
      chg13w: this.change(netValues, 13),
      index: {
        26: this.cotIndex(netValues, 26),
        52: this.cotIndex(netValues, 52),
        156: this.cotIndex(netValues, 156),
        260: this.cotIndex(netValues, 260),
        0: this.cotIndex(netValues, 0),
      },
      z: {
        26: this.zScore(netValues, 26),
        52: this.zScore(netValues, 52),
        156: this.zScore(netValues, 156),
        260: this.zScore(netValues, 260),
        0: this.zScore(netValues, 0),
      },
      pct: {
        52: this.percentile(netValues, 52),
        156: this.percentile(netValues, 156),
        0: this.percentile(netValues, 0),
      },
      extremes: {
        52: this.extremes(net, 52),
        0: this.extremes(net, 0),
      },
      series: net,
    };
  },

  /* ── Détection d'événements ─────────────────────────────── */

  /* passage du net au-dessus / en dessous de zéro : un basculement de
     régime rare et signifiant, surtout sur le managed money */
  flips(series, lookback = 260) {
    const w = this.tail(series, lookback);
    const out = [];
    for (let i = 1; i < w.length; i++) {
      const a = w[i - 1].value, b = w[i].value;
      if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
        out.push({ date: w[i].date, ts: w[i].ts, to: b >= 0 ? 'long' : 'short', value: b });
      }
    }
    return out;
  },

  /* semaines dont le mouvement dépasse n écarts-types du mouvement
     hebdomadaire habituel — les grosses rotations institutionnelles */
  bigMoves(series, lookback = 156, sigma = 2) {
    const w = this.tail(series, lookback);
    if (w.length < 20) return [];
    const deltas = [];
    for (let i = 1; i < w.length; i++) deltas.push(w[i].value - w[i - 1].value);
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / (deltas.length - 1));
    if (!sd) return [];
    const out = [];
    for (let i = 1; i < w.length; i++) {
      const d = w[i].value - w[i - 1].value;
      if (Math.abs(d - mean) >= sigma * sd) {
        out.push({ date: w[i].date, ts: w[i].ts, delta: d, sigma: (d - mean) / sd });
      }
    }
    return out.reverse();
  },

  /* ── Croisement avec le prix ────────────────────────────── */

  /* aligne une série hebdomadaire COT sur une série de prix quotidiens :
     pour chaque arrêté, le dernier prix connu à cette date */
  alignPrice(series, priceRows) {
    if (!priceRows || !priceRows.length) return [];
    const sorted = [...priceRows].sort((a, b) => a.ts - b.ts);
    const out = [];
    let i = 0, last = null;
    for (const p of series) {
      while (i < sorted.length && sorted[i].ts <= p.ts) { last = sorted[i]; i++; }
      if (last) out.push({ ts: p.ts, date: p.date, value: p.value, price: last.close });
    }
    return out;
  },

  /* corrélation de Pearson entre variations de net et variations de prix.
     Positive = les fonds suivent le prix (momentum). Proche de zéro ou
     négative = le positionnement a décroché du marché : c'est là que les
     divergences intéressantes apparaissent. */
  correlation(joined, lookback = 52) {
    const w = this.tail(joined, lookback);
    if (w.length < 10) return null;
    const dn = [], dp = [];
    for (let i = 1; i < w.length; i++) {
      dn.push(w[i].value - w[i - 1].value);
      dp.push((w[i].price - w[i - 1].price) / w[i - 1].price);
    }
    const mn = dn.reduce((a, b) => a + b, 0) / dn.length;
    const mp = dp.reduce((a, b) => a + b, 0) / dp.length;
    let cov = 0, vn = 0, vp = 0;
    for (let i = 0; i < dn.length; i++) {
      cov += (dn[i] - mn) * (dp[i] - mp);
      vn += (dn[i] - mn) ** 2;
      vp += (dp[i] - mp) ** 2;
    }
    if (!vn || !vp) return null;
    return cov / Math.sqrt(vn * vp);
  },

  /* divergence : le prix fait un plus haut de fenêtre, le net non
     (ou l'inverse). Signal classique d'essoufflement de tendance. */
  divergence(joined, lookback = 26) {
    const w = this.tail(joined, lookback);
    if (w.length < 8) return null;
    const last = w[w.length - 1];
    const prices = w.map((p) => p.price);
    const nets = w.map((p) => p.value);
    const pHigh = Math.max(...prices), pLow = Math.min(...prices);
    const nHigh = Math.max(...nets), nLow = Math.min(...nets);
    const nearTop = (v, hi, lo) => hi > lo && (v - lo) / (hi - lo) > 0.9;
    const nearBot = (v, hi, lo) => hi > lo && (v - lo) / (hi - lo) < 0.1;

    if (nearTop(last.price, pHigh, pLow) && !nearTop(last.value, nHigh, nLow)) {
      return { type: 'bearish', label: 'Prix au plus haut sans confirmation du positionnement' };
    }
    if (nearBot(last.price, pHigh, pLow) && !nearBot(last.value, nHigh, nLow)) {
      return { type: 'bullish', label: 'Prix au plus bas sans capitulation du positionnement' };
    }
    return { type: 'none', label: 'Positionnement et prix alignés' };
  },

  /* ── Court terme ────────────────────────────────────────── */

  /* Vitesse de rotation : variations du net sur les horizons courts,
     rapportées à l'amplitude annuelle pour rester lisibles quand
     l'open interest change d'échelle. */
  velocity(series, horizons = [1, 2, 4, 8, 13]) {
    const values = series.map((p) => p.value);
    const win = this.tail(values, 52);
    const span = win.length ? Math.max(...win) - Math.min(...win) : 0;
    const out = {};
    for (const h of horizons) {
      const d = this.change(values, h);
      out[h] = d == null ? null : { delta: d, share: span > 0 ? (d / span) * 100 : null };
    }
    return out;
  },

  /* Sensibilité historique du positionnement au prix.
     Régression des variations hebdomadaires du net sur les variations
     de prix : Δnet = α + β · Δprix%. Le β dit combien de contrats la
     cohorte ajoute par point de pourcentage, le r² dit à quel point
     cette relation tient — sans lui le β n'est qu'un chiffre. */
  priceBeta(joined, lookback = 52) {
    const w = this.tail(joined, lookback);
    if (w.length < 12) return null;
    const x = [], y = [];
    for (let i = 1; i < w.length; i++) {
      if (!w[i - 1].price) continue;
      x.push(((w[i].price - w[i - 1].price) / w[i - 1].price) * 100);
      y.push(w[i].value - w[i - 1].value);
    }
    if (x.length < 10) return null;

    const mx = x.reduce((a, b) => a + b, 0) / x.length;
    const my = y.reduce((a, b) => a + b, 0) / y.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) ** 2;
      syy += (y[i] - my) ** 2;
    }
    if (!sxx || !syy) return null;
    const beta = sxy / sxx;
    return { beta, r2: (sxy * sxy) / (sxx * syy), n: x.length };
  },

  /* Ce qui s'est passé sur le prix depuis l'arrêté du rapport.
     C'est l'angle mort du COT : entre le mardi d'arrêté et l'instant
     présent, le positionnement a bougé sans qu'on le voie. */
  sinceCutoff(rows, priceRows, spotPrice) {
    if (!rows.length || !priceRows || !priceRows.length) return null;
    const last = rows[rows.length - 1];

    /* dernier prix connu à la date d'arrêté */
    let atCutoff = null;
    for (const p of priceRows) {
      if (p.ts <= last.ts) atCutoff = p; else break;
    }
    const now = spotPrice != null ? spotPrice
      : (priceRows[priceRows.length - 1] || {}).close;
    if (!atCutoff || now == null || !atCutoff.close) return null;

    const changePct = ((now - atCutoff.close) / atCutoff.close) * 100;
    const days = Math.max(0, Math.round((Date.now() / 1000 - last.ts) / 86400));

    /* amplitude parcourue depuis l'arrêté : un aller-retour peut cacher
       beaucoup de rotation sous une variation nette faible */
    const after = priceRows.filter((p) => p.ts >= last.ts).map((p) => p.close);
    const high = after.length ? Math.max(...after, now) : now;
    const low = after.length ? Math.min(...after, now) : now;

    return {
      cutoffDate: last.date, cutoffPrice: atCutoff.close, price: now,
      changePct, days,
      rangePct: atCutoff.close ? ((high - low) / atCutoff.close) * 100 : null,
      high, low,
    };
  },

  /* ── Analogues historiques ──────────────────────────────── */

  /* Retrouve les arrêtés passés dont le COT index ressemble à celui
     d'aujourd'hui, et regarde ce que le prix a fait ensuite. Ce n'est
     pas une prévision : c'est une base statistique pour situer le
     contexte actuel, avec l'échantillon affiché pour qu'on puisse
     juger de sa solidité. */
  analogues(joined, { tolerance = 7, horizons = [4, 13, 26], lookback = 52, minGap = 8 } = {}) {
    if (joined.length < 60) return null;
    const values = joined.map((p) => p.value);
    const idxAt = (i) => {
      const w = values.slice(Math.max(0, i - lookback + 1), i + 1);
      if (w.length < 10) return null;
      const min = Math.min(...w), max = Math.max(...w);
      return max === min ? 50 : ((values[i] - min) / (max - min)) * 100;
    };

    const current = idxAt(joined.length - 1);
    if (current == null) return null;

    const hits = [];
    let lastHit = -Infinity;
    const maxH = Math.max(...horizons);
    for (let i = lookback; i < joined.length - maxH; i++) {
      const v = idxAt(i);
      if (v == null || Math.abs(v - current) > tolerance) continue;
      if (i - lastHit < minGap) continue;   /* évite de compter dix fois le même épisode */
      lastHit = i;
      const fwd = {};
      for (const h of horizons) {
        const base = joined[i].price, later = joined[i + h].price;
        fwd[h] = base ? ((later - base) / base) * 100 : null;
      }
      hits.push({ date: joined[i].date, index: v, price: joined[i].price, forward: fwd });
    }

    if (hits.length < 3) return { current, sample: hits.length, hits, summary: null };

    const summary = {};
    for (const h of horizons) {
      const vals = hits.map((x) => x.forward[h]).filter((v) => v != null).sort((a, b) => a - b);
      if (!vals.length) continue;
      const mid = Math.floor(vals.length / 2);
      summary[h] = {
        median: vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2,
        mean: vals.reduce((a, b) => a + b, 0) / vals.length,
        positive: (vals.filter((v) => v > 0).length / vals.length) * 100,
        best: vals[vals.length - 1],
        worst: vals[0],
        n: vals.length,
      };
    }
    return { current, sample: hits.length, hits: hits.slice(-12).reverse(), summary };
  },

  /* ── Score de tension ───────────────────────────────────── */

  /* Agrège les signaux d'un métal en une lecture unique, bornée à ±100.
     Positif = positionnement tendu à la hausse (risque de purge),
     négatif = positionnement lessivé (terrain de rebond).
     Chaque composante est renvoyée pour que l'écran — et l'agent IA —
     puissent expliquer le score au lieu de l'asséner. */
  tension(rows, report, market, joined) {
    const specKey = report === 'legacy' ? 'noncomm' : 'money';
    const spec = this.cohortStats(rows, specKey, market);
    if (!spec) return null;
    const parts = [];
    const push = (label, value, weight, detail) => parts.push({ label, value, weight, detail });

    /* 1. extrême du net spéculatif sur 3 ans */
    const i156 = spec.index[156];
    if (i156 != null) push('Extrême du net spéculatif (3 ans)', (i156 - 50) / 50, 30,
      `COT index ${i156.toFixed(0)}/100`);

    /* 2. z-score 5 ans — capte les queues que l'index borne */
    const z = spec.z[260];
    if (z != null) push('Écart à la normale (5 ans)', Math.max(-1, Math.min(1, z / 2.5)), 25,
      `z = ${z.toFixed(2)}σ`);

    /* 3. part du net dans l'open interest : un net énorme sur un marché
          étroit se déboucle plus violemment */
    const last = rows[rows.length - 1];
    if (last.oi) {
      const share = (spec.net / last.oi) * 100;
      push('Poids dans l\'open interest', Math.max(-1, Math.min(1, share / 45)), 15,
        `${share.toFixed(1)} % de l'OI`);
    }

    /* 4. concentration des 4 plus gros — mesure de fragilité */
    const conc = last.conc.net4Long - last.conc.net4Short;
    push('Concentration des 4 premiers', Math.max(-1, Math.min(1, conc / 30)), 10,
      `4 plus gros : ${last.conc.net4Long.toFixed(1)} % long / ${last.conc.net4Short.toFixed(1)} % short`);

    /* 5. impulsion récente : 4 semaines rapportées à l'amplitude annuelle */
    const ext = spec.extremes[52];
    if (ext && spec.chg4w != null) {
      const span = ext.high.value - ext.low.value;
      if (span > 0) push('Impulsion 4 semaines', Math.max(-1, Math.min(1, (spec.chg4w / span) * 2.5)), 10,
        `${spec.chg4w >= 0 ? '+' : ''}${Math.round(spec.chg4w).toLocaleString('fr-FR')} contrats`);
    }

    /* 6. divergence prix / positionnement */
    if (joined && joined.length) {
      const d = this.divergence(joined, 26);
      if (d && d.type === 'bearish') push('Divergence prix / positionnement', 0.6, 10, d.label);
      else if (d && d.type === 'bullish') push('Divergence prix / positionnement', -0.6, 10, d.label);
      else if (d) push('Divergence prix / positionnement', 0, 10, d.label);
    }

    const wsum = parts.reduce((a, p) => a + p.weight, 0) || 1;
    const score = parts.reduce((a, p) => a + p.value * p.weight, 0) / wsum * 100;

    let verdict, tone;
    if (score >= 45) { verdict = 'Positionnement très tendu à la hausse'; tone = 'hot'; }
    else if (score >= 18) { verdict = 'Positionnement chargé à la hausse'; tone = 'warm'; }
    else if (score > -18) { verdict = 'Positionnement neutre'; tone = 'neutral'; }
    else if (score > -45) { verdict = 'Positionnement allégé'; tone = 'cool'; }
    else { verdict = 'Positionnement lessivé — extrême baissier'; tone = 'cold'; }

    return { score, verdict, tone, parts, cohort: specKey };
  },

  /* ── Or contre argent ───────────────────────────────────── */

  /* Compare le positionnement des deux métaux sur une base commune
     (COT index et % d'OI, insensibles à la taille des contrats) pour
     repérer les décalages exploitables sur le ratio or/argent. */
  goldSilverSpread(goldRows, silverRows, report) {
    const key = report === 'legacy' ? 'noncomm' : 'money';
    if (!goldRows || !silverRows || !goldRows.length || !silverRows.length) return null;

    const gs = this.series(goldRows, key, 'net');
    const ss = this.series(silverRows, key, 'net');
    const sMap = new Map(ss.map((p) => [p.date, p.value]));

    const paired = [];
    for (const p of gs) {
      if (!sMap.has(p.date)) continue;
      paired.push({ ts: p.ts, date: p.date, gold: p.value, silver: sMap.get(p.date) });
    }
    if (paired.length < 30) return null;

    /* on normalise chacun sur sa propre fenêtre de 3 ans puis on prend
       l'écart : positif = or plus tendu que l'argent */
    const win = 156;
    const norm = (arr, i, pick) => {
      const from = Math.max(0, i - win + 1);
      const w = arr.slice(from, i + 1).map(pick);
      const min = Math.min(...w), max = Math.max(...w);
      return max === min ? 50 : ((pick(arr[i]) - min) / (max - min)) * 100;
    };

    const spread = [];
    for (let i = 0; i < paired.length; i++) {
      if (i < 30) continue;
      const g = norm(paired, i, (x) => x.gold);
      const s = norm(paired, i, (x) => x.silver);
      spread.push({ ts: paired[i].ts, date: paired[i].date, gold: g, silver: s, value: g - s });
    }

    const values = spread.map((p) => p.value);
    const last = spread[spread.length - 1];
    return {
      series: spread,
      last,
      z: this.zScore(values, 156),
      percentile: this.percentile(values, 156),
      reading: !last ? null
        : last.value > 20 ? 'L\'or est nettement plus détenu que l\'argent'
          : last.value < -20 ? 'L\'argent est nettement plus détenu que l\'or'
            : 'Positionnements comparables sur les deux métaux',
    };
  },
};
