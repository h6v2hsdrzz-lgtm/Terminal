/* ════════════════════════════════════════════════════════════
   paper.js — Moteur de paper trading.
   Positions fictives exécutées aux prix réels du fournisseur
   de données, SL/TP déclenchés automatiquement sur chaque tick,
   persistance localStorage, statistiques de portefeuille.
   ════════════════════════════════════════════════════════════ */
'use strict';

class PaperAccount {
  constructor(storeKey, startBalance, currency) {
    this.storeKey = 'paper-' + storeKey;
    this.currency = currency || 'USDT';
    this.listeners = [];
    const saved = this._load();
    this.balance = saved ? saved.balance : startBalance;
    this.positions = saved ? saved.positions : [];
    this.history = saved ? saved.history : [];
    this.seq = saved ? saved.seq : 1;
    this.prices = new Map();      // symbol -> {bid, ask}
    this.mode = 'paper';
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(this.storeKey)); } catch { return null; }
  }
  _save() {
    try {
      localStorage.setItem(this.storeKey, JSON.stringify({
        balance: this.balance, positions: this.positions,
        history: this.history.slice(0, 300), seq: this.seq,
      }));
    } catch {}
  }

  onUpdate(fn) { this.listeners.push(fn); }
  _notify(kind, payload) { for (const fn of this.listeners) fn(kind, payload); }

  /* appelé par l'app sur chaque tick */
  tick(symbol, bid, ask) {
    this.prices.set(symbol, { bid, ask });
    let changed = false;
    for (const p of [...this.positions]) {
      if (p.symbol !== symbol) continue;
      const mark = p.side === 'buy' ? bid : ask;
      // SL / TP
      if (p.sl && ((p.side === 'buy' && mark <= p.sl) || (p.side === 'sell' && mark >= p.sl))) {
        this._close(p, p.sl, 'Stop Loss'); changed = true; continue;
      }
      if (p.tp && ((p.side === 'buy' && mark >= p.tp) || (p.side === 'sell' && mark <= p.tp))) {
        this._close(p, p.tp, 'Take Profit'); changed = true;
      }
    }
    if (changed) { this._save(); this._notify('positions'); }
  }

  plOf(p) {
    const px = this.prices.get(p.symbol);
    if (!px) return p.pl || 0;
    const mark = p.side === 'buy' ? px.bid : px.ask;
    return (mark - p.entry) * (p.side === 'buy' ? 1 : -1) * p.qty;
  }

  getSummary() {
    let pl = 0;
    for (const p of this.positions) pl += this.plOf(p);
    return { balance: this.balance, equity: this.balance + pl, openPl: pl, currency: this.currency };
  }

  getPositions() {
    return this.positions.map((p) => Object.assign({}, p, { pl: this.plOf(p) }));
  }

  getHistory() { return this.history; }

  market(symbol, side, qty, sl, tp) {
    const px = this.prices.get(symbol);
    if (!px) throw new Error(`${symbol}: pas encore de prix — attendez le premier tick`);
    if (!qty || qty <= 0) throw new Error('Quantité invalide');
    const entry = side === 'buy' ? px.ask : px.bid;
    if (sl && ((side === 'buy' && sl >= entry) || (side === 'sell' && sl <= entry)))
      throw new Error('SL incohérent avec le sens de la position');
    if (tp && ((side === 'buy' && tp <= entry) || (side === 'sell' && tp >= entry)))
      throw new Error('TP incohérent avec le sens de la position');
    const pos = {
      id: this.seq++, symbol, side, qty, entry,
      sl: sl || 0, tp: tp || 0, openTime: Date.now(),
    };
    this.positions.push(pos);
    this._save();
    this._notify('positions');
    return pos;
  }

  close(id, reason) {
    const p = this.positions.find((x) => x.id === id);
    if (!p) throw new Error(`Position ${id} introuvable`);
    const px = this.prices.get(p.symbol);
    const mark = px ? (p.side === 'buy' ? px.bid : px.ask) : p.entry;
    this._close(p, mark, reason || 'Manuel');
    this._save();
    this._notify('positions');
  }

  _close(p, exitPx, reason) {
    const pl = (exitPx - p.entry) * (p.side === 'buy' ? 1 : -1) * p.qty;
    this.balance += pl;
    this.positions = this.positions.filter((x) => x.id !== p.id);
    this.history.unshift({
      id: p.id, symbol: p.symbol, side: p.side, qty: p.qty,
      entry: p.entry, exit: exitPx, pl,
      openTime: p.openTime, closeTime: Date.now(), reason,
    });
    this._notify('closed', { position: p, pl, reason });
  }

  modify(id, sl, tp) {
    const p = this.positions.find((x) => x.id === id);
    if (!p) throw new Error(`Position ${id} introuvable`);
    if (sl != null) p.sl = sl;
    if (tp != null) p.tp = tp;
    this._save();
    this._notify('positions');
  }

  /* statistiques de portefeuille sur l'historique */
  stats() {
    const h = this.history;
    if (!h.length) return null;
    const wins = h.filter((t) => t.pl > 0);
    const losses = h.filter((t) => t.pl <= 0);
    const gw = wins.reduce((a, t) => a + t.pl, 0);
    const gl = Math.abs(losses.reduce((a, t) => a + t.pl, 0));
    return {
      n: h.length,
      winRate: wins.length / h.length * 100,
      totalPl: h.reduce((a, t) => a + t.pl, 0),
      profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
      avgWin: wins.length ? gw / wins.length : 0,
      avgLoss: losses.length ? gl / losses.length : 0,
    };
  }

  reset(startBalance) {
    this.balance = startBalance;
    this.positions = [];
    this.history = [];
    this.seq = 1;
    this._save();
    this._notify('positions');
  }
}
