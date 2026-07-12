/* ════════════════════════════════════════════════════════════
   xapi.js — Client pour l'API xAPI de XTB (WebSocket JSON)
   Documentation : http://developers.xstore.pro/documentation/
   Serveurs : wss://ws.xtb.com/{demo|real} + {demo|real}Stream
   ════════════════════════════════════════════════════════════ */
'use strict';

const XAPI_HOST = 'wss://ws.xtb.com';
const XAPI_MIN_INTERVAL = 250;   // xAPI impose >= 200 ms entre deux commandes
const XAPI_TIMEOUT = 20000;

class XApiClient {
  constructor(mode) {
    this.mode = mode;                 // 'demo' | 'real'
    this.ws = null;                   // socket principal (requête/réponse)
    this.sws = null;                  // socket de streaming
    this.sessionId = null;
    this._tag = 0;
    this._pending = new Map();        // customTag -> {res, rej}
    this._queue = [];
    this._draining = false;
    this._lastSend = 0;
    this._handlers = new Map();       // commande stream -> callback
    this._timers = [];
    this.onDisconnect = null;
  }

  /* ── socket principal ── */
  connect() {
    return new Promise((res, rej) => {
      let settled = false;
      this.ws = new WebSocket(`${XAPI_HOST}/${this.mode}`);
      this.ws.onopen = () => { settled = true; res(); };
      this.ws.onerror = () => { if (!settled) { settled = true; rej(new Error('Connexion au serveur XTB impossible')); } };
      this.ws.onmessage = (m) => this._onMain(m);
      this.ws.onclose = () => {
        this._clearTimers();
        for (const p of this._pending.values()) p.rej(new Error('Connexion fermée'));
        this._pending.clear();
        if (settled && this.onDisconnect) this.onDisconnect();
        settled = true;
      };
    });
  }

  _onMain(m) {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    const tag = msg.customTag;
    if (tag == null || !this._pending.has(tag)) return;
    const p = this._pending.get(tag);
    this._pending.delete(tag);
    if (msg.status) p.res(msg);
    else p.rej(new Error(`${msg.errorCode || 'ERR'}: ${msg.errorDescr || 'erreur xAPI'}`));
  }

  call(command, args) {
    return new Promise((res, rej) => {
      const tag = 't' + (++this._tag);
      this._pending.set(tag, { res, rej });
      this._queue.push({ command, arguments: args || {}, customTag: tag });
      this._drain();
      setTimeout(() => {
        if (this._pending.has(tag)) {
          this._pending.delete(tag);
          rej(new Error(`${command}: délai dépassé`));
        }
      }, XAPI_TIMEOUT);
    });
  }

  _drain() {
    if (this._draining) return;
    this._draining = true;
    const step = () => {
      if (!this._queue.length || !this.ws || this.ws.readyState !== 1) { this._draining = false; return; }
      const wait = Math.max(0, this._lastSend + XAPI_MIN_INTERVAL - Date.now());
      setTimeout(() => {
        const obj = this._queue.shift();
        if (obj && this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify(obj));
          this._lastSend = Date.now();
        }
        step();
      }, wait);
    };
    step();
  }

  async login(userId, password) {
    const r = await this.call('login', { userId, password, appName: 'xtb-terminal-web' });
    this.sessionId = r.streamSessionId;
    this.latency = null;
    this._timers.push(setInterval(() => {
      const t0 = Date.now();
      this.call('ping').then(() => { this.latency = Date.now() - t0; }).catch(() => {});
    }, 10000));
    return this.sessionId;
  }

  /* ── socket streaming ── */
  connectStream() {
    return new Promise((res, rej) => {
      let settled = false;
      this.sws = new WebSocket(`${XAPI_HOST}/${this.mode}Stream`);
      this.sws.onopen = () => {
        settled = true;
        this._timers.push(setInterval(() =>
          this._ssend({ command: 'ping', streamSessionId: this.sessionId }), 10000));
        res();
      };
      this.sws.onerror = () => { if (!settled) { settled = true; rej(new Error('Connexion streaming impossible')); } };
      this.sws.onmessage = (m) => {
        let msg; try { msg = JSON.parse(m.data); } catch { return; }
        const h = this._handlers.get(msg.command);
        if (h) h(msg.data);
      };
      this.sws.onclose = () => { if (settled && this.onDisconnect) this.onDisconnect(); };
    });
  }

  _ssend(o) { if (this.sws && this.sws.readyState === 1) this.sws.send(JSON.stringify(o)); }
  subscribe(command, extra) { this._ssend(Object.assign({ command, streamSessionId: this.sessionId }, extra || {})); }
  onStream(command, fn) { this._handlers.set(command, fn); }

  /* ── commandes usuelles ── */
  getSymbol(symbol)        { return this.call('getSymbol', { symbol }).then(r => r.returnData); }
  getMarginLevel()         { return this.call('getMarginLevel').then(r => r.returnData); }
  getTrades()              { return this.call('getTrades', { openedOnly: true }).then(r => r.returnData); }
  getNews(sinceMs)         { return this.call('getNews', { start: sinceMs, end: 0 }).then(r => r.returnData); }
  getChart(symbol, period, startMs) {
    return this.call('getChartLastRequest', { info: { symbol, period, start: startMs } })
      .then(r => {
        const d = r.returnData, k = Math.pow(10, d.digits);
        // xAPI encode high/low/close en écart par rapport à open, à l'échelle 10^digits
        return d.rateInfos.map(c => {
          const o = c.open / k;
          return { t: c.ctm, o, h: o + c.high / k, l: o + c.low / k, c: o + c.close / k, v: c.vol };
        });
      });
  }
  tradeTransaction(info)   { return this.call('tradeTransaction', { tradeTransInfo: info }).then(r => r.returnData); }
  tradeStatus(order)       { return this.call('tradeTransactionStatus', { order }).then(r => r.returnData); }
  getCalendar()            { return this.call('getCalendar').then(r => r.returnData); }
  getTradesHistory(sinceMs){ return this.call('getTradesHistory', { start: sinceMs, end: 0 }).then(r => r.returnData); }

  _clearTimers() { this._timers.forEach(clearInterval); this._timers = []; }

  close() {
    this.onDisconnect = null;
    this._clearTimers();
    try { if (this.ws) this.ws.close(); } catch {}
    try { if (this.sws) this.sws.close(); } catch {}
  }
}

/* Constantes xAPI */
const XAPI_CMD  = { BUY: 0, SELL: 1 };
const XAPI_TYPE = { OPEN: 0, CLOSE: 2, MODIFY: 3 };
const XAPI_PERIODS = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440, W1: 10080, MN: 43200 };
