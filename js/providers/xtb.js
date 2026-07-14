/* ════════════════════════════════════════════════════════════
   providers/xtb.js — Adaptateur XTB : enveloppe le client xAPI
   (js/xapi.js) derrière l'interface commune des fournisseurs,
   avec trading réel sur le compte (démo ou réel).
   ════════════════════════════════════════════════════════════ */
'use strict';

class XTBProvider {
  constructor(mode) {
    this.id = 'xtb';
    this.label = 'XTB ' + (mode === 'real' ? 'RÉEL' : 'DÉMO');
    this.mode = mode;                 // 'demo' | 'real'
    this.quoteCurrency = '';
    this.defaultWatchlist = [
      'EURUSD', 'GBPUSD', 'USDJPY', 'GOLD', 'SILVER', 'OIL.WTI',
      'US500', 'US100', 'US30', 'DE40', 'BITCOIN', 'ETHEREUM',
    ];
    this.defaultQty = '0.10';
    this.client = new XApiClient(mode);
    this.handlers = { tick: [], book: [], trade: [] };
    this.symbolCache = new Map();
    this.onDisconnect = null;
  }

  async connect(creds) {
    await this.client.connect();
    await this.client.login(creds.id, creds.pw);
    this.client.onDisconnect = () => { if (this.onDisconnect) this.onDisconnect(); };
    this.client.onStream('tickPrices', (d) => {
      this._emit('tick', { symbol: d.symbol, bid: d.bid, ask: d.ask, last: d.bid, ts: d.timestamp || Date.now() });
      // le carnet xAPI niveau 0 : on synthétise 1 niveau
      this._emit('book', { symbol: d.symbol, bids: [[d.bid, d.bidVolume || 0]], asks: [[d.ask, d.askVolume || 0]] });
    });
    await this.client.connectStream();
    this.client.subscribe('getTrades');
    this.client.subscribe('getBalance');
    this.client.subscribe('getNews');
    this.client.subscribe('getKeepAlive');
  }

  _emit(kind, data) { for (const fn of this.handlers[kind]) fn(data); }
  onTick(fn) { this.handlers.tick.push(fn); }
  onBook(fn) { this.handlers.book.push(fn); }
  onTrade(fn) { this.handlers.trade.push(fn); }

  subscribe(symbol) {
    this.client.subscribe('getTickPrices', { symbol, minArrivalTime: 400, maxLevel: 0 });
  }

  async getSymbol(symbol) {
    const s = await this.client.getSymbol(symbol.toUpperCase());
    const info = {
      symbol: s.symbol, description: `${s.description} — XTB CFD`,
      digits: s.digits, lotSz: s.lotStep, minSz: s.lotMin,
      bid: s.bid, ask: s.ask, last: s.bid,
      contractSize: s.contractSize, currency: s.currency,
      leverage: s.leverage, swapLong: s.swapLong, swapShort: s.swapShort,
      categoryName: s.categoryName,
    };
    this.symbolCache.set(info.symbol, info);
    return info;
  }

  async getCandles(symbol, tfMin, limit = 300) {
    const lookback = tfMin * 60000 * (limit + 20);
    return this.client.getChart(symbol, tfMin, Date.now() - lookback);
  }

  async getCandlesBefore(symbol, tfMin, beforeTs) {
    const span = tfMin * 60000 * 120;
    return this.client.getChartRange(symbol, tfMin, beforeTs - span, beforeTs - 1).catch(() => []);
  }

  async searchSymbols() { return []; } // xAPI n'a pas de recherche légère ; ADD SYMBOLE direct

  async getStats(symbol) {
    const s = await this.client.getSymbol(symbol);
    return {
      last: s.bid, spreadPts: Math.round((s.ask - s.bid) * Math.pow(10, s.digits)),
      contractSize: s.contractSize, currency: s.currency,
      leverage: s.leverage, swapLong: s.swapLong, swapShort: s.swapShort,
      lotMin: s.lotMin, lotMax: s.lotMax, category: s.categoryName,
    };
  }

  async getNews() {
    const items = await this.client.getNews(Date.now() - 3 * 86400e3);
    return items.map((n) => ({ time: n.time, title: n.title, body: n.body, url: null, source: 'XTB' }));
  }

  close() { this.client.close(); }
}

