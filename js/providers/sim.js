/* ════════════════════════════════════════════════════════════
   providers/sim.js — Fournisseur simulé : marche aléatoire
   locale, même interface que OKXProvider. Sert de démo
   hors-ligne (et d'aperçu là où le réseau est bloqué).
   ════════════════════════════════════════════════════════════ */
'use strict';

const SIM_UNIVERSE = {
  'BTC-USDT': { price: 97350, digits: 1 },
  'ETH-USDT': { price: 3421, digits: 2 },
  'SOL-USDT': { price: 189.4, digits: 2 },
  'XRP-USDT': { price: 2.31, digits: 4 },
  'DOGE-USDT': { price: 0.312, digits: 5 },
  'ADA-USDT': { price: 0.87, digits: 4 },
  'GOLD-USD': { price: 2632.5, digits: 2 },
  'EUR-USD': { price: 1.0872, digits: 5 },
  'SPX-USD': { price: 6021.4, digits: 1 },
  'DAX-EUR': { price: 20345.5, digits: 1 },
};

const SIM_HEADLINES = [
  'Fed holds rates, signals data-dependent path',
  'Bitcoin ETF inflows hit weekly record',
  'ECB cuts deposit rate 25bp to 2.00%',
  'Gold prints fresh all-time high on central-bank demand',
  'Solana network activity tops previous cycle peak',
  'OPEC+ extends production cuts through Q4',
  'Nasdaq leads rally as megacaps beat earnings',
  'Stablecoin supply expands for 8th straight week',
];

class SimProvider {
  constructor() {
    this.id = 'sim';
    this.label = 'SIMULATION';
    this.quoteCurrency = 'USD';
    this.defaultWatchlist = Object.keys(SIM_UNIVERSE);
    this.defaultQty = '0.10';
    this.handlers = { tick: [], book: [], trade: [] };
    this.state = {};
    for (const [s, d] of Object.entries(SIM_UNIVERSE)) {
      this.state[s] = { last: d.price, open24h: d.price * (1 - (Math.random() - 0.5) * 0.03) };
    }
    this.subs = new Set();
    this._timers = [];
    this.onDisconnect = null;
  }

  async connect() {
    this._timers.push(setInterval(() => {
      for (const s of this.subs) {
        const d = SIM_UNIVERSE[s], st = this.state[s];
        if (Math.random() > 0.5) {
          st.last = Math.max(d.price * 0.4, st.last + (Math.random() - 0.5) * d.price * 0.0004);
        }
        const spread = d.price * 0.0002;
        const bid = st.last - spread / 2, ask = st.last + spread / 2;
        this._emit('tick', {
          symbol: s, bid, ask, last: st.last, ts: Date.now(),
          open24h: st.open24h, high24h: st.last * 1.012, low24h: st.last * 0.988,
          vol24h: 12000 + Math.random() * 3000, volCcy24h: st.last * 15000,
        });
        // carnet synthétique 5 niveaux
        const mk = (px0, dir) => Array.from({ length: 5 }, (_, i) =>
          [px0 + dir * i * spread, Math.random() * 8 + 0.2]);
        this._emit('book', { symbol: s, bids: mk(bid, -1), asks: mk(ask, 1) });
        if (Math.random() > 0.4) {
          this._emit('trade', { symbol: s, px: st.last, qty: Math.random() * 2, side: Math.random() > 0.5 ? 'buy' : 'sell', ts: Date.now() });
        }
      }
    }, 800));
  }

  _emit(kind, data) { for (const fn of this.handlers[kind]) fn(data); }
  onTick(fn) { this.handlers.tick.push(fn); }
  onBook(fn) { this.handlers.book.push(fn); }
  onTrade(fn) { this.handlers.trade.push(fn); }
  subscribe(symbol) { if (SIM_UNIVERSE[symbol]) this.subs.add(symbol); }

  async getSymbol(symbol) {
    symbol = symbol.toUpperCase();
    const d = SIM_UNIVERSE[symbol];
    if (!d) throw new Error(`${symbol}: inconnu en simulation`);
    const st = this.state[symbol];
    const spread = d.price * 0.0002;
    return {
      symbol, description: `${symbol.replace('-', ' / ')} — Simulation`,
      digits: d.digits, lotSz: 0.0001, minSz: 0.0001,
      bid: st.last - spread / 2, ask: st.last + spread / 2, last: st.last,
      open24h: st.open24h, high24h: st.last * 1.012, low24h: st.last * 0.988,
    };
  }

  async getCandles(symbol, tfMin, limit = 300) {
    const d = SIM_UNIVERSE[symbol.toUpperCase()];
    if (!d) throw new Error(`${symbol}: inconnu en simulation`);
    const step = tfMin * 60000;
    const vol = d.price * (0.0012 + tfMin / 1440 * 0.008);
    let t = Date.now() - (Date.now() % step);
    let p = this.state[symbol].last;
    const rev = [];
    for (let i = 0; i < Math.min(300, limit); i++) {
      const c = p;
      const o = p + (Math.random() - 0.5) * 2 * vol;
      rev.push({
        t, o, c,
        h: Math.max(o, c) + Math.random() * vol * 0.5,
        l: Math.min(o, c) - Math.random() * vol * 0.5,
        v: 50 + Math.random() * 400,
      });
      p = o; t -= step;
    }
    return rev.reverse();
  }

  async searchSymbols(q) {
    q = q.toUpperCase();
    return Object.keys(SIM_UNIVERSE).filter((s) => s.includes(q))
      .map((s) => ({ symbol: s, description: 'simulation' }));
  }

  async getStats(symbol) {
    const st = this.state[symbol];
    if (!st) return {};
    return {
      last: st.last, open24h: st.open24h,
      high24h: st.last * 1.012, low24h: st.last * 0.988,
      vol24h: 14000, volCcy24h: st.last * 15000,
      funding: 0.0001, oiCcy: 52000, indexPx: st.last * 0.9998,
    };
  }

  async getNews() {
    const now = Date.now();
    return SIM_HEADLINES.map((title, i) => ({
      time: now - (i + 1) * 3.1 * 3600e3, title, url: null,
      source: 'SIM', body: 'Dépêche générée localement à titre de démonstration.',
    }));
  }

  close() { this._timers.forEach(clearInterval); }
}
