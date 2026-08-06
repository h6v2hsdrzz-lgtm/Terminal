/* ════════════════════════════════════════════════════════════
   okx-private.js — Client API privée OKX v5 (compte réel).
   Signature HMAC-SHA256 via WebCrypto, directement dans le
   navigateur : aucun serveur intermédiaire, la clé ne quitte
   jamais la machine (OKX renvoie Access-Control-Allow-Origin,
   les appels signés passent donc en CORS).

   Doc : timestamp ISO8601(ms) + méthode + chemin(+query) + corps,
   signé en HMAC-SHA256(secret) puis encodé en base64.

   ⚠ Utiliser une clé en LECTURE SEULE (permission « Lire ») :
   ce module n'envoie aucun ordre.
   ════════════════════════════════════════════════════════════ */
'use strict';

const OKX_BASE = 'https://www.okx.com';

/* Limites de débit OKX par endpoint (ms minimum entre deux appels).
   positions-history est volontairement très bridé côté OKX
   (1 appel / 10 s) : d'où la synchronisation incrémentale. */
const OKX_RATE = [
  [/\/account\/positions-history/, 10500],
  [/\/account\/bills-archive/, 450],
  [/\/trade\/fills-history/, 250],
  [/\/trade\/orders-history-archive/, 150],
  [/\/asset\/(deposit|withdrawal)-history/, 200],
  [/./, 220],
];
function rateFor(path) {
  for (const [re, ms] of OKX_RATE) if (re.test(path)) return ms;
  return 220;
}

class OKXPrivate {
  constructor({ apiKey, secret, passphrase, demo = false }) {
    this.apiKey = (apiKey || '').trim();
    this.secret = (secret || '').trim();
    this.passphrase = passphrase || '';
    this.demo = !!demo;
    this._key = null;          // CryptoKey HMAC importée une seule fois
    this._lastCall = new Map(); // path pattern -> timestamp
    this._chain = Promise.resolve();
    this.aborted = false;
  }

  async _hmacKey() {
    if (this._key) return this._key;
    // WebCrypto n'existe qu'en contexte sécurisé : sans lui, aucune signature possible
    if (!crypto || !crypto.subtle) {
      throw new Error('Signature impossible : ouvrez la page en HTTPS ou sur http://localhost '
        + '(l\'API de chiffrement du navigateur est désactivée en contexte non sécurisé).');
    }
    this._key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    return this._key;
  }

  async _sign(prehash) {
    const key = await this._hmacKey();
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(prehash));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  /* file d'attente : un appel à la fois, en respectant la limite de débit */
  _queue(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.then(() => {}, () => {});
    return run;
  }

  static _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async _request(path, { method = 'GET', body = null, retry = 0 } = {}) {
    if (this.aborted) throw new Error('Synchronisation interrompue');
    const gap = rateFor(path);
    const last = this._lastCall.get(gap) || 0;
    const wait = last + gap - Date.now();
    if (wait > 0) await OKXPrivate._sleep(wait);
    this._lastCall.set(gap, Date.now());

    const ts = new Date().toISOString();
    const bodyStr = body ? JSON.stringify(body) : '';
    const sign = await this._sign(ts + method + path + bodyStr);
    const headers = {
      'OK-ACCESS-KEY': this.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json',
    };
    if (this.demo) headers['x-simulated-trading'] = '1';

    let res;
    try {
      res = await fetch(OKX_BASE + path, { method, headers, body: bodyStr || undefined });
    } catch (e) {
      if (retry < 3) { await OKXPrivate._sleep(600 * (retry + 1)); return this._request(path, { method, body, retry: retry + 1 }); }
      throw new Error('Réseau : OKX injoignable (VPN / pare-feu / blocage géographique ?)');
    }

    let json;
    try { json = await res.json(); } catch { throw new Error(`OKX HTTP ${res.status}`); }

    if (json.code === '50011' || json.code === '50013' || res.status === 429) {
      if (retry < 4) {
        await OKXPrivate._sleep(1500 * Math.pow(2, retry));
        return this._request(path, { method, body, retry: retry + 1 });
      }
    }
    if (json.code !== '0') throw new Error(OKXPrivate.explain(json));
    return json.data || [];
  }

  get(path) { return this._queue(() => this._request(path)); }