/* Compte réel XTB — même interface que PaperAccount */
class XTBAccount {
  constructor(provider) {
    this.provider = provider;
    this.client = provider.client;
    this.mode = provider.mode === 'real' ? 'réel' : 'démo';
    this.currency = '';
    this.listeners = [];
    this.summary = { balance: 0, equity: 0, openPl: 0, currency: '' };
    this.positionsMap = new Map();   // order -> position normalisée

    this.client.onStream('balance', (d) => {
      this.summary = { balance: d.balance, equity: d.equity, openPl: d.equity - d.balance, currency: this.currency, margin: d.margin, marginFree: d.marginFree };
      this._notify('summary');
    });
    this.client.onStream('trade', (t) => {
      if (!t) return;
      if (t.closed || t.state === 'Deleted') this.positionsMap.delete(t.order);
      else if (t.type === 0 || t.type == null) this.positionsMap.set(t.order, this._norm(t));
      this._notify('positions');
    });
    this.client.onStream('profit', (d) => {
      const p = this.positionsMap.get(d.order) || this.positionsMap.get(d.order2);
      if (p) { p.pl = d.profit; this._notify('pl'); }
    });
  }

  _norm(t) {
    return {
      id: t.order, symbol: t.symbol, side: t.cmd === XAPI_CMD.BUY ? 'buy' : 'sell',
      qty: t.volume, entry: t.open_price, sl: t.sl || 0, tp: t.tp || 0,
      pl: t.profit || 0, openTime: t.open_time, digits: t.digits,
    };
  }

  onUpdate(fn) { this.listeners.push(fn); }
  _notify(kind) { for (const fn of this.listeners) fn(kind); }
  tick() {} // les P/L arrivent par le flux getProfits

  async init() {
    const m = await this.client.getMarginLevel();
    this.currency = m.currency || '';
    this.summary = { balance: m.balance, equity: m.equity, openPl: m.equity - m.balance, currency: this.currency, margin: m.margin, marginFree: m.margin_free };
    const trades = await this.client.getTrades();
    this.positionsMap.clear();
    for (const t of trades) this.positionsMap.set(t.order, this._norm(t));
  }

  getSummary() { return this.summary; }
  getPositions() { return [...this.positionsMap.values()]; }

  async getHistory() {
    const h = await this.client.getTradesHistory(Date.now() - 30 * 86400e3);
    return h.map((t) => ({
      id: t.order, symbol: t.symbol, side: t.cmd === XAPI_CMD.BUY ? 'buy' : 'sell',
      qty: t.volume, entry: t.open_price, exit: t.close_price, pl: t.profit,
      closeTime: t.close_time, reason: t.comment || '—',
    })).sort((a, b) => b.closeTime - a.closeTime);
  }

  async market(symbol, side, qty, sl, tp) {
    const info = this.provider.symbolCache.get(symbol) || await this.provider.getSymbol(symbol);
    const cmd = side === 'buy' ? XAPI_CMD.BUY : XAPI_CMD.SELL;
    const r = await this.client.tradeTransaction({
      cmd, type: XAPI_TYPE.OPEN, symbol, volume: qty,
      price: side === 'buy' ? info.ask : info.bid,
      sl: sl || 0, tp: tp || 0, offset: 0, expiration: 0, order: 0, customComment: 'terminal',
    });
    const st = await this.client.tradeStatus(r.order).catch(() => null);
    if (st && st.requestStatus === 4) throw new Error(st.message || 'ordre rejeté par le serveur');
    return { id: r.order };
  }

  async close(id) {
    const p = this.positionsMap.get(id);
    if (!p) throw new Error(`Position ${id} introuvable`);
    const info = this.provider.symbolCache.get(p.symbol) || await this.provider.getSymbol(p.symbol);
    await this.client.tradeTransaction({
      cmd: p.side === 'buy' ? XAPI_CMD.BUY : XAPI_CMD.SELL,
      type: XAPI_TYPE.CLOSE, order: id, symbol: p.symbol, volume: p.qty,
      price: p.side === 'buy' ? info.bid : info.ask,
      sl: 0, tp: 0, offset: 0, expiration: 0, customComment: 'terminal',
    });
  }

  stats() { return null; } // historique 30 j déjà affiché ; stats calculées côté app
}
