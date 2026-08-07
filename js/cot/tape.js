/* ════════════════════════════════════════════════════════════
   tape.js — le temps court : bougies multi-échelles et flux d'ordres.

   Le COT est hebdomadaire ; il ne descendra jamais à la minute. Pour
   voir le marché de l'or à 5 minutes il faut un instrument coté en
   continu, avec un carnet et des transactions publiques.

   C'est ce qu'apporte l'or tokenisé : XAUT (Tether Gold) et PAXG
   (Paxos Gold) sont adossés à de l'or physique en coffre et se
   négocient 24 h/24 sur OKX, dont l'API publique autorise le CORS.
   Le suivi du spot est étroit mais imparfait — c'est un proxy, et
   l'écran le dit partout où ces chiffres apparaissent.

   Ce que cela permet, et qui n'existe nulle part ailleurs en accès
   public sur l'or : le contenu des bougies. Chaque transaction porte
   son côté agresseur, donc on peut séparer ce qui a été acheté au
   marché de ce qui a été vendu au marché — le « delta » — au lieu de
   ne voir qu'un volume total.

   Ce qui n'existe pas et ne sera pas inventé : les liquidations sur
   l'or (aucun marché à effet de levier public ne les publie pour ce
   sous-jacent), et les stops ou objectifs des intervenants, qui ne
   sont transmis à personne.
   ════════════════════════════════════════════════════════════ */
'use strict';

const OKX_BASE = 'https://www.okx.com/api/v5';

/* Instruments proxy, par ordre de préférence. XAUT est le plus liquide
   des deux ; PAXG prend le relais si la paire ne répond pas. */
const TAPE_INSTRUMENTS = [
  { id: 'XAUT-USDT', label: 'XAUT', name: 'Tether Gold', metal: 'GOLD' },
  { id: 'PAXG-USDT', label: 'PAXG', name: 'Paxos Gold', metal: 'GOLD' },
];

/* Unités de temps. `ms` sert à calculer la fenêtre couverte et à
   décider quand un cache est périmé. */
const TAPE_BARS = [
  { key: '5m', label: '5 min', ms: 300000 },
  { key: '15m', label: '15 min', ms: 900000 },
  { key: '1H', label: '1 heure', ms: 3600000 },
  { key: '4H', label: '4 heures', ms: 14400000 },
  { key: '1D', label: '1 jour', ms: 86400000 },
  { key: '1W', label: '1 semaine', ms: 604800000 },
];

