/* ════════════════════════════════════════════════════════════
   chart.js — Graphique professionnel construit sur
   TradingView Lightweight Charts™ v5 (open source, Apache-2.0,
   voir js/vendor/LICENSE-lightweight-charts).
   Bougies / Heikin-Ashi / ligne · volume · EMA, Bollinger, VWAP,
   SuperTrend, Ichimoku · RSI, Stochastique, MACD en sous-panneaux
   · échelle log · axe en heure locale · outils de dessin
   (horizontale, tendance, Fibonacci) persistés par instrument ·
   chargement infini de l'historique · lignes de prix positions
   et alertes · légende OHLC.
   ════════════════════════════════════════════════════════════ */
'use strict';

const CH = {
  up: '#2ebd85', dn: '#f6465d',
  ema20: '#d9a441', ema50: '#4f9cf7', ema200: '#b48cf2',
  bb: 'rgba(180,160,255,.45)', vwap: '#e8e2d5',
  stUp: 'rgba(46,189,133,.9)', stDn: 'rgba(246,70,93,.9)',
  tenkan: '#4f9cf7', kijun: '#d9a441', senA: 'rgba(46,189,133,.55)', senB: 'rgba(246,70,93,.55)',
  rsi: '#d9a441', stochK: '#4f9cf7', stochD: '#d9a441',
  macd: '#4f9cf7', macdSig: '#d9a441',
  draw: '#d9a441',
  grid: '#161b22', txt: '#79828e',
};

class TerminalChart {
  constructor(container, legendEl, callbacks) {
    this.el = container;
    this.legendEl = legendEl;
    this.cb = callbacks || {};      // { onNeedHistory(oldestTs), onDrawingsChanged() }
    this.candles = [];
    this.digits = 2;
    this.symbol = '';
    this.tf = 60;
    this.opts = {
      type: 'candle', ema: true, bb: false, vwap: false, st: false, ichi: false,
      vol: true, rsi: false, stoch: false, macd: false, log: false,
    };
    this.tool = null;               // 'h' | 'trend' | 'fib'
    this._toolPts = [];
    this.drawings = [];             // [{type:'h',price} | {type:'trend'|'fib',t1,p1,t2,p2}]
    this._drawObjs = [];            // séries/pricelines à retirer
    this.priceLines = new Map();
    this.panesSeries = { rsi: [], stoch: [], macd: [] };
    this._indTimer = null;
    this._loadingHist = false;
    this.tzOff = new Date().getTimezoneOffset() * 60000; // axe en heure locale

    const LWC = LightweightCharts;
    this.chart = LWC.createChart(container, {
      layout: {
        background: { color: '#10141a' }, textColor: CH.txt,
        fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif',
        panes: { separatorColor: '#1f252e', separatorHoverColor: '#2a323d' },
        attributionLogo: true,
      },
      grid: { vertLines: { color: CH.grid }, horzLines: { color: CH.grid } },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: '#3a4450', labelBackgroundColor: '#2a323d' },
        horzLine: { color: '#3a4450', labelBackgroundColor: '#2a323d' },
      },
      rightPriceScale: { borderColor: '#1f252e' },
      timeScale: { borderColor: '#1f252e', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { locale: 'fr-FR' },
      autoSize: true,
    });

    this.price = this.chart.addSeries(LWC.CandlestickSeries, {
      upColor: CH.up, downColor: CH.dn, borderVisible: false,
      wickUpColor: CH.up, wickDownColor: CH.dn,
    });
    this.line = this.chart.addSeries(LWC.LineSeries, { color: CH.ema20, lineWidth: 2, visible: false });
    this.volume = this.chart.addSeries(LWC.HistogramSeries, {
      priceScaleId: 'vol', priceFormat: { type: 'volume' },
    });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const mkLine = (color, w = 1, dashed = false) => this.chart.addSeries(LWC.LineSeries, {
      color, lineWidth: w, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, visible: false,
      lineStyle: dashed ? LWC.LineStyle.Dashed : LWC.LineStyle.Solid,
    });
    this.ema20 = mkLine(CH.ema20); this.ema50 = mkLine(CH.ema50); this.ema200 = mkLine(CH.ema200);
    this.bbUp = mkLine(CH.bb); this.bbLo = mkLine(CH.bb);
    this.vwapS = mkLine(CH.vwap, 1, true);
    this.stUp = mkLine(CH.stUp, 2); this.stDn = mkLine(CH.stDn, 2);
    this.tenkan = mkLine(CH.tenkan); this.kijun = mkLine(CH.kijun);
    this.senA = mkLine(CH.senA, 1, true); this.senB = mkLine(CH.senB, 1, true);

