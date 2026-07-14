/* ════════════════════════════════════════════════════════════
   providers/okx.js — Données de marché OKX (API publique v5).
   REST  : https://www.okx.com/api/v5  (CORS ouvert)
   WS    : wss://ws.okx.com:8443/ws/v5/public
   Aucune clé requise : tickers, carnet, transactions, bougies,
   funding, open interest, annonces. Trading = paper (paper.js).
   ════════════════════════════════════════════════════════════ */
'use strict';

const OKX_REST = 'https://www.okx.com';
const OKX_WS = 'wss://ws.okx.com:8443/ws/v5/public';
const OKX_BARS = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1H', 240: '4H', 1440: '1Dutc', 10080: '1Wutc' };

class OKXProvider {
  constructor() {
    this.id = 'okx';
    this.label = 'OKX';
    this.quoteCurrency = 'USDT';
    this.defaultWatchlist = [
      'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT',
      'ADA-USDT', 'AVAX-USDT', 'LINK-USDT', 'TON-USDT', 'LTC-USDT',
    ];
    this.defaultQty = '0.01';
    this.ws = null;
    this.subs = new Set();
    this.handlers = { tick: [], book: [], trade: [] };
    this.instruments = new Map();   // instId -> {tickSz, lotSz}
    this.allTickers = [];           // pour la recherche
    this.onDisconnect = null;
    this._pingTimer = null;
  }

  async _get(path) {
    const r = await fetch(OKX_REST + path);
    if (!r.ok) throw new Error(`OKX HTTP ${r.status}`);
    const d = await r.json();
    if (d.code !== '0') throw new Error(`OKX: ${d.msg || d.code}`);
    return d.data;
  }

  async connect() {
    // tout en 4 requêtes : instruments + tickers SPOT et SWAP (évite le
    // rate-limit d'un appel par symbole au chargement de la watchlist)
    const [instSpot, instSwap, tickSpot, tickSwap] = await Promise.all([
      this._get('/api/v5/public/instruments?instType=SPOT'),
      this._get('/api/v5/public/instruments?instType=SWAP').catch(() => []),
      this._get('/api/v5/market/tickers?instType=SPOT'),
      this._get('/api/v5/market/tickers?instType=SWAP').catch(() => []),
    ]);
    for (const i of [...instSpot, ...instSwap]) {
      this.instruments.set(i.instId, {
        tickSz: +i.tickSz, lotSz: +i.lotSz, minSz: +i.minSz,
        digits: Math.max(0, Math.round(-Math.log10(+i.tickSz))),
        base: i.baseCcy || (i.instId.split('-')[0]), quote: i.quoteCcy || 'USDT',
        type: i.instType, ctVal: i.ctVal ? +i.ctVal : null,
      });
    }
    this.tickerCache = new Map();
    for (const t of [...tickSpot, ...tickSwap]) this.tickerCache.set(t.instId, t);
    this._tickersAt = Date.now();
    this.allTickers = [...tickSpot, ...tickSwap]
      .filter((t) => /-(USDT|USDC|EUR)(-SWAP)?$/.test(t.instId))
      .map((t) => ({ symbol: t.instId, last: +t.last, open24h: +t.open24h, volCcy24h: +t.volCcy24h }))
      .sort((a, b) => b.volCcy24h - a.volCcy24h);
    try {
      await this._openWS();
    } catch {
      // WebSocket bloqué (pare-feu / port 8443) : repli en interrogation REST
      this.polling = true;
      this._startPolling();
    }
  }

  async refreshTickers() {
    if (Date.now() - (this._tickersAt || 0) < 25000) return this.allTickers;
    const [spot, swap] = await Promise.all([
      this._get('/api/v5/market/tickers?instType=SPOT'),
      this._get('/api/v5/market/tickers?instType=SWAP').catch(() => []),
    ]);
    for (const t of [...spot, ...swap]) this.tickerCache.set(t.instId, t);
    this._tickersAt = Date.now();
    this.allTickers = [...spot, ...swap]
      .filter((t) => /-(USDT|USDC|EUR)(-SWAP)?$/.test(t.instId))
      .map((t) => ({ symbol: t.instId, last: +t.last, open24h: +t.open24h, volCcy24h: +t.volCcy24h }))
      .sort((a, b) => b.volCcy24h - a.volCcy24h);
    return this.allTickers;
  }