const Tape = {
  instruments: TAPE_INSTRUMENTS,
  bars: TAPE_BARS,
  instrument: TAPE_INSTRUMENTS[0],
  available: null,        /* null = pas encore testé */

  async get(path, params) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${OKX_BASE}${path}?${qs}`);
    if (!res.ok) throw new Error(`OKX ${res.status}`);
    const j = await res.json();
    if (j.code && j.code !== '0') throw new Error(j.msg || `OKX ${j.code}`);
    return j.data || [];
  },

  /* Vérifie une fois qu'un instrument répond, et retient lequel.
     Si aucun ne répond, la vue le dira plutôt que de rester vide. */
  async probe() {
    if (this.available !== null) return this.available;
    for (const inst of TAPE_INSTRUMENTS) {
      try {
        const d = await this.get('/market/candles', { instId: inst.id, bar: '1H', limit: '2' });
        if (d.length) { this.instrument = inst; this.available = true; return true; }
      } catch { /* instrument suivant */ }
    }
    this.available = false;
    return false;
  },

  /* ── Bougies ──────────────────────────────────────────────
     OKX renvoie [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm],
     du plus récent au plus ancien. `/market/candles` plafonne à 300 ;
     au-delà on pagine avec `/market/history-candles`, qui remonte
     dans le temps à partir d'un curseur. */
  async candles(bar = '1H', want = 300) {
    const inst = this.instrument.id;
    const out = [];
    let first = await this.get('/market/candles', { instId: inst, bar, limit: '300' });
    out.push(...first);

    while (out.length < want && out.length) {
      const oldest = out[out.length - 1][0];
      let page;
      try {
        page = await this.get('/market/history-candles', {
          instId: inst, bar, after: oldest, limit: '100',
        });
      } catch { break; }
      if (!page.length) break;
      out.push(...page);
      if (page.length < 100) break;
    }

    return out.slice(0, want).map((c) => ({
      ts: Math.floor(+c[0] / 1000),
      open: +c[1], high: +c[2], low: +c[3], close: +c[4],
      volume: +c[5],           /* en unités de métal tokenisé */
      turnover: +c[7],         /* en dollars */
      closed: c[8] === '1',
    })).sort((a, b) => a.ts - b.ts);
  },

  /* ── Transactions ─────────────────────────────────────────
     Chaque ligne porte le côté de l'agresseur : c'est ce qui permet
     de savoir qui a traversé le spread, et donc ce qui se joue à
     l'intérieur d'une bougie. */
  async trades(limit = 500) {
    const raw = await this.get('/market/trades', { instId: this.instrument.id, limit: String(Math.min(500, limit)) });
    return raw.map((t) => ({
      ts: +t.ts, price: +t.px, size: +t.sz,
      side: t.side,                       /* 'buy' = acheteur agresseur */
      value: +t.px * +t.sz,
    })).sort((a, b) => a.ts - b.ts);
  },

  /* ── Carnet d'ordres ──────────────────────────────────────*/
  async book(depth = 25) {
    const d = await this.get('/market/books', { instId: this.instrument.id, sz: String(depth) });
    const b = d[0] || {};
    const map = (rows) => (rows || []).map((r) => ({ price: +r[0], size: +r[1], orders: +r[3] }));
    return { bids: map(b.bids), asks: map(b.asks), ts: +b.ts || Date.now() };
  },

  /* ── Ticker ───────────────────────────────────────────────*/
  async ticker() {
    const d = await this.get('/market/ticker', { instId: this.instrument.id });
    const t = d[0] || {};
    return {
      last: +t.last, open24h: +t.open24h, high24h: +t.high24h, low24h: +t.low24h,
      vol24h: +t.vol24h, volCcy24h: +t.volCcy24h,
      bid: +t.bidPx, ask: +t.askPx,
      changePct: t.open24h ? ((+t.last - +t.open24h) / +t.open24h) * 100 : null,
    };
  },

  /* ── Analyse du flux ──────────────────────────────────────
     Le « delta » est la différence entre ce qui a été acheté au marché
     et ce qui a été vendu au marché. Un prix qui monte sur delta
     négatif signale que la hausse est absorbée : les acheteurs passent
     par des ordres à cours limité au lieu de traverser le spread.
     C'est le genre de nuance qu'un simple volume ne montre jamais. */
  flow(trades) {
    if (!trades.length) return null;
    let buyVol = 0, sellVol = 0, buyVal = 0, sellVal = 0;
    const sizes = [];
    for (const t of trades) {
      sizes.push(t.size);
      if (t.side === 'buy') { buyVol += t.size; buyVal += t.value; }
      else { sellVol += t.size; sellVal += t.value; }
    }
    const total = buyVol + sellVol;
    sizes.sort((a, b) => a - b);
    const q = (p) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * p))];

    /* « gros » = au-delà du 90ᵉ centile des tailles observées.
       Un seuil absolu n'aurait aucun sens : il dépend de l'instrument
       et de l'heure de la journée. */
    const big = q(0.9);
    const bigTrades = trades.filter((t) => t.size >= big);
    let bigBuy = 0, bigSell = 0;
    for (const t of bigTrades) { if (t.side === 'buy') bigBuy += t.size; else bigSell += t.size; }

    return {
      n: trades.length,
      from: trades[0].ts, to: trades[trades.length - 1].ts,
      buyVol, sellVol, buyVal, sellVal,
      delta: buyVol - sellVol,
      deltaPct: total ? ((buyVol - sellVol) / total) * 100 : 0,
      turnover: buyVal + sellVal,
      median: q(0.5), p90: big, max: sizes[sizes.length - 1],
      bigCount: bigTrades.length,
      bigDelta: bigBuy - bigSell,
      /* le delta des gros ordres contre celui de l'ensemble : quand les
         deux divergent, le flux de détail et le flux institutionnel ne
         vont pas dans le même sens */
      bigVsAll: (bigBuy + bigSell) > 0 && total > 0
        ? ((bigBuy - bigSell) / (bigBuy + bigSell)) * 100 - ((buyVol - sellVol) / total) * 100
        : null,
    };
  },

  /* ── Analyse du carnet ────────────────────────────────────*/
  bookStats(book) {
    if (!book || !book.bids.length || !book.asks.length) return null;
    const bid = book.bids[0].price, ask = book.asks[0].price;
    const mid = (bid + ask) / 2;
    const sum = (rows, within) => rows
      .filter((r) => Math.abs(r.price - mid) / mid <= within)
      .reduce((a, r) => a + r.size, 0);

    const depths = {};
    for (const pct of [0.0005, 0.001, 0.0025]) {
      const b = sum(book.bids, pct), a = sum(book.asks, pct);
      depths[pct] = { bid: b, ask: a, imbalance: b + a > 0 ? ((b - a) / (b + a)) * 100 : 0 };
    }
    return {
      bid, ask, mid,
      spread: ask - bid,
      spreadBps: mid ? ((ask - bid) / mid) * 10000 : null,
      depths,
      bidTotal: book.bids.reduce((a, r) => a + r.size, 0),
      askTotal: book.asks.reduce((a, r) => a + r.size, 0),
    };
  },

  /* ── Structure intra-bougie ───────────────────────────────
     Où la clôture se situe dans le range, et quelle part du range est
     faite de mèches. Un corps minuscule avec de longues mèches des
     deux côtés dit qu'aucun camp n'a pris le dessus, quel que soit le
     sens de la bougie. */
  barAnatomy(c) {
    if (!c) return null;
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    return {
      range, body,
      bodyPct: range ? (body / range) * 100 : 0,
      upperWick: c.high - Math.max(c.open, c.close),
      lowerWick: Math.min(c.open, c.close) - c.low,
      closePos: range ? ((c.close - c.low) / range) * 100 : 50,
      direction: c.close > c.open ? 'up' : c.close < c.open ? 'down' : 'flat',
    };
  },

  /* volatilité réalisée annualisée, à partir des rendements log */
  realizedVol(candles, barMs) {
    if (candles.length < 20) return null;
    const r = [];
    for (let i = 1; i < candles.length; i++) {
      if (candles[i - 1].close > 0) r.push(Math.log(candles[i].close / candles[i - 1].close));
    }
    if (r.length < 10) return null;
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
    const perYear = (365 * 86400000) / barMs;
    return Math.sqrt(v * perYear) * 100;
  },

  /* Profil de volume par niveau de prix : où les échanges se sont
     réellement concentrés. Le point de contrôle (POC) est le prix qui
     a vu passer le plus de volume — souvent un aimant. */
  volumeProfile(candles, buckets = 24) {
    if (!candles.length) return null;
    const hi = Math.max(...candles.map((c) => c.high));
    const lo = Math.min(...candles.map((c) => c.low));
    if (!(hi > lo)) return null;
    const step = (hi - lo) / buckets;
    const bins = Array.from({ length: buckets }, (_, i) => ({
      low: lo + i * step, high: lo + (i + 1) * step, volume: 0,
    }));
    /* le volume d'une bougie est réparti sur les paliers qu'elle
       traverse — approximation, mais bien plus juste que de le poser
       entièrement sur la clôture */
    for (const c of candles) {
      const from = Math.max(0, Math.floor((c.low - lo) / step));
      const to = Math.min(buckets - 1, Math.floor((c.high - lo) / step));
      const span = to - from + 1;
      for (let i = from; i <= to; i++) bins[i].volume += c.volume / span;
    }
    const poc = bins.reduce((a, b) => (b.volume > a.volume ? b : a), bins[0]);
    const maxVol = poc.volume || 1;
    return { bins, poc, maxVol, high: hi, low: lo };
  },
};
