/* ════════════════════════════════════════════════════════════
   chart.js — Graphique professionnel construit sur
   TradingView Lightweight Charts™ v5 (open source, Apache-2.0,
   voir js/vendor/LICENSE-lightweight-charts).
   Bougies / Heikin-Ashi / ligne, volume, EMA 20-50-200,
   Bollinger, VWAP, RSI et MACD en sous-panneaux, échelle log,
   lignes de prix pour positions et alertes, légende OHLC.
   ════════════════════════════════════════════════════════════ */
'use strict';

const CH = {
  up: '#2ebd85', dn: '#f6465d',
  ema20: '#d9a441', ema50: '#4f9cf7', ema200: '#b48cf2',
  bb: 'rgba(180,160,255,.45)', vwap: '#e8e2d5',
  vol: 'rgba(120,130,145,.45)',
  rsi: '#d9a441', macd: '#4f9cf7', macdSig: '#d9a441',
  grid: '#161b22', txt: '#79828e',
};

class TerminalChart {
  constructor(container, legendEl) {
    this.el = container;
    this.legendEl = legendEl;
    this.candles = [];
    this.digits = 2;
    this.symbol = '';
    this.tf = 60;
    this.opts = { type: 'candle', ema: true, bb: false, vwap: false, vol: true, rsi: false, macd: false, log: false };
    this.priceLines = new Map();   // key -> priceLine
    this._indTimer = null;

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
      priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: CH.vol,
    });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const mkLine = (color, w = 1) => this.chart.addSeries(LWC.LineSeries, {
      color, lineWidth: w, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, visible: false,
    });
    this.ema20 = mkLine(CH.ema20, 1); this.ema50 = mkLine(CH.ema50, 1); this.ema200 = mkLine(CH.ema200, 1);
    this.bbUp = mkLine(CH.bb); this.bbLo = mkLine(CH.bb);
    this.vwapS = mkLine(CH.vwap, 1);

    // sous-panneaux (créés à la demande)
    this.rsiS = null; this.rsi30 = null; this.rsi70 = null;
    this.macdH = null; this.macdL = null; this.macdSg = null;

    this.chart.subscribeCrosshairMove((p) => this._legend(p));
  }

  _t(ms) { return Math.floor(ms / 1000); }

  fmt(v) { return v == null ? '—' : Number(v).toFixed(this.digits); }

  setData(symbol, tf, digits, candles) {
    this.symbol = symbol; this.tf = tf; this.digits = digits;
    this.candles = candles;
    this.price.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) } });
    this.line.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) } });
    this._render();
    this.chart.timeScale().fitContent();
  }

  tick(price, ts) {
    if (!this.candles.length) return;
    const step = this.tf * 60000;
    const last = this.candles[this.candles.length - 1];
    if (ts - last.t >= step) {
      const t0 = last.t + Math.floor((ts - last.t) / step) * step;
      this.candles.push({ t: t0, o: price, h: price, l: price, c: price, v: 0 });
      if (this.candles.length > 600) this.candles.shift();
    } else {
      last.c = price;
      if (price > last.h) last.h = price;
      if (price < last.l) last.l = price;
    }
    this._updateLast();
    // recalcul des indicateurs, throttlé
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
    const bar = { time: this._t(c.t), open: c.o, high: c.h, low: c.l, close: c.c };
    if (this.opts.type === 'line') this.line.update({ time: bar.time, value: c.c });
    else this.price.update(bar);
    if (this.opts.vol) {
      this.volume.update({
        time: bar.time, value: c.v,
        color: c.c >= c.o ? 'rgba(46,189,133,.35)' : 'rgba(246,70,93,.35)',
      });
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
    this._rsiPane();
    this._macdPane();
  }

  _rsiPane() {
    const LWC = LightweightCharts;
    if (this.opts.rsi && !this.rsiS) {
      this.rsiS = this.chart.addSeries(LWC.LineSeries, {
        color: CH.rsi, lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      }, 1);
      const pane = this.chart.panes()[1];
      if (pane) pane.setHeight(90);
    }
    if (this.rsiS) {
      if (this.opts.rsi) {
        const rsi = TA.rsi(this.candles.map((c) => c.c));
        const data = [];
        for (let i = 0; i < this.candles.length; i++) {
          if (rsi[i] != null) data.push({ time: this._t(this.candles[i].t), value: rsi[i] });
        }
        this.rsiS.setData(data);
        this.rsiS.applyOptions({ visible: true });
        if (!this.rsi30 && data.length) {
          this.rsi30 = this.rsiS.createPriceLine({ price: 30, color: '#2a323d', lineStyle: 2, axisLabelVisible: false });
          this.rsi70 = this.rsiS.createPriceLine({ price: 70, color: '#2a323d', lineStyle: 2, axisLabelVisible: false });
        }
      } else {
        this.rsiS.setData([]); this.rsiS.applyOptions({ visible: false });
      }
    }
  }

  _macdPane() {
    const LWC = LightweightCharts;
    if (this.opts.macd && !this.macdH) {
      const paneIdx = this.opts.rsi ? 2 : 1;
      this.macdH = this.chart.addSeries(LWC.HistogramSeries, {
        priceLineVisible: false, lastValueVisible: false,
        priceFormat: { type: 'price', precision: this.digits, minMove: Math.pow(10, -this.digits) },
      }, paneIdx);
      this.macdL = this.chart.addSeries(LWC.LineSeries, { color: CH.macd, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIdx);
      this.macdSg = this.chart.addSeries(LWC.LineSeries, { color: CH.macdSig, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIdx);
      const pane = this.chart.panes()[paneIdx];
      if (pane) pane.setHeight(90);
    }
    if (this.macdH) {
      if (this.opts.macd) {
        const m = TA.macd(this.candles.map((c) => c.c));
        const hist = [], line = [], sig = [];
        for (let i = 0; i < this.candles.length; i++) {
          const time = this._t(this.candles[i].t);
          if (m.hist[i] != null) hist.push({ time, value: m.hist[i], color: m.hist[i] >= 0 ? 'rgba(46,189,133,.5)' : 'rgba(246,70,93,.5)' });
          if (m.line[i] != null) line.push({ time, value: m.line[i] });
          if (m.signal[i] != null) sig.push({ time, value: m.signal[i] });
        }
        this.macdH.setData(hist); this.macdL.setData(line); this.macdSg.setData(sig);
        [this.macdH, this.macdL, this.macdSg].forEach((s) => s.applyOptions({ visible: true }));
      } else {
        [this.macdH, this.macdL, this.macdSg].forEach((s) => { s.setData([]); s.applyOptions({ visible: false }); });
      }
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

  /* lignes de prix : positions et alertes */
  setPriceLine(key, price, color, title, style) {
    this.removePriceLine(key);
    const series = this.opts.type === 'line' ? this.line : this.price;
    this.priceLines.set(key, {
      series,
      line: series.createPriceLine({
        price, color, lineStyle: style != null ? style : 2, lineWidth: 1,
        axisLabelVisible: true, title,
      }),
    });
  }
  removePriceLine(key) {
    const pl = this.priceLines.get(key);
    if (pl) { try { pl.series.removePriceLine(pl.line); } catch {} this.priceLines.delete(key); }
  }
  clearPriceLines(prefix) {
    for (const key of [...this.priceLines.keys()]) {
      if (key.startsWith(prefix)) this.removePriceLine(key);
    }
  }

  _legend(p) {
    if (!this.legendEl) return;
    let c = null;
    if (p && p.time && this.candles.length) {
      const t = p.time * 1000;
      c = this.candles.find((x) => x.t === t) || null;
      if (c && this.opts.type === 'heikin') {
        const ha = TA.heikinAshi(this.candles);
        c = ha.find((x) => x.t === t) || c;
      }
    }
    if (!c) c = this._display()[this.candles.length - 1];
    if (!c) { this.legendEl.textContent = ''; return; }
    const chg = (c.c - c.o) / c.o * 100;
    this.legendEl.innerHTML =
      `O <b>${this.fmt(c.o)}</b>  H <b class="up">${this.fmt(c.h)}</b>  ` +
      `L <b class="dn">${this.fmt(c.l)}</b>  C <b>${this.fmt(c.c)}</b>  ` +
      `<b class="${chg >= 0 ? 'up' : 'dn'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</b>` +
      (c.v ? `  <span>Vol ${Number(c.v).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</span>` : '');
  }
}