    this.chart.subscribeCrosshairMove((p) => this._legend(p));
    // clics natifs pour le dessin : subscribeClick de LWC ignore le second
    // clic d'une paire rapprochée (fenêtre anti double-clic)
    this.el.addEventListener('click', (e) => this._onNativeClick(e));
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (!r || r.from > 8 || this._loadingHist || !this.candles.length || !this.cb.onNeedHistory) return;
      this._loadingHist = true;
      Promise.resolve(this.cb.onNeedHistory(this.candles[0].t))
        .finally(() => setTimeout(() => { this._loadingHist = false; }, 800));
    });
  }

  _t(ms) { return Math.floor((ms - this.tzOff) / 1000); }
  _ms(t) { return t * 1000 + this.tzOff; }
  fmt(v) { return v == null ? '—' : Number(v).toFixed(this.digits); }

  /* ─────────────── données ─────────────── */

  setData(symbol, tf, digits, candles, drawings) {
    this.symbol = symbol; this.tf = tf; this.digits = digits;
    this.candles = candles;
    const pf = { type: 'price', precision: digits, minMove: Math.pow(10, -digits) };
    this.price.applyOptions({ priceFormat: pf });
    this.line.applyOptions({ priceFormat: pf });
    this._clearDrawObjs();
    this.drawings = drawings || [];
    this._render();
    this._applyDrawings();
    this.chart.timeScale().fitContent();
  }

  prependCandles(older) {
    if (!older.length) return;
    const first = this.candles[0].t;
    const add = older.filter((c) => c.t < first);
    if (!add.length) return;
    this.candles = [...add, ...this.candles];
    this._render();
  }

  tick(price, ts) {
    if (!this.candles.length) return;
    const step = this.tf * 60000;
    const last = this.candles[this.candles.length - 1];
    if (ts - last.t >= step) {
      const t0 = last.t + Math.floor((ts - last.t) / step) * step;
      this.candles.push({ t: t0, o: price, h: price, l: price, c: price, v: 0 });
    } else {
      last.c = price;
      if (price > last.h) last.h = price;
      if (price < last.l) last.l = price;
    }
    this._updateLast();
    if (!this._indTimer) {
      this._indTimer = setTimeout(() => { this._indTimer = null; this._indicators(); }, 900);
    }
  }

  _display() {
    return this.opts.type === 'heikin' ? TA.heikinAshi(this.candles) : this.candles;
  }

  _updateLast() {
    const disp = this._display();
    const c = disp[disp.length - 1];
    const time = this._t(c.t);
    if (this.opts.type === 'line') this.line.update({ time, value: c.c });
    else this.price.update({ time, open: c.o, high: c.h, low: c.l, close: c.c });
    if (this.opts.vol) {
      this.volume.update({ time, value: c.v, color: c.c >= c.o ? 'rgba(46,189,133,.35)' : 'rgba(246,70,93,.35)' });
    }
  }

  _render() {
    const disp = this._display();
    const isLine = this.opts.type === 'line';
    this.price.applyOptions({ visible: !isLine });
    this.line.applyOptions({ visible: isLine });
    if (isLine) {
      this.line.setData(disp.map((c) => ({ time: this._t(c.t), value: c.c })));
      this.price.setData([]);
    } else {
      this.price.setData(disp.map((c) => ({ time: this._t(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
      this.line.setData([]);
    }
    this.volume.applyOptions({ visible: this.opts.vol });
    this.volume.setData(this.opts.vol ? disp.map((c) => ({
      time: this._t(c.t), value: c.v,
      color: c.c >= c.o ? 'rgba(46,189,133,.35)' : 'rgba(246,70,93,.35)',
    })) : []);
    this._indicators();
  }

  /* ─────────────── indicateurs ─────────────── */

  _setLineData(series, arr, visible) {
    series.applyOptions({ visible: !!visible });
    if (!visible) { series.setData([]); return; }
    const data = [];
    for (let i = 0; i < this.candles.length; i++) {
      if (arr[i] != null) data.push({ time: this._t(this.candles[i].t), value: arr[i] });
    }
    series.setData(data);
  }

  _indicators() {
    const closes = this.candles.map((c) => c.c);
    this._setLineData(this.ema20, this.opts.ema ? TA.ema(closes, 20) : [], this.opts.ema);
    this._setLineData(this.ema50, this.opts.ema ? TA.ema(closes, 50) : [], this.opts.ema);
    this._setLineData(this.ema200, this.opts.ema ? TA.ema(closes, 200) : [], this.opts.ema);

    if (this.opts.bb) {
      const bb = TA.bollinger(closes);
      this._setLineData(this.bbUp, bb.up, true);
      this._setLineData(this.bbLo, bb.lo, true);
    } else { this._setLineData(this.bbUp, [], false); this._setLineData(this.bbLo, [], false); }

    this._setLineData(this.vwapS, this.opts.vwap ? TA.vwap(this.candles) : [], this.opts.vwap);

    /* SuperTrend : deux séries (verte/rouge) avec trous whitespace */
    if (this.opts.st && this.candles.length > 12) {
      const st = TA.supertrend(this.candles);
      const up = [], dn = [];
      for (let i = 0; i < this.candles.length; i++) {
        const time = this._t(this.candles[i].t);
        if (st.line[i] == null) { up.push({ time }); dn.push({ time }); continue; }
        if (st.dir[i] === 1) { up.push({ time, value: st.line[i] }); dn.push({ time }); }
        else { dn.push({ time, value: st.line[i] }); up.push({ time }); }
      }
      this.stUp.applyOptions({ visible: true }); this.stDn.applyOptions({ visible: true });
      this.stUp.setData(up); this.stDn.setData(dn);
    } else {
      this.stUp.applyOptions({ visible: false }); this.stDn.applyOptions({ visible: false });
      this.stUp.setData([]); this.stDn.setData([]);
    }

    /* Ichimoku : tenkan/kijun + nuage (senkou décalés de 26 bougies) */
    if (this.opts.ichi && this.candles.length > 55) {
      const ic = TA.ichimoku(this.candles);
      this._setLineData(this.tenkan, ic.tenkan, true);
      this._setLineData(this.kijun, ic.kijun, true);
      const step = this.tf * 60000;
      const shiftTime = (i) => {
        const j = i + ic.shift;
        return j < this.candles.length
          ? this._t(this.candles[j].t)
          : this._t(this.candles[this.candles.length - 1].t + (j - this.candles.length + 1) * step);
      };
      const mk = (arr) => {
        const out = [];
        for (let i = 0; i < this.candles.length; i++) {
          if (arr[i] != null) out.push({ time: shiftTime(i), value: arr[i] });
        }
        return out;
      };
      this.senA.applyOptions({ visible: true }); this.senB.applyOptions({ visible: true });
      this.senA.setData(mk(ic.senkouA)); this.senB.setData(mk(ic.senkouB));
    } else {
      for (const s of [this.tenkan, this.kijun, this.senA, this.senB]) { s.applyOptions({ visible: false }); s.setData([]); }
    }

    this._pane('rsi'); this._pane('stoch'); this._pane('macd');
  }

  /* sous-panneaux créés/détruits à la demande (le panneau vide disparaît) */
  _pane(kind) {
    const LWC = LightweightCharts;
    const on = this.opts[kind];
    const refs = this.panesSeries[kind];
    if (!on) {
      for (const s of refs) { try { this.chart.removeSeries(s); } catch {} }
      this.panesSeries[kind] = [];
      return;
    }
    const time = (i) => this._t(this.candles[i].t);
    if (kind === 'rsi') {
      if (!refs.length) {
        const s = this.chart.addSeries(LWC.LineSeries, {
          color: CH.rsi, lineWidth: 1,
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 }, priceLineVisible: false,
        }, this.chart.panes().length);
        s.createPriceLine({ price: 30, color: '#2a323d', lineStyle: 2, axisLabelVisible: false });
        s.createPriceLine({ price: 70, color: '#2a323d', lineStyle: 2, axisLabelVisible: false });
        this.panesSeries.rsi = [s];
        const pane = this.chart.panes()[this.chart.panes().length - 1];
        if (pane) pane.setHeight(88);
      }
      const rsi = TA.rsi(this.candles.map((c) => c.c));
      const data = [];
      for (let i = 0; i < this.candles.length; i++) if (rsi[i] != null) data.push({ time: time(i), value: rsi[i] });
      this.panesSeries.rsi[0].setData(data);
    } else if (kind === 'stoch') {
      if (!refs.length) {
        const idx = this.chart.panes().length;
        const k = this.chart.addSeries(LWC.LineSeries, { color: CH.stochK, lineWidth: 1, priceFormat: { type: 'price', precision: 1, minMove: 0.1 }, priceLineVisible: false }, idx);
        const d = this.chart.addSeries(LWC.LineSeries, { color: CH.stochD, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, idx);
        k.createPriceLine({ price: 20, color: '#2a323d', lineStyle: 2, axisLabelVisible: false });
        k.createPriceLine({ price: 80, color: '#2a323d', lineStyle: 2, axisLabelVisible: false });
        this.panesSeries.stoch = [k, d];
        const pane = this.chart.panes()[idx];
        if (pane) pane.setHeight(88);
      }
      const st = TA.stoch(this.candles);
      const dk = [], dd = [];
      for (let i = 0; i < this.candles.length; i++) {
        if (st.k[i] != null) dk.push({ time: time(i), value: st.k[i] });
        if (st.d[i] != null) dd.push({ time: time(i), value: st.d[i] });
      }
      this.panesSeries.stoch[0].setData(dk);
      this.panesSeries.stoch[1].setData(dd);
    } else if (kind === 'macd') {
      if (!refs.length) {
        const idx = this.chart.panes().length;
        const pf = { type: 'price', precision: this.digits, minMove: Math.pow(10, -this.digits) };
        const h = this.chart.addSeries(LWC.HistogramSeries, { priceFormat: pf, priceLineVisible: false, lastValueVisible: false }, idx);
        const l = this.chart.addSeries(LWC.LineSeries, { color: CH.macd, lineWidth: 1, priceFormat: pf, priceLineVisible: false, lastValueVisible: false }, idx);
        const g = this.chart.addSeries(LWC.LineSeries, { color: CH.macdSig, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, idx);
        this.panesSeries.macd = [h, l, g];
        const pane = this.chart.panes()[idx];
        if (pane) pane.setHeight(88);
      }
      const m = TA.macd(this.candles.map((c) => c.c));
      const dh = [], dl = [], dg = [];
      for (let i = 0; i < this.candles.length; i++) {
        const tm = time(i);
        if (m.hist[i] != null) dh.push({ time: tm, value: m.hist[i], color: m.hist[i] >= 0 ? 'rgba(46,189,133,.5)' : 'rgba(246,70,93,.5)' });
        if (m.line[i] != null) dl.push({ time: tm, value: m.line[i] });
        if (m.signal[i] != null) dg.push({ time: tm, value: m.signal[i] });
      }
      this.panesSeries.macd[0].setData(dh);
      this.panesSeries.macd[1].setData(dl);
      this.panesSeries.macd[2].setData(dg);
    }
  }

  setOpt(key, val) {
    if (key === 'type') this.opts.type = val;
    else if (key === 'log') {
      this.opts.log = val != null ? val : !this.opts.log;
      this.chart.priceScale('right').applyOptions({
        mode: this.opts.log ? LightweightCharts.PriceScaleMode.Logarithmic : LightweightCharts.PriceScaleMode.Normal,
      });
      return;
    } else this.opts[key] = val != null ? val : !this.opts[key];
    this._render();
  }

  fit() { this.chart.timeScale().fitContent(); }

  /* ─────────────── outils de dessin ─────────────── */

  setTool(tool) {
    this.tool = this.tool === tool ? null : tool;
    this._toolPts = [];
    this.el.style.cursor = this.tool ? 'copy' : 'crosshair';
    return this.tool;
  }

  _onNativeClick(e) {
    if (!this.tool || !this.candles.length) return;
    const rect = this.el.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    // seulement le panneau principal (les sous-panneaux sont en dessous)
    const pane0 = this.chart.panes()[0];
    if (pane0 && y > pane0.getHeight()) return;
    const price = this.price.coordinateToPrice(y);
    if (price == null) return;
    if (this.tool === 'h') {
      this.drawings.push({ type: 'h', price });
      this._finishDraw();
      return;
    }
    let time = this.chart.timeScale().coordinateToTime(x);
    if (time == null) {
      // clic dans la marge droite : accroche à la dernière bougie
      time = this._t(this.candles[this.candles.length - 1].t);
    }
    this._toolPts.push({ t: this._ms(time), p: price });
    if (this._toolPts.length === 2) {
      const [a, b] = this._toolPts;
      this.drawings.push({ type: this.tool, t1: a.t, p1: a.p, t2: b.t, p2: b.p });
      this._finishDraw();
    }
  }

  _finishDraw() {
    this._toolPts = [];
    this.tool = null;
    this.el.style.cursor = 'crosshair';
    this._applyDrawings();
    if (this.cb.onDrawingsChanged) this.cb.onDrawingsChanged(this.drawings);
    if (this.cb.onToolDone) this.cb.onToolDone();
  }

  clearDrawings() {
    this.drawings = [];
    this._applyDrawings();
    if (this.cb.onDrawingsChanged) this.cb.onDrawingsChanged(this.drawings);
  }

  _clearDrawObjs() {
    for (const o of this._drawObjs) {
      try { o.series ? this.chart.removeSeries(o.series) : this.price.removePriceLine(o.line); } catch {}
    }
    this._drawObjs = [];
  }

  _applyDrawings() {
    const LWC = LightweightCharts;
    this._clearDrawObjs();
    const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    for (const d of this.drawings) {
      if (d.type === 'h') {
        this._drawObjs.push({
          line: this.price.createPriceLine({
            price: d.price, color: CH.draw, lineWidth: 1, lineStyle: 0,
            axisLabelVisible: true, title: '—',
          }),
        });
      } else if (d.type === 'trend') {
        const s = this.chart.addSeries(LWC.LineSeries, {
          color: CH.draw, lineWidth: 2, priceLineVisible: false,
          lastValueVisible: false, crosshairMarkerVisible: false,
        });
        const pts = [{ time: this._t(d.t1), value: d.p1 }, { time: this._t(d.t2), value: d.p2 }]
          .sort((a, b) => a.time - b.time);
        if (pts[0].time === pts[1].time) pts[1].time += this.tf * 60;
        s.setData(pts);
        this._drawObjs.push({ series: s });
      } else if (d.type === 'fib') {
        const hi = Math.max(d.p1, d.p2), lo = Math.min(d.p1, d.p2);
        for (const f of FIB) {
          const price = hi - (hi - lo) * f;
          this._drawObjs.push({
            line: this.price.createPriceLine({
              price, color: f === 0 || f === 1 ? CH.draw : 'rgba(217,164,65,.45)',
              lineWidth: 1, lineStyle: f === 0 || f === 1 ? 0 : 2,
              axisLabelVisible: false, title: 'fib ' + f,
            }),
          });
        }
      }
    }
  }

  /* ─────────────── lignes de prix (positions / alertes) ─────────────── */

  setPriceLine(key, price, color, title, style) {
    this.removePriceLine(key);
    this.priceLines.set(key, {
      line: this.price.createPriceLine({
        price, color, lineStyle: style != null ? style : 2, lineWidth: 1,
        axisLabelVisible: true, title,
      }),
    });
  }
  removePriceLine(key) {
    const pl = this.priceLines.get(key);
    if (pl) { try { this.price.removePriceLine(pl.line); } catch {} this.priceLines.delete(key); }
  }
  clearPriceLines(prefix) {
    for (const key of [...this.priceLines.keys()]) {
      if (key.startsWith(prefix)) this.removePriceLine(key);
    }
  }

  /* ─────────────── légende ─────────────── */

  _legend(p) {
    if (!this.legendEl) return;
    let c = null;
    const disp = this._display();
    if (p && p.time != null && disp.length) {
      c = disp.find((x) => this._t(x.t) === p.time) || null;
    }
    if (!c) c = disp[disp.length - 1];
    if (!c) { this.legendEl.textContent = ''; return; }
    const chg = (c.c - c.o) / c.o * 100;
    this.legendEl.innerHTML =
      `O <b>${this.fmt(c.o)}</b>  H <b class="up">${this.fmt(c.h)}</b>  ` +
      `L <b class="dn">${this.fmt(c.l)}</b>  C <b>${this.fmt(c.c)}</b>  ` +
      `<b class="${chg >= 0 ? 'up' : 'dn'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</b>` +
      (c.v ? `  <span>Vol ${Number(c.v).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</span>` : '');
  }
}