  /* top movers parmi les paires liquides (vol > 1 M$) */
  async topMovers() {
    await this.refreshTickers().catch(() => {});
    return this.allTickers
      .filter((t) => t.volCcy24h > 1e6 && t.open24h > 0 && !t.symbol.endsWith('-SWAP'))
      .map((t) => ({ symbol: t.symbol, last: t.last, chg: (t.last - t.open24h) / t.open24h * 100, volCcy24h: t.volCcy24h }));
  }

  _startPolling() {
    this._timers = this._timers || [];
    this._timers.push(setInterval(async () => {
      try {
        const all = await this._get('/api/v5/market/tickers?instType=SPOT');
        const wanted = new Set([...this.subs].map((s) => JSON.parse(s).instId));
        for (const t of all) {
          if (!wanted.has(t.instId)) continue;
          this._emit('tick', {
            symbol: t.instId, bid: +t.bidPx, ask: +t.askPx, last: +t.last,
            high24h: +t.high24h, low24h: +t.low24h, open24h: +t.open24h,
            vol24h: +t.vol24h, volCcy24h: +t.volCcy24h, ts: +t.ts,
          });
        }
      } catch {}
    }, 3000));
    this._timers.push(setInterval(async () => {
      if (!this.focusSymbol) return;
      const sym = this.focusSymbol;
      try {
        const [b] = await this._get(`/api/v5/market/books?instId=${sym}&sz=5`);
        this._emit('book', {
          symbol: sym,
          bids: b.bids.map((x) => [+x[0], +x[1]]),
          asks: b.asks.map((x) => [+x[0], +x[1]]),
        });
        const tr = await this._get(`/api/v5/market/trades?instId=${sym}&limit=8`);
        for (const t of tr.reverse()) {
          if (+t.ts > (this._lastTradeTs || 0)) {
            this._lastTradeTs = +t.ts;
            this._emit('trade', { symbol: sym, px: +t.px, qty: +t.sz, side: t.side, ts: +t.ts });
          }
        }
      } catch {}
    }, 3000));
  }

  focus(symbol) { this.focusSymbol = symbol; this._lastTradeTs = 0; }

