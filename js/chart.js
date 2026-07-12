/* ════════════════════════════════════════════════════════════
   chart.js — Graphique multi-panneaux sur <canvas>.
   Chandeliers ou ligne, SMA20/50, bandes de Bollinger, volume,
   RSI et MACD en sous-panneaux, zoom molette, pan à la souris,
   crosshair avec lecture OHLC + indicateurs.
   ════════════════════════════════════════════════════════════ */
'use strict';

const CHART_COLORS = {
  up: '#00d26a', dn: '#ff4b3e', last: '#ff9900',
  sma20: '#ffe14d', sma50: '#4fc3f7',
  bb: 'rgba(180,160,255,.55)', bbFill: 'rgba(180,160,255,.06)',
  vol: 'rgba(255,153,0,.35)',
  grid: '#161616', axis: '#6a6458', sep: '#2b2b2b',
  macd: '#4fc3f7', macdSig: '#ff9900',
};

class CandleChart {
  constructor(canvas, ohlcEl) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.ohlcEl = ohlcEl;
    this.candles = [];
    this.digits = 5;
    this.symbol = '';
    this.period = 60;
    this.mouse = null;
    this.opts = { type: 'candle', sma: true, bb: false, vol: true, rsi: false, macd: false };
    this.view = null;            // {i0, i1} fenêtre visible (indices)
    this._drag = null;
    this.PAD_R = 66;
    this.PAD_B = 18;
    this.PAD_T = 6;

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (this._drag) {
        const perCandle = (this.w - this.PAD_R) / this._span();
        const shift = Math.round((this._drag.x - x) / perCandle);
        if (shift !== 0) {
          let { i0, i1 } = this._drag.view;
          const span = i1 - i0;
          i0 = Math.max(0, Math.min(this.candles.length - 1 - span, i0 + shift));
          this.view = { i0, i1: i0 + span };
        }
      }
      this.mouse = { x, y };
      this.draw();
    });
    canvas.addEventListener('mousedown', (e) => {
      this._drag = { x: e.clientX - canvas.getBoundingClientRect().left, view: Object.assign({}, this._view()) };
    });
    window.addEventListener('mouseup', () => { this._drag = null; });
    canvas.addEventListener('mouseleave', () => { this.mouse = null; this._drag = null; this.draw(); });
    canvas.addEventListener('dblclick', () => { this.view = null; this.draw(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.candles.length) return;
      const v = this._view();
      const span = v.i1 - v.i0;
      const dir = e.deltaY > 0 ? 1 : -1;               // molette bas = dézoom
      const newSpan = Math.max(15, Math.min(this.candles.length - 1, Math.round(span * (dir > 0 ? 1.25 : 0.8))));
      const r = this.cv.getBoundingClientRect();
      const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / (this.w - this.PAD_R)));
      const anchor = v.i0 + span * fx;
      let i0 = Math.round(anchor - newSpan * fx);
      i0 = Math.max(0, Math.min(this.candles.length - 1 - newSpan, i0));
      this.view = { i0, i1: i0 + newSpan };
      this.draw();
    }, { passive: false });

    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this._resize();
  }

  _resize() {
    const p = this.cv.parentElement;
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(50, p.clientWidth);
    this.h = Math.max(50, p.clientHeight);
    this.cv.width = this.w * dpr;
    this.cv.height = this.h * dpr;
    this.cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setData(symbol, period, digits, candles) {
    this.symbol = symbol; this.period = period;
    this.digits = digits; this.candles = candles;
    this.view = null;
    this._recalc();
    this.draw();
  }

  setOpt(key, val) {
    if (key === 'type') this.opts.type = val;
    else this.opts[key] = val != null ? val : !this.opts[key];
    this.draw();
  }

  tick(price, ts) {
    if (!this.candles.length) return;
    const step = this.period * 60000;
    const last = this.candles[this.candles.length - 1];
    const pinned = !this.view || this.view.i1 >= this.candles.length - 1;
    if (ts - last.t >= step) {
      const t0 = last.t + Math.floor((ts - last.t) / step) * step;
      this.candles.push({ t: t0, o: price, h: price, l: price, c: price, v: 0 });
      if (this.candles.length > 600) {
        this.candles.shift();
        if (this.view) { this.view.i0 = Math.max(0, this.view.i0 - 1); this.view.i1 = Math.max(20, this.view.i1 - 1); }
      }
      if (pinned && this.view) {
        const span = this.view.i1 - this.view.i0;
        this.view.i1 = this.candles.length - 1;
        this.view.i0 = Math.max(0, this.view.i1 - span);
      }
    } else {
      last.c = price;
      if (price > last.h) last.h = price;
      if (price < last.l) last.l = price;
    }
    this._recalc();
    this.draw();
  }

  _recalc() {
    const closes = this.candles.map((c) => c.c);
    this.ind = {
      sma20: TA.sma(closes, 20),
      sma50: TA.sma(closes, 50),
      bb: TA.bollinger(closes),
      rsi: TA.rsi(closes),
      macd: TA.macd(closes),
    };
  }

  _view() {
    if (this.view) return this.view;
    return { i0: 0, i1: Math.max(1, this.candles.length - 1) };
  }
  _span() { const v = this._view(); return Math.max(1, v.i1 - v.i0); }

  fmt(v) { return v == null ? '—' : v.toFixed(this.digits); }

  /* ─────────────── rendu ─────────────── */

  draw() {
    const { cx, w, h } = this;
    cx.clearRect(0, 0, w, h);
    cx.fillStyle = '#050505';
    cx.fillRect(0, 0, w, h);
    if (!this.candles.length) {
      cx.fillStyle = '#555'; cx.font = '11px monospace'; cx.textAlign = 'center';
      cx.fillText('AUCUNE DONNÉE — tapez un symbole puis <GO>', w / 2, h / 2);
      if (this.ohlcEl) this.ohlcEl.textContent = '';
      return;
    }

    const v = this._view();
    const n = v.i1 - v.i0 + 1;
    const cw = w - this.PAD_R;
    const stepX = cw / n;
    const bw = Math.max(1.5, stepX * 0.7);
    const xAt = (i) => (i - v.i0) * stepX + stepX / 2;

    /* répartition verticale des panneaux */
    const innerH = h - this.PAD_B - this.PAD_T;
    const subs = [];
    if (this.opts.rsi) subs.push('rsi');
    if (this.opts.macd) subs.push('macd');
    const subH = subs.length ? Math.min(90, innerH * 0.18) : 0;
    const volH = this.opts.vol ? Math.min(46, innerH * 0.11) : 0;
    const mainH = innerH - subH * subs.length - volH;
    const mainY = this.PAD_T;

    /* échelle du panneau principal */
    let lo = Infinity, hi = -Infinity;
    for (let i = v.i0; i <= v.i1; i++) {
      const c = this.candles[i];
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
      if (this.opts.bb && this.ind.bb.up[i] != null) {
        if (this.ind.bb.up[i] > hi) hi = this.ind.bb.up[i];
        if (this.ind.bb.lo[i] < lo) lo = this.ind.bb.lo[i];
      }
    }
    const pad = (hi - lo) * 0.06 || hi * 0.001 || 1;
    lo -= pad; hi += pad;
    const y = (p) => mainY + (hi - p) / (hi - lo) * mainH;

    /* grille + axe prix */
    cx.font = '9px monospace'; cx.textAlign = 'left'; cx.textBaseline = 'middle';
    const nLines = Math.max(3, Math.floor(mainH / 46));
    for (let i = 0; i <= nLines; i++) {
      const p = lo + (hi - lo) * i / nLines;
      const yy = y(p);
      cx.strokeStyle = CHART_COLORS.grid;
      cx.beginPath(); cx.moveTo(0, yy); cx.lineTo(cw, yy); cx.stroke();
      cx.fillStyle = CHART_COLORS.axis;
      cx.fillText(this.fmt(p), cw + 6, yy);
    }

    /* axe temporel */
    cx.textAlign = 'center'; cx.textBaseline = 'top';
    const tEvery = Math.max(1, Math.round(n / Math.max(2, Math.floor(cw / 92))));
    for (let i = v.i0; i <= v.i1; i += tEvery) {
      const c = this.candles[i], x = xAt(i);
      cx.strokeStyle = '#101010';
      cx.beginPath(); cx.moveTo(x, mainY); cx.lineTo(x, h - this.PAD_B); cx.stroke();
      const d = new Date(c.t);
      const pd = (q) => String(q).padStart(2, '0');
      const lbl = this.period >= 1440 ? `${pd(d.getDate())}/${pd(d.getMonth() + 1)}` : `${pd(d.getHours())}:${pd(d.getMinutes())}`;
      cx.fillStyle = CHART_COLORS.axis;
      cx.fillText(lbl, x, h - this.PAD_B + 4);
    }

    /* bandes de Bollinger */
    if (this.opts.bb) {
      const bb = this.ind.bb;
      cx.beginPath();
      let started = false;
      for (let i = v.i0; i <= v.i1; i++) if (bb.up[i] != null) {
        started ? cx.lineTo(xAt(i), y(bb.up[i])) : cx.moveTo(xAt(i), y(bb.up[i]));
        started = true;
      }
      for (let i = v.i1; i >= v.i0; i--) if (bb.lo[i] != null) cx.lineTo(xAt(i), y(bb.lo[i]));
      cx.closePath();
      cx.fillStyle = CHART_COLORS.bbFill; cx.fill();
      cx.strokeStyle = CHART_COLORS.bb; cx.lineWidth = 1;
      this._plotLine(bb.up, v, xAt, y);
      this._plotLine(bb.lo, v, xAt, y);
      this._plotLine(bb.mid, v, xAt, y, [3, 3]);
    }

    /* volume */
    if (this.opts.vol && volH > 0) {
      const volY = mainY + mainH;
      let vmax = 0;
      for (let i = v.i0; i <= v.i1; i++) if (this.candles[i].v > vmax) vmax = this.candles[i].v;
      if (vmax > 0) {
        for (let i = v.i0; i <= v.i1; i++) {
          const c = this.candles[i];
          const bh = c.v / vmax * (volH - 6);
          cx.fillStyle = c.c >= c.o ? 'rgba(0,210,106,.35)' : 'rgba(255,75,62,.35)';
          cx.fillRect(xAt(i) - bw / 2, volY + volH - bh, bw, bh);
        }
      }
      cx.strokeStyle = CHART_COLORS.sep;
      cx.beginPath(); cx.moveTo(0, volY); cx.lineTo(cw, volY); cx.stroke();
      cx.fillStyle = CHART_COLORS.axis; cx.textAlign = 'left'; cx.textBaseline = 'top';
      cx.fillText('VOL', 4, volY + 3);
    }

    /* prix : chandeliers ou ligne */
    if (this.opts.type === 'line') {
      cx.strokeStyle = CHART_COLORS.last; cx.lineWidth = 1.4;
      cx.beginPath();
      for (let i = v.i0; i <= v.i1; i++) {
        const c = this.candles[i];
        i === v.i0 ? cx.moveTo(xAt(i), y(c.c)) : cx.lineTo(xAt(i), y(c.c));
      }
      cx.stroke(); cx.lineWidth = 1;
    } else {
      for (let i = v.i0; i <= v.i1; i++) {
        const c = this.candles[i];
        const x = xAt(i);
        const up = c.c >= c.o;
        cx.strokeStyle = cx.fillStyle = up ? CHART_COLORS.up : CHART_COLORS.dn;
        cx.beginPath(); cx.moveTo(x, y(c.h)); cx.lineTo(x, y(c.l)); cx.stroke();
        const yo = y(c.o), yc = y(c.c);
        cx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
      }
    }

    /* moyennes mobiles */
    if (this.opts.sma) {
      cx.lineWidth = 1.2;
      cx.strokeStyle = CHART_COLORS.sma20; this._plotLine(this.ind.sma20, v, xAt, y);
      cx.strokeStyle = CHART_COLORS.sma50; this._plotLine(this.ind.sma50, v, xAt, y);
      cx.lineWidth = 1;
    }

    /* ligne de dernier prix */
    const lastC = this.candles[this.candles.length - 1];
    if (lastC.c >= lo && lastC.c <= hi) {
      const yl = y(lastC.c);
      cx.strokeStyle = CHART_COLORS.last; cx.setLineDash([4, 3]);
      cx.beginPath(); cx.moveTo(0, yl); cx.lineTo(cw, yl); cx.stroke();
      cx.setLineDash([]);
      cx.fillStyle = CHART_COLORS.last; cx.fillRect(cw, yl - 7, this.PAD_R, 14);
      cx.fillStyle = '#000'; cx.textAlign = 'left'; cx.textBaseline = 'middle';
      cx.font = 'bold 9px monospace';
      cx.fillText(this.fmt(lastC.c), cw + 6, yl);
      cx.font = '9px monospace';
    }

    /* sous-panneaux RSI / MACD */
    let subY = mainY + mainH + volH;
    for (const s of subs) {
      cx.strokeStyle = CHART_COLORS.sep;
      cx.beginPath(); cx.moveTo(0, subY); cx.lineTo(w, subY); cx.stroke();
      if (s === 'rsi') this._drawRSI(v, xAt, subY, subH, cw);
      else this._drawMACD(v, xAt, subY, subH, cw, bw);
      subY += subH;
    }

    /* crosshair */
    this._drawCross(v, xAt, stepX, cw, mainY, mainH, lo, hi);
  }

  _plotLine(arr, v, xAt, y, dash) {
    const { cx } = this;
    if (dash) cx.setLineDash(dash);
    cx.beginPath();
    let started = false;
    for (let i = v.i0; i <= v.i1; i++) {
      if (arr[i] == null) continue;
      started ? cx.lineTo(xAt(i), y(arr[i])) : cx.moveTo(xAt(i), y(arr[i]));
      started = true;
    }
    cx.stroke();
    if (dash) cx.setLineDash([]);
  }

  _drawRSI(v, xAt, top, hh, cw) {
    const { cx } = this;
    const y = (r) => top + 4 + (100 - r) / 100 * (hh - 8);
    for (const lvl of [30, 70]) {
      cx.strokeStyle = '#2a2a2a'; cx.setLineDash([3, 3]);
      cx.beginPath(); cx.moveTo(0, y(lvl)); cx.lineTo(cw, y(lvl)); cx.stroke();
      cx.setLineDash([]);
      cx.fillStyle = CHART_COLORS.axis; cx.textAlign = 'left'; cx.textBaseline = 'middle';
      cx.fillText(String(lvl), cw + 6, y(lvl));
    }
    cx.strokeStyle = CHART_COLORS.sma20; cx.lineWidth = 1.2;
    this._plotLine(this.ind.rsi, v, xAt, y);
    cx.lineWidth = 1;
    cx.fillStyle = CHART_COLORS.axis; cx.textBaseline = 'top';
    cx.fillText('RSI 14', 4, top + 3);
  }

  _drawMACD(v, xAt, top, hh, cw, bw) {
    const { cx } = this;
    const m = this.ind.macd;
    let mx = 0;
    for (let i = v.i0; i <= v.i1; i++) {
      for (const a of [m.line, m.signal, m.hist]) {
        if (a[i] != null && Math.abs(a[i]) > mx) mx = Math.abs(a[i]);
      }
    }
    if (mx === 0) mx = 1;
    const mid = top + hh / 2;
    const y = (val) => mid - val / mx * (hh / 2 - 6);
    cx.strokeStyle = '#2a2a2a';
    cx.beginPath(); cx.moveTo(0, mid); cx.lineTo(cw, mid); cx.stroke();
    for (let i = v.i0; i <= v.i1; i++) {
      if (m.hist[i] == null) continue;
      cx.fillStyle = m.hist[i] >= 0 ? 'rgba(0,210,106,.4)' : 'rgba(255,75,62,.4)';
      const yy = y(m.hist[i]);
      cx.fillRect(xAt(i) - bw / 2, Math.min(mid, yy), bw, Math.max(1, Math.abs(yy - mid)));
    }
    cx.strokeStyle = CHART_COLORS.macd; this._plotLine(m.line, v, xAt, y);
    cx.strokeStyle = CHART_COLORS.macdSig; this._plotLine(m.signal, v, xAt, y);
    cx.fillStyle = CHART_COLORS.axis; cx.textAlign = 'left'; cx.textBaseline = 'top';
    cx.fillText('MACD 12,26,9', 4, top + 3);
  }

  _drawCross(v, xAt, stepX, cw, mainY, mainH, lo, hi) {
    const { cx } = this;
    if (!this.mouse || this.mouse.x >= cw) { if (this.ohlcEl) this.ohlcEl.textContent = ''; return; }
    const { x: mx, y: my } = this.mouse;
    cx.strokeStyle = 'rgba(255,255,255,.22)'; cx.setLineDash([3, 3]);
    cx.beginPath(); cx.moveTo(mx, this.PAD_T); cx.lineTo(mx, this.h - this.PAD_B); cx.stroke();
    if (my > mainY && my < mainY + mainH) {
      cx.beginPath(); cx.moveTo(0, my); cx.lineTo(cw, my); cx.stroke();
      cx.setLineDash([]);
      const pv = hi - (my - mainY) / mainH * (hi - lo);
      cx.fillStyle = '#333'; cx.fillRect(cw, my - 7, this.PAD_R, 14);
      cx.fillStyle = '#fff'; cx.textAlign = 'left'; cx.textBaseline = 'middle';
      cx.fillText(this.fmt(pv), cw + 6, my);
    }
    cx.setLineDash([]);

    const idx = Math.min(v.i1, Math.max(v.i0, v.i0 + Math.floor(mx / stepX)));
    const c = this.candles[idx];
    if (this.ohlcEl && c) {
      const d = new Date(c.t);
      const pd = (q) => String(q).padStart(2, '0');
      let html =
        `<span style="color:#6a6458">${pd(d.getDate())}/${pd(d.getMonth() + 1)} ${pd(d.getHours())}:${pd(d.getMinutes())}</span>  ` +
        `O <b style="color:#4fc3f7">${this.fmt(c.o)}</b>  H <b style="color:#00d26a">${this.fmt(c.h)}</b>  ` +
        `L <b style="color:#ff4b3e">${this.fmt(c.l)}</b>  C <b style="color:#ffe14d">${this.fmt(c.c)}</b>`;
      if (this.opts.sma && this.ind.sma20[idx] != null) {
        html += `  <span style="color:${CHART_COLORS.sma20}">SMA20 ${this.fmt(this.ind.sma20[idx])}</span>`;
      }
      if (this.opts.sma && this.ind.sma50[idx] != null) {
        html += ` <span style="color:${CHART_COLORS.sma50}">SMA50 ${this.fmt(this.ind.sma50[idx])}</span>`;
      }
      if (this.opts.rsi && this.ind.rsi[idx] != null) {
        html += `  <span style="color:#b4a0ff">RSI ${this.ind.rsi[idx].toFixed(1)}</span>`;
      }
      this.ohlcEl.innerHTML = html;
    }
  }
}
