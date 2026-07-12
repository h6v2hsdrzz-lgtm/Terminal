/* ════════════════════════════════════════════════════════════
   chart.js — Rendu de chandeliers sur <canvas>, style terminal.
   Grille, axe des prix, axe temporel, ligne de dernier prix,
   crosshair avec lecture OHLC.
   ════════════════════════════════════════════════════════════ */
'use strict';

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
    this.PAD_R = 64;   // axe des prix
    this.PAD_B = 20;   // axe temporel
    this.PAD_T = 8;

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.draw();
    });
    canvas.addEventListener('mouseleave', () => { this.mouse = null; this.draw(); });

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
    this.draw();
  }

  /* met à jour la dernière bougie avec un tick (ou en crée une nouvelle) */
  tick(price, ts) {
    if (!this.candles.length) return;
    const step = this.period * 60000;
    const last = this.candles[this.candles.length - 1];
    if (ts - last.t >= step) {
      const t0 = last.t + Math.floor((ts - last.t) / step) * step;
      this.candles.push({ t: t0, o: price, h: price, l: price, c: price, v: 0 });
      if (this.candles.length > 500) this.candles.shift();
    } else {
      last.c = price;
      if (price > last.h) last.h = price;
      if (price < last.l) last.l = price;
    }
    this.draw();
  }

  fmt(v) { return v.toFixed(this.digits); }

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

    const cw = w - this.PAD_R, chh = h - this.PAD_B - this.PAD_T;
    const n = this.candles.length;
    const bw = Math.max(2, Math.floor(cw / n) - 1);
    const stepX = cw / n;

    let lo = Infinity, hi = -Infinity;
    for (const c of this.candles) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
    const pad = (hi - lo) * 0.06 || hi * 0.001 || 1;
    lo -= pad; hi += pad;
    const y = (v) => this.PAD_T + (hi - v) / (hi - lo) * chh;

    /* grille + axe des prix */
    cx.font = '9px monospace';
    cx.textAlign = 'left'; cx.textBaseline = 'middle';
    const nLines = Math.max(3, Math.floor(chh / 45));
    for (let i = 0; i <= nLines; i++) {
      const v = lo + (hi - lo) * i / nLines;
      const yy = y(v);
      cx.strokeStyle = '#161616'; cx.beginPath();
      cx.moveTo(0, yy); cx.lineTo(cw, yy); cx.stroke();
      cx.fillStyle = '#6a6458';
      cx.fillText(this.fmt(v), cw + 6, yy);
    }

    /* axe temporel */
    cx.textAlign = 'center'; cx.textBaseline = 'top';
    const tEvery = Math.max(1, Math.floor(n / Math.max(2, Math.floor(cw / 90))));
    for (let i = 0; i < n; i += tEvery) {
      const c = this.candles[i], x = i * stepX + stepX / 2;
      cx.strokeStyle = '#111'; cx.beginPath();
      cx.moveTo(x, this.PAD_T); cx.lineTo(x, this.PAD_T + chh); cx.stroke();
      const d = new Date(c.t);
      const lbl = this.period >= 1440
        ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      cx.fillStyle = '#6a6458';
      cx.fillText(lbl, x, this.PAD_T + chh + 6);
    }

    /* chandeliers */
    for (let i = 0; i < n; i++) {
      const c = this.candles[i];
      const x = i * stepX + stepX / 2;
      const up = c.c >= c.o;
      cx.strokeStyle = cx.fillStyle = up ? '#00d26a' : '#ff4b3e';
      cx.beginPath();
      cx.moveTo(x, y(c.h)); cx.lineTo(x, y(c.l)); cx.stroke();
      const yo = y(c.o), yc = y(c.c);
      cx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    }

    /* ligne de dernier prix */
    const last = this.candles[n - 1];
    const yl = y(last.c);
    cx.strokeStyle = '#ff9900'; cx.setLineDash([4, 3]);
    cx.beginPath(); cx.moveTo(0, yl); cx.lineTo(cw, yl); cx.stroke();
    cx.setLineDash([]);
    cx.fillStyle = '#ff9900';
    cx.fillRect(cw, yl - 7, this.PAD_R, 14);
    cx.fillStyle = '#000'; cx.textAlign = 'left'; cx.textBaseline = 'middle';
    cx.font = 'bold 9px monospace';
    cx.fillText(this.fmt(last.c), cw + 6, yl);

    /* crosshair */
    if (this.mouse && this.mouse.x < cw && this.mouse.y > this.PAD_T && this.mouse.y < this.PAD_T + chh) {
      const { x: mx, y: my } = this.mouse;
      cx.strokeStyle = 'rgba(255,255,255,.25)'; cx.setLineDash([3, 3]);
      cx.beginPath(); cx.moveTo(mx, this.PAD_T); cx.lineTo(mx, this.PAD_T + chh); cx.stroke();
      cx.beginPath(); cx.moveTo(0, my); cx.lineTo(cw, my); cx.stroke();
      cx.setLineDash([]);
      // prix au crosshair
      const pv = hi - (my - this.PAD_T) / chh * (hi - lo);
      cx.fillStyle = '#333'; cx.fillRect(cw, my - 7, this.PAD_R, 14);
      cx.fillStyle = '#fff'; cx.font = '9px monospace';
      cx.fillText(this.fmt(pv), cw + 6, my);
      // OHLC de la bougie visée
      const idx = Math.min(n - 1, Math.max(0, Math.floor(mx / stepX)));
      const c = this.candles[idx];
      if (this.ohlcEl) {
        const d = new Date(c.t);
        const pd = (x) => String(x).padStart(2, '0');
        this.ohlcEl.innerHTML =
          `<span style="color:#6a6458">${pd(d.getDate())}/${pd(d.getMonth() + 1)} ${pd(d.getHours())}:${pd(d.getMinutes())}</span>  ` +
          `O <b style="color:#4fc3f7">${this.fmt(c.o)}</b>  H <b style="color:#00d26a">${this.fmt(c.h)}</b>  ` +
          `L <b style="color:#ff4b3e">${this.fmt(c.l)}</b>  C <b style="color:#ffe14d">${this.fmt(c.c)}</b>`;
      }
    } else if (this.ohlcEl) {
      this.ohlcEl.textContent = '';
    }
  }
}