  /* messages d'erreur OKX traduits en clair */
  static explain(json) {
    const code = json.code, msg = json.msg || '';
    const map = {
      50100: 'Clé API invalide ou désactivée.',
      50101: 'Clé API invalide (vérifiez la clé, le secret et la phrase secrète).',
      50102: 'Horloge désynchronisée : l\'heure de votre machine s\'écarte de plus de 30 s de celle d\'OKX.',
      50103: 'Clé API manquante.',
      50104: 'Phrase secrète (passphrase) manquante.',
      50105: 'Phrase secrète incorrecte.',
      50111: 'Clé API incorrecte.',
      50113: 'Signature invalide — secret API erroné.',
      50114: 'Signature invalide.',
      50110: 'Adresse IP non autorisée : ajoutez votre IP à la liste blanche de la clé, ou retirez la restriction IP.',
      50119: 'Clé API introuvable (créée sur un autre compte, ou compte démo/réel inversé ?).',
      50026: 'OKX indisponible temporairement, réessayez.',
      51603: 'Aucune donnée pour cette requête.',
    };
    const known = map[+code];
    if (known) return known;
    return `OKX ${code} : ${msg}`;
  }

  /* ─────────────── endpoints simples ─────────────── */

  config() { return this.get('/api/v5/account/config'); }
  balance() { return this.get('/api/v5/account/balance'); }
  fundingBalance() { return this.get('/api/v5/asset/balances'); }
  positions() { return this.get('/api/v5/account/positions'); }
  maxLoan(instId) { return this.get(`/api/v5/account/max-loan?instId=${instId}`); }

  /* vérifie les identifiants et renvoie le résumé du compte */
  async verify() {
    const [cfg] = await this.config();
    return {
      uid: cfg.uid,
      acctLv: cfg.acctLv,               // 1 simple, 2 single-currency margin, 3 multi, 4 portfolio
      posMode: cfg.posMode,
      level: cfg.level,
      perm: cfg.perm || '',             // 'read_only' / 'trade' / 'withdraw'
      mainUid: cfg.mainUid,
      ip: cfg.ip || '',
    };
  }

  /* ─────────────── pagination générique ───────────────
     OKX renvoie les pages du plus récent au plus ancien ;
     `after` = « strictement plus ancien que cette valeur ». */
  async _walk(basePath, { cursor, limit = 100, maxPages = 100, stopBefore = 0, tsField, onProgress, label }) {
    const out = [];
    let after = null;
    for (let page = 0; page < maxPages; page++) {
      if (this.aborted) break;
      const sep = basePath.includes('?') ? '&' : '?';
      const url = `${basePath}${sep}limit=${limit}${after ? `&after=${after}` : ''}`;
      let rows;
      try {
        rows = await this._queue(() => this._request(url));
      } catch (e) {
        if (page === 0) throw e;
        break; // page intermédiaire en échec : on garde ce qui est déjà chargé
      }
      if (!rows.length) break;
      let crossed = false;
      for (const r of rows) {
        const ts = +r[tsField];
        if (stopBefore && ts && ts <= stopBefore) { crossed = true; continue; }
        out.push(r);
      }
      if (onProgress) onProgress({ label, count: out.length, page: page + 1 });
      if (crossed || rows.length < limit) break;
      const lastRow = rows[rows.length - 1];
      const next = lastRow[cursor];
      if (next == null || next === '') break;
      after = next;
    }
    return out;
  }

  /* ─────────────── historique ─────────────── */

  /* positions clôturées (dérivés & marge) — 3 mois glissants côté OKX */
  positionsHistory({ since = 0, instType = null, onProgress } = {}) {
    const q = instType ? `?instType=${instType}` : '';
    return this._walk('/api/v5/account/positions-history' + q, {
      cursor: 'uTime', tsField: 'uTime', stopBefore: since, maxPages: 40,
      onProgress, label: 'Positions clôturées',
    });
  }

  /* exécutions (fills) — nécessaires au spot, qui n'a pas de « positions » */
  fills({ instType = 'SPOT', since = 0, onProgress } = {}) {
    return this._walk(`/api/v5/trade/fills-history?instType=${instType}`, {
      cursor: 'billId', tsField: 'ts', stopBefore: since, maxPages: 60,
      onProgress, label: `Exécutions ${instType}`,
    });
  }

  ordersHistory({ instType = 'SPOT', since = 0, onProgress } = {}) {
    return this._walk(`/api/v5/trade/orders-history-archive?instType=${instType}`, {
      cursor: 'ordId', tsField: 'cTime', stopBefore: since, maxPages: 30,
      onProgress, label: `Ordres ${instType}`,
    });
  }

