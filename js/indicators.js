/* ════════════════════════════════════════════════════════════
   indicators.js — Indicateurs techniques + moteur d'analyse.
   Tous les tableaux retournés sont alignés sur l'entrée
   (null tant que l'indicateur n'est pas calculable).
   ════════════════════════════════════════════════════════════ */
'use strict';

const TA = {

  sma(vals, p) {
    const out = new Array(vals.length).fill(null);
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i];
      if (i >= p) sum -= vals[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  },

  ema(vals, p) {
    const out = new Array(vals.length).fill(null);
    const k = 2 / (p + 1);
    let prev = null;
    for (let i = 0; i < vals.length; i++) {
      if (i === p - 1) {
        let s = 0;
        for (let j = 0; j < p; j++) s += vals[j];
        prev = s / p;
        out[i] = prev;
      } else if (i >= p) {
        prev = vals[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  },

  rsi(closes, p = 14) {
    const out = new Array(closes.length).fill(null);
    let g = 0, l = 0;
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      const up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= p) {
        g += up; l += dn;
        if (i === p) {
          g /= p; l /= p;
          out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
        }
      } else {
        g = (g * (p - 1) + up) / p;
        l = (l * (p - 1) + dn) / p;
        out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      }
    }
    return out;
  },

  macd(closes, fast = 12, slow = 26, sig = 9) {
    const ef = this.ema(closes, fast), es = this.ema(closes, slow);
    const line = closes.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
    // EMA du signal calculée sur la portion définie
    const start = line.findIndex((v) => v != null);
    const sub = start >= 0 ? line.slice(start) : [];
    const sigSub = sub.length ? this.ema(sub, sig) : [];
    const signal = new Array(closes.length).fill(null);
    for (let i = 0; i < sigSub.length; i++) signal[start + i] = sigSub[i];
    const hist = line.map((v, i) => (v != null && signal[i] != null) ? v - signal[i] : null);
    return { line, signal, hist };
  },

  bollinger(closes, p = 20, mult = 2) {
    const mid = this.sma(closes, p);
    const up = new Array(closes.length).fill(null);
    const lo = new Array(closes.length).fill(null);
    for (let i = p - 1; i < closes.length; i++) {
      let s = 0;
      for (let j = i - p + 1; j <= i; j++) s += Math.pow(closes[j] - mid[i], 2);
      const sd = Math.sqrt(s / p);
      up[i] = mid[i] + mult * sd;
      lo[i] = mid[i] - mult * sd;
    }
    return { mid, up, lo };
  },

  atr(candles, p = 14) {
    const out = new Array(candles.length).fill(null);
    let prev = null, acc = 0;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const tr = i === 0 ? c.h - c.l
        : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c));
      if (i < p) { acc += tr; if (i === p - 1) { prev = acc / p; out[i] = prev; } }
      else { prev = (prev * (p - 1) + tr) / p; out[i] = prev; }
    }
    return out;
  },

  /* VWAP par session (réinitialisé chaque jour UTC) */
  vwap(candles) {
    const out = new Array(candles.length).fill(null);
    let pv = 0, vv = 0, day = null;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const d = Math.floor(c.t / 86400000);
      if (d !== day) { day = d; pv = 0; vv = 0; }
      const typ = (c.h + c.l + c.c) / 3;
      pv += typ * (c.v || 1); vv += (c.v || 1);
      out[i] = pv / vv;
    }
    return out;
  },

  heikinAshi(candles) {
    const out = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const haC = (c.o + c.h + c.l + c.c) / 4;
      const haO = i === 0 ? (c.o + c.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
      out.push({ t: c.t, o: haO, c: haC, h: Math.max(c.h, haO, haC), l: Math.min(c.l, haO, haC), v: c.v });
    }
    return out;
  },

  /* niveaux : plus haut/bas récents + pivot classique */
  levels(candles, lookback = 60) {
    const seg = candles.slice(-lookback);
    if (!seg.length) return null;
    let hi = -Infinity, lo = Infinity;
    for (const c of seg) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; }
    const last = seg[seg.length - 1];
    const piv = (hi + lo + last.c) / 3;
    return {
      hi, lo, pivot: piv,
      r1: 2 * piv - lo, s1: 2 * piv - hi,
      r2: piv + (hi - lo), s2: piv - (hi - lo),
    };
  },

  /* ───────── moteur d'analyse : score composite + lecture ───────── */
  report(candles, digits) {
    if (!candles || candles.length < 35) return null;
    const closes = candles.map((c) => c.c);
    const last = closes[closes.length - 1];
    const fmt = (v) => v == null ? '—' : v.toFixed(digits);

    const sma20a = this.sma(closes, 20), sma50a = this.sma(closes, 50);
    const s20 = sma20a[closes.length - 1], s50 = sma50a[closes.length - 1];
    const s20prev = sma20a[closes.length - 6];
    const rsiA = this.rsi(closes, 14);
    const rsi = rsiA[closes.length - 1];
    const m = this.macd(closes);
    const hist = m.hist[closes.length - 1], histPrev = m.hist[closes.length - 2];
    const bb = this.bollinger(closes);
    const bbUp = bb.up[closes.length - 1], bbLo = bb.lo[closes.length - 1];
    const mom = (last - closes[closes.length - 11]) / closes[closes.length - 11] * 100;
    const lv = this.levels(candles);

    const items = [];
    const add = (label, value, signal, note) => items.push({ label, value, signal, note });

    if (s20 != null) add('PRIX vs SMA20', fmt(s20), last > s20 ? 1 : -1, last > s20 ? 'au-dessus' : 'en-dessous');
    if (s50 != null) add('PRIX vs SMA50', fmt(s50), last > s50 ? 1 : -1, last > s50 ? 'au-dessus' : 'en-dessous');
    if (s20 != null && s20prev != null) {
      const slope = s20 - s20prev;
      add('PENTE SMA20', (slope >= 0 ? '+' : '') + slope.toFixed(digits), slope > 0 ? 1 : slope < 0 ? -1 : 0, slope > 0 ? 'ascendante' : 'descendante');
    }
    if (rsi != null) {
      const sig = rsi < 30 ? 1 : rsi > 70 ? -1 : rsi > 55 ? 0.5 : rsi < 45 ? -0.5 : 0;
      add('RSI 14', rsi.toFixed(1), sig, rsi < 30 ? 'survendu' : rsi > 70 ? 'suracheté' : 'neutre');
    }
    if (hist != null && histPrev != null) {
      const cross = (hist > 0 && histPrev <= 0) ? 'croisement haussier'
        : (hist < 0 && histPrev >= 0) ? 'croisement baissier'
        : hist > 0 ? 'positif' : 'négatif';
      add('MACD 12,26,9', hist.toFixed(digits), hist > 0 ? 1 : -1, cross);
    }
    if (bbUp != null) {
      const pos = last > bbUp ? -0.5 : last < bbLo ? 0.5 : 0;
      add('BOLLINGER 20,2', `${fmt(bbLo)} / ${fmt(bbUp)}`, pos, last > bbUp ? 'au-delà de la bande sup.' : last < bbLo ? 'sous la bande inf.' : 'dans les bandes');
    }
    add('MOMENTUM 10', (mom >= 0 ? '+' : '') + mom.toFixed(2) + '%', mom > 0.05 ? 1 : mom < -0.05 ? -1 : 0, mom > 0 ? 'positif' : 'négatif');

    const raw = items.reduce((a, i) => a + i.signal, 0);
    const score = Math.max(-100, Math.min(100, Math.round(raw / items.length * 100)));
    const verdict = score >= 45 ? 'HAUSSIER' : score >= 15 ? 'PLUTÔT HAUSSIER'
      : score <= -45 ? 'BAISSIER' : score <= -15 ? 'PLUTÔT BAISSIER' : 'NEUTRE';

    return { last, score, verdict, items, levels: lv, rsi, fmt };
  },
};
