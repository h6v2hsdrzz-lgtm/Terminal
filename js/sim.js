/* ════════════════════════════════════════════════════════════
   sim.js — Client simulé (aucune connexion réseau).
   Même interface que XApiClient : permet de tester le terminal
   sans compte XTB, avec des prix en marche aléatoire.
   ════════════════════════════════════════════════════════════ */
'use strict';

const SIM_SYMBOLS = {
  'EURUSD':  { price: 1.0872,  digits: 5, desc: 'Euro / US Dollar',            cat: 'FX',    contract: 100000, currency: 'USD', leverage: 3.33, lotMin: 0.01, lotStep: 0.01, spreadPts: 9 },
  'GBPUSD':  { price: 1.2755,  digits: 5, desc: 'Pound Sterling / US Dollar',  cat: 'FX',    contract: 100000, currency: 'USD', leverage: 3.33, lotMin: 0.01, lotStep: 0.01, spreadPts: 13 },
  'USDJPY':  { price: 156.42,  digits: 3, desc: 'US Dollar / Japanese Yen',    cat: 'FX',    contract: 100000, currency: 'JPY', leverage: 3.33, lotMin: 0.01, lotStep: 0.01, spreadPts: 12 },
  'GOLD':    { price: 2632.50, digits: 2, desc: 'Gold (spot) CFD',             cat: 'CMD',   contract: 100,    currency: 'USD', leverage: 5,    lotMin: 0.01, lotStep: 0.01, spreadPts: 35 },
  'SILVER':  { price: 30.85,   digits: 3, desc: 'Silver (spot) CFD',           cat: 'CMD',   contract: 5000,   currency: 'USD', leverage: 10,   lotMin: 0.01, lotStep: 0.01, spreadPts: 25 },
  'OIL.WTI': { price: 71.34,   digits: 2, desc: 'Crude Oil WTI CFD',           cat: 'CMD',   contract: 1000,   currency: 'USD', leverage: 10,   lotMin: 0.01, lotStep: 0.01, spreadPts: 4 },
  'US500':   { price: 6021.4,  digits: 1, desc: 'S&P 500 Index CFD',           cat: 'IND',   contract: 50,     currency: 'USD', leverage: 5,    lotMin: 0.01, lotStep: 0.01, spreadPts: 5 },
  'US100':   { price: 21580.2, digits: 1, desc: 'Nasdaq 100 Index CFD',        cat: 'IND',   contract: 20,     currency: 'USD', leverage: 5,    lotMin: 0.01, lotStep: 0.01, spreadPts: 12 },
  'US30':    { price: 44210.0, digits: 1, desc: 'Dow Jones 30 Index CFD',      cat: 'IND',   contract: 5,      currency: 'USD', leverage: 5,    lotMin: 0.01, lotStep: 0.01, spreadPts: 20 },
  'DE40':    { price: 20345.5, digits: 1, desc: 'DAX 40 Index CFD',            cat: 'IND',   contract: 25,     currency: 'EUR', leverage: 5,    lotMin: 0.01, lotStep: 0.01, spreadPts: 12 },
  'BITCOIN': { price: 97350,   digits: 1, desc: 'Bitcoin CFD',                 cat: 'CRT',   contract: 1,      currency: 'USD', leverage: 2,    lotMin: 0.01, lotStep: 0.01, spreadPts: 350 },
  'ETHEREUM':{ price: 3420.5,  digits: 2, desc: 'Ethereum CFD',                cat: 'CRT',   contract: 1,      currency: 'USD', leverage: 2,    lotMin: 0.01, lotStep: 0.01, spreadPts: 180 },
};

const SIM_NEWS = [
  'FED: POWELL SIGNALS PATIENCE ON RATE CUTS AMID STICKY INFLATION',
  'ECB CUTS DEPOSIT RATE 25BP TO 2.00%, SEES GRADUAL EASING PATH',
  'GOLD HITS RECORD HIGH AS CENTRAL BANK BUYING ACCELERATES',
  'OPEC+ EXTENDS OUTPUT CUTS THROUGH Q4, OIL RALLIES',
  'US NONFARM PAYROLLS BEAT ESTIMATES; DOLLAR FIRMS',
  'DAX AT ALL-TIME HIGH ON DEFENSE AND AUTOS STRENGTH',
  'BITCOIN ETF INFLOWS TOP $2BN FOR THE WEEK',
  'CHINA UNVEILS FRESH STIMULUS; COMMODITIES BID',
];