  /* relevé de compte : frais, funding, intérêts, liquidations… */
  bills({ since = 0, type = null, onProgress } = {}) {
    const q = type ? `?type=${type}` : '';
    return this._walk('/api/v5/account/bills-archive' + q, {
      cursor: 'billId', tsField: 'ts', stopBefore: since, maxPages: 60,
      onProgress, label: 'Relevé de compte',
    });
  }

  deposits({ since = 0, onProgress } = {}) {
    return this._walk('/api/v5/asset/deposit-history', {
      cursor: 'ts', tsField: 'ts', stopBefore: since, maxPages: 20,
      onProgress, label: 'Dépôts',
    });
  }

  withdrawals({ since = 0, onProgress } = {}) {
    return this._walk('/api/v5/asset/withdrawal-history', {
      cursor: 'ts', tsField: 'ts', stopBefore: since, maxPages: 20,
      onProgress, label: 'Retraits',
    });
  }

  abort() { this.aborted = true; }
}

/* ════════════════════════════════════════════════════════════
   OKXLiveAccount — adaptateur « compte » du terminal branché sur
   le vrai compte OKX (lecture seule : le ticket d'ordre est
   désactivé, ce module n'envoie jamais d'ordre).
   Même interface que PaperAccount / XTBAccount.
   ════════════════════════════════════════════════════════════ */
class OKXLiveAccount {
  constructor(client, provider) {
    this.client = client;
    this.provider = provider;
    this.readOnly = true;
    this.currency = 'USD';
    this.summary = { balance: 0, equity: 0, openPl: 0, margin: 0, currency: 'USD' };
    this.positionsMap = new Map();
    this.balances = [];
    this.history = [];
    this._timer = null;
  }

  async init() {
    await this.refresh();
    this._timer = setInterval(() => this.refresh().catch(() => {}), 15000);
  }

  async refresh() {
    const [bal] = await this.client.balance();
    if (bal) {
      const eq = +bal.totalEq || 0;
      const upl = (bal.details || []).reduce((a, d) => a + (+d.upl || 0), 0);
      this.summary = {
        balance: eq - upl,
        equity: eq,
        openPl: upl,
        margin: +bal.imr || +bal.mgnRatio || 0,
        currency: 'USD',
      };
      this.balances = (bal.details || [])
        .map((d) => ({
          ccy: d.ccy, eq: +d.eq || 0, eqUsd: +d.eqUsd || 0,
          avail: +d.availBal || +d.availEq || 0, frozen: +d.frozenBal || 0,
          upl: +d.upl || 0, ccyPnl: +d.spotUpl || 0,
          interest: +d.interest || 0, liab: +d.liab || 0,
        }))
        .filter((d) => Math.abs(d.eqUsd) > 0.5 || Math.abs(d.eq) > 0)
        .sort((a, b) => Math.abs(b.eqUsd) - Math.abs(a.eqUsd));
    }
    const pos = await this.client.positions();
    this.positionsMap.clear();
    for (const p of pos) {
      if (!+p.pos) continue;
      const meta = this.provider && this.provider.instruments.get(p.instId);
      const ctVal = meta && meta.ctVal ? meta.ctVal : 1;
      const isLong = p.posSide === 'long' || (p.posSide === 'net' && +p.pos > 0);
      this.positionsMap.set(p.posId, {
        id: p.posId,
        symbol: p.instId,
        side: isLong ? 'buy' : 'sell',
        qty: Math.abs(+p.pos) * (p.instType === 'SPOT' || p.instType === 'MARGIN' ? 1 : ctVal),
        contracts: Math.abs(+p.pos),
        entry: +p.avgPx || 0,
        mark: +p.markPx || +p.last || 0,
        liqPx: +p.liqPx || null,
        lever: +p.lever || null,
        margin: +p.margin || +p.mmr || 0,
        mgnMode: p.mgnMode,
        pl: +p.upl || 0,
        plPct: +p.uplRatio ? +p.uplRatio * 100 : null,
        fee: +p.fee || 0,
        funding: +p.fundingFee || 0,
        openTime: +p.cTime || 0,
        sl: null, tp: null,
        digits: meta ? meta.digits : 2,
      });
    }
    return this.summary;
  }

  getSummary() { return this.summary; }
  getPositions() { return [...this.positionsMap.values()]; }
  getHistory() { return this.history; }

  open() { throw new Error('Mode analyse : clé en lecture seule, aucun ordre n\'est envoyé depuis ce terminal.'); }
  close() { throw new Error('Mode analyse : clé en lecture seule, aucun ordre n\'est envoyé depuis ce terminal.'); }
  onTick() {}
  dispose() { clearInterval(this._timer); }
}