  _openWS() {
    return new Promise((res, rej) => {
      let settled = false;
      this.ws = new WebSocket(OKX_WS);
      this.ws.onopen = () => {
        settled = true;
        this._pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === 1) this.ws.send('ping');
        }, 25000);
        // ré-abonne après reconnexion
        if (this.subs.size) this._send({ op: 'subscribe', args: [...this.subs].map((s) => JSON.parse(s)) });
        res();
      };
      this.ws.onerror = () => { if (!settled) { settled = true; rej(new Error('Connexion WebSocket OKX impossible')); } };
      this.ws.onmessage = (m) => this._onMsg(m);
      this.ws.onclose = () => {
        clearInterval(this._pingTimer);
        if (!settled) return;
        // reconnexion automatique
        setTimeout(() => this._openWS().catch(() => {
          if (this.onDisconnect) this.onDisconnect();
        }), 2000);
      };
    });
  }

  _send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  _onMsg(m) {
    if (m.data === 'pong') return;
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    if (!msg.data || !msg.arg) return;
    const { channel, instId } = msg.arg;
    if (channel === 'tickers') {
      const t = msg.data[0];
      this._emit('tick', {
        symbol: instId, bid: +t.bidPx, ask: +t.askPx, last: +t.last,
        high24h: +t.high24h, low24h: +t.low24h, open24h: +t.open24h,
        vol24h: +t.vol24h, volCcy24h: +t.volCcy24h, ts: +t.ts,
      });
    } else if (channel === 'books5') {
      const b = msg.data[0];
      this._emit('book', {
        symbol: instId,
        bids: b.bids.map((x) => [+x[0], +x[1]]),
        asks: b.asks.map((x) => [+x[0], +x[1]]),
      });
    } else if (channel === 'trades') {
      for (const tr of msg.data) {
        this._emit('trade', { symbol: instId, px: +tr.px, qty: +tr.sz, side: tr.side, ts: +tr.ts });
      }
    }
  }

  _emit(kind, data) { for (const fn of this.handlers[kind]) fn(data); }
  onTick(fn) { this.handlers.tick.push(fn); }
  onBook(fn) { this.handlers.book.push(fn); }
  onTrade(fn) { this.handlers.trade.push(fn); }

  subscribe(symbol) {
    for (const channel of ['tickers', 'books5', 'trades']) {
      const key = JSON.stringify({ channel, instId: symbol });
      if (this.subs.has(key)) continue;
      this.subs.add(key);
      this._send({ op: 'subscribe', args: [{ channel, instId: symbol }] });
    }
  }

  async getSymbol(symbol) {
    symbol = symbol.toUpperCase();
    const meta = this.instruments.get(symbol);
    if (!meta) throw new Error(`${symbol}: instrument OKX inconnu (essayez la recherche)`);
    // cache tickers du connect() : zéro appel REST pour la watchlist initiale
    let t = this.tickerCache && this.tickerCache.get(symbol);
    if (!t || Date.now() - (this._tickersAt || 0) > 60000) {
      [t] = await this._get(`/api/v5/market/ticker?instId=${symbol}`);
    }
    const isSwap = meta.type === 'SWAP';
    return {
      symbol,
      description: `${meta.base} / ${meta.quote} — OKX ${isSwap ? 'Perp' : 'Spot'}`,
      digits: meta.digits, lotSz: meta.lotSz, minSz: meta.minSz,
      ctVal: meta.ctVal, isSwap,
      bid: +t.bidPx, ask: +t.askPx, last: +t.last,
      high24h: +t.high24h, low24h: +t.low24h, open24h: +t.open24h,
      vol24h: +t.vol24h, volCcy24h: +t.volCcy24h,
    };
  }

  async getCandles(symbol, tfMin, limit = 300) {
    const bar = OKX_BARS[tfMin] || '1H';
    const d = await this._get(`/api/v5/market/candles?instId=${symbol}&bar=${bar}&limit=${Math.min(300, limit)}`);
    return d.reverse().map((c) => ({ t: +c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }));
  }

  /* pagination : bougies antérieures à beforeTs (scroll infini) */
  async getCandlesBefore(symbol, tfMin, beforeTs) {
    const bar = OKX_BARS[tfMin] || '1H';
    const d = await this._get(`/api/v5/market/history-candles?instId=${symbol}&bar=${bar}&after=${beforeTs}&limit=100`);
    return d.reverse().map((c) => ({ t: +c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }));
  }

  /* profondeur de marché (50 niveaux) */
  async getDepth(symbol, sz = 50) {
    const [b] = await this._get(`/api/v5/market/books?instId=${symbol}&sz=${sz}`);
    return {
      bids: b.bids.map((x) => [+x[0], +x[1]]),
      asks: b.asks.map((x) => [+x[0], +x[1]]),
    };
  }

  async searchSymbols(q) {
    q = q.toUpperCase();
    return this.allTickers
      .filter((t) => t.symbol.includes(q))
      .slice(0, 20)
      .map((t) => ({
        symbol: t.symbol,
        description: `${t.symbol.endsWith('-SWAP') ? 'perp · ' : ''}vol 24h ${Math.round(t.volCcy24h).toLocaleString('fr-FR')} $`,
      }));
  }

  /* statistiques avancées de l'instrument (dérivés + global) */
  async getStats(symbol) {
    const base = symbol.split('-')[0];
    const swapId = symbol.endsWith('-SWAP') ? symbol : `${base}-USDT-SWAP`;
    const out = {};
    const jobs = [
      this._get(`/api/v5/market/ticker?instId=${symbol}`).then(([t]) => {
        out.last = +t.last; out.open24h = +t.open24h;
        out.high24h = +t.high24h; out.low24h = +t.low24h;
        out.vol24h = +t.vol24h; out.volCcy24h = +t.volCcy24h;
      }),
      this._get(`/api/v5/public/funding-rate?instId=${swapId}`)
        .then(([f]) => { out.funding = +f.fundingRate; out.nextFunding = +f.nextFundingTime; })
        .catch(() => {}),
      this._get(`/api/v5/public/open-interest?instType=SWAP&instId=${swapId}`)
        .then(([o]) => { out.oiCcy = +o.oiCcy; })
        .catch(() => {}),
      this._get(`/api/v5/market/index-tickers?instId=${base}-USD`)
        .then(([x]) => { out.indexPx = +x.idxPx; })
        .catch(() => {}),
    ];
    await Promise.all(jobs);
    return out;
  }

  async getNews() {
    // Annonces officielles OKX (publiques)
    const d = await this._get('/api/v5/support/announcements?page=1');
    const items = (d[0] && d[0].details) || [];
    return items.map((a) => ({
      time: +a.pTime, title: a.title, url: a.url,
      source: 'OKX', body: null,
    }));
  }

  close() {
    clearInterval(this._pingTimer);
    (this._timers || []).forEach(clearInterval);
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch {} }
  }
}