const SIM_CALENDAR = [
  { country: 'US', title: 'CPI YoY',                 impact: '3', period: 'Jun', previous: '2.4%',  forecast: '2.5%',  offsetH: 3 },
  { country: 'EU', title: 'ECB Rate Decision',       impact: '3', period: '',    previous: '2.00%', forecast: '2.00%', offsetH: 7 },
  { country: 'US', title: 'Initial Jobless Claims',  impact: '2', period: 'Wk',  previous: '224K',  forecast: '230K',  offsetH: 20 },
  { country: 'DE', title: 'Ifo Business Climate',    impact: '2', period: 'Jul', previous: '88.4',  forecast: '88.9',  offsetH: 26 },
  { country: 'GB', title: 'Retail Sales MoM',        impact: '2', period: 'Jun', previous: '-0.3%', forecast: '0.2%',  offsetH: 31 },
  { country: 'US', title: 'FOMC Member Speech',      impact: '1', period: '',    previous: '',      forecast: '',      offsetH: 45 },
];

class SimClient {
  constructor() {
    this.mode = 'sim';
    this.sessionId = 'SIM';
    this.latency = 1;
    this._closed = [];
    this._handlers = new Map();
    this._timers = [];
    this.onDisconnect = null;
    this._orderSeq = 500000;
    this._state = {};
    for (const [s, d] of Object.entries(SIM_SYMBOLS)) {
      this._state[s] = { bid: d.price, spread: d.spreadPts / Math.pow(10, d.digits) };
    }
    this._balance = 10000;
    this._trades = [];
    // deux positions d'exemple
    this._openTrade('GOLD', XAPI_CMD.BUY, 0.10, this._ask('GOLD') - 8.2);
    this._openTrade('US500', XAPI_CMD.SELL, 0.20, this._bid('US500') + 14.5);
  }

  _bid(s) { return this._state[s].bid; }
  _ask(s) { return this._state[s].bid + this._state[s].spread; }

  connect() { return Promise.resolve(); }
  async login() { return this.sessionId; }

  connectStream() {
    // ticks : marche aléatoire
    this._timers.push(setInterval(() => {
      for (const [s, d] of Object.entries(SIM_SYMBOLS)) {
        if (Math.random() > 0.55) continue;
        const st = this._state[s];
        const vol = d.price * 0.00018;
        st.bid = Math.max(d.price * 0.5, st.bid + (Math.random() - 0.5) * 2 * vol);
        this._emit('tickPrices', {
          symbol: s, bid: st.bid, ask: st.bid + st.spread,
          high: st.bid * 1.004, low: st.bid * 0.996,
          timestamp: Date.now(), level: 0,
        });
      }
      this._pushProfits();
    }, 700));
    // balance
    this._timers.push(setInterval(() => this._emitBalance(), 2000));
    // news périodiques
    let n = 0;
    this._timers.push(setInterval(() => {
      this._emit('news', { time: Date.now(), title: SIM_NEWS[n++ % SIM_NEWS.length], body: 'Simulation — dépêche générée localement à titre de démonstration.', key: 'sim' + n });
    }, 45000));
    return Promise.resolve();
  }

  subscribe() {}
  onStream(command, fn) { this._handlers.set(command, fn); }
  _emit(cmd, data) { const h = this._handlers.get(cmd); if (h) h(data); }

  _profitOf(t) {
    const d = SIM_SYMBOLS[t.symbol];
    const cur = t.cmd === XAPI_CMD.BUY ? this._bid(t.symbol) : this._ask(t.symbol);
    return (cur - t.open_price) * (t.cmd === XAPI_CMD.BUY ? 1 : -1) * t.volume * d.contract;
  }
  _pushProfits() {
    for (const t of this._trades) {
      t.profit = this._profitOf(t);
      this._emit('profit', { order: t.order, order2: t.order2, position: t.position, profit: t.profit });
    }
  }
  _emitBalance() {
    const pl = this._trades.reduce((a, t) => a + this._profitOf(t), 0);
    const margin = this._trades.reduce((a, t) => {
      const d = SIM_SYMBOLS[t.symbol];
      return a + t.open_price * t.volume * d.contract / (d.leverage * 10);
    }, 0);
    const equity = this._balance + pl;
    this._emit('balance', {
      balance: this._balance, equity, margin,
      marginFree: equity - margin,
      marginLevel: margin > 0 ? equity / margin * 100 : 0,
      credit: 0,
    });
  }

  _openTrade(symbol, cmd, volume, price, sl, tp) {
    const o = ++this._orderSeq;
    const t = {
      order: o, order2: o, position: o, symbol, cmd, volume,
      open_price: price, open_time: Date.now(),
      sl: sl || 0, tp: tp || 0, profit: 0, closed: false, digits: SIM_SYMBOLS[symbol].digits,
    };
    this._trades.push(t);
    return t;
  }

  /* ── API "commandes" ── */
  async getSymbol(symbol) {
    const d = SIM_SYMBOLS[symbol];
    if (!d) throw new Error(`SE009: symbole ${symbol} inconnu (simulation)`);
    return {
      symbol, bid: this._bid(symbol), ask: this._ask(symbol),
      digits: d.digits, description: d.desc, categoryName: d.cat,
      contractSize: d.contract, currency: d.currency, currencyProfit: d.currency,
      leverage: d.leverage, lotMin: d.lotMin, lotMax: 100, lotStep: d.lotStep,
      spreadRaw: this._state[symbol].spread, swapLong: -d.price * 0.00002, swapShort: -d.price * 0.00001,
      time: Date.now(),
    };
  }
  async getMarginLevel() {
    const pl = this._trades.reduce((a, t) => a + this._profitOf(t), 0);
    return { balance: this._balance, equity: this._balance + pl, margin: 0, margin_free: this._balance + pl, margin_level: 0, currency: 'EUR', credit: 0 };
  }
  async getTrades() { return this._trades.map(t => Object.assign({}, t)); }
  async getNews() {
    const now = Date.now();
    return SIM_NEWS.map((title, i) => ({
      time: now - (i + 1) * 3600e3 * 2.7, title,
      body: 'Simulation — dépêche générée localement à titre de démonstration. En mode DÉMO ou RÉEL, les actualités proviennent du flux XTB.',
      key: 'sim-hist-' + i,
    }));
  }
  async getChart(symbol, period, startMs) {
    const d = SIM_SYMBOLS[symbol];
    if (!d) throw new Error(`SE009: symbole ${symbol} inconnu (simulation)`);
    const step = period * 60000;
    const n = Math.min(400, Math.max(60, Math.floor((Date.now() - startMs) / step)));
    const out = [];
    let p = this._bid(symbol);
    const vol = d.price * (0.0009 + period / 1440 * 0.006);
    // génération à rebours depuis le prix actuel
    let t = Date.now() - (Date.now() % step);
    const rev = [];
    for (let i = 0; i < n; i++) {
      const c = p;
      const o = p + (Math.random() - 0.5) * 2 * vol;
      const h = Math.max(o, c) + Math.random() * vol * 0.6;
      const l = Math.min(o, c) - Math.random() * vol * 0.6;
      rev.push({ t, o, h, l, c, v: Math.round(100 + Math.random() * 900) });
      p = o; t -= step;
    }
    for (let i = rev.length - 1; i >= 0; i--) out.push(rev[i]);
    return out;
  }
  async tradeTransaction(info) {
    if (info.type === XAPI_TYPE.OPEN) {
      const price = info.cmd === XAPI_CMD.BUY ? this._ask(info.symbol) : this._bid(info.symbol);
      const t = this._openTrade(info.symbol, info.cmd, info.volume, price, info.sl, info.tp);
      this._emit('trade', Object.assign({ state: 'Modified', type: 0 }, t));
      this._emitBalance();
      return { order: t.order };
    }
    if (info.type === XAPI_TYPE.CLOSE) {
      const i = this._trades.findIndex(t => t.order === info.order);
      if (i < 0) throw new Error('SE199: position introuvable');
      const t = this._trades[i];
      const profit = this._profitOf(t);
      this._balance += profit;
      this._trades.splice(i, 1);
      this._closed.unshift(Object.assign({}, t, {
        closed: true, profit,
        close_price: t.cmd === XAPI_CMD.BUY ? this._bid(t.symbol) : this._ask(t.symbol),
        close_time: Date.now(),
      }));
      this._emit('trade', Object.assign({}, t, { closed: true, state: 'Deleted' }));
      this._emitBalance();
      return { order: t.order };
    }
    throw new Error('Type de transaction non géré en simulation');
  }
  async tradeStatus(order) { return { order, requestStatus: 3, message: null }; } // 3 = ACCEPTED

  async getCalendar() {
    const now = Date.now();
    return SIM_CALENDAR.map((e, i) => ({
      country: e.country, title: e.title + ' (simulation)', impact: e.impact,
      period: e.period, previous: e.previous, forecast: e.forecast, current: '',
      time: now + e.offsetH * 3600e3, key: 'simcal' + i,
    }));
  }
  async getTradesHistory() { return this._closed.map(t => Object.assign({}, t)); }

  call(cmd) { return Promise.reject(new Error(cmd + ': non disponible en simulation')); }
  close() { this._timers.forEach(clearInterval); this._timers = []; }
}
