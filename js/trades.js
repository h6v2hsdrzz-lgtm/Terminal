/* ════════════════════════════════════════════════════════════
   trades.js — Normalisation de l'historique OKX en « trades »
   comparables, quelle que soit la source :

     • positions-history  → dérivés & marge (déjà des allers-retours)
     • fills-history      → spot : reconstruction FIFO des
                            allers-retours (le spot n'a pas de position)
     • export CSV OKX     → au-delà des 3 mois servis par l'API

   Forme unifiée d'un trade (devise de règlement = USDT/USD) :
     key, instId, instType, side ('long'|'short'),
     openTime, closeTime, openPx, closePx,
     qty        quantité en unité de base (contrats × ctVal)
     notional   qty × openPx
     lever, margin
     gross      P/L brut hors frais
     fee        frais payés (positif = coût)
     funding    financement (positif = reçu, négatif = payé)
     net        P/L net réellement crédité
     closeType  'Manuelle' | 'Liquidation' | 'ADL' | …
     source     'api' | 'spot' | 'csv'
   ════════════════════════════════════════════════════════════ */
'use strict';

const Trades = (() => {

  const CLOSE_TYPE = {
    1: 'Clôture partielle', 2: 'Clôture totale', 3: 'Liquidation',
    4: 'Liquidation partielle', 5: 'ADL (désendettement auto)',
  };

  /* quantité en unité de base : les dérivés OKX se comptent en contrats */
  function baseQty(instType, contracts, ctVal) {
    if (instType === 'SWAP' || instType === 'FUTURES' || instType === 'OPTION') {
      return contracts * (ctVal || 1);
    }
    return contracts;
  }

  function finish(t) {
    t.durationMs = Math.max(0, (t.closeTime || 0) - (t.openTime || 0));
    t.notional = Math.abs(t.qty * t.openPx) || 0;
    if (!t.margin && t.lever > 0) t.margin = t.notional / t.lever;
    if (!t.margin) t.margin = t.notional;
    // rendement sur notionnel et sur marge immobilisée (le vrai « % du trade »)
    t.retNotional = t.notional ? t.net / t.notional * 100 : 0;
    t.retMargin = t.margin ? t.net / t.margin * 100 : 0;
    t.win = t.net > 0;
    return t;
  }

  /* ─────────────── 1. positions clôturées (API) ─────────────── */

  function fromPositionsHistory(rows, instruments) {
    const out = [];
    for (const r of rows) {
      const meta = instruments && instruments.get(r.instId);
      const ctVal = meta && meta.ctVal ? meta.ctVal : (+r.ctVal || 1);
      const contracts = Math.abs(+r.closeTotalPos || +r.openMaxPos || 0);
      const openPx = +r.openAvgPx || 0;
      const closePx = +r.closeAvgPx || 0;
      if (!contracts || !openPx) continue;

      // OKX : fee / fundingFee / liqPenalty sont négatifs quand ils coûtent
      const fee = Math.abs(+r.fee || 0);
      const funding = +r.fundingFee || 0;
      const penalty = Math.abs(+r.liqPenalty || 0);
      const gross = +r.pnl || 0;
      const net = r.realizedPnl != null && r.realizedPnl !== ''
        ? +r.realizedPnl
        : gross - fee + funding - penalty;

      out.push(finish({
        key: `pos:${r.posId}:${r.uTime}`,
        instId: r.instId,
        instType: r.instType,
        side: r.direction === 'short' ? 'short' : 'long',
        openTime: +r.cTime || 0,
        closeTime: +r.uTime || 0,
        openPx, closePx,
        qty: baseQty(r.instType, contracts, ctVal),
        contracts,
        lever: +r.lever || 1,
        margin: 0,
        gross, fee, funding, penalty, net,
        closeType: CLOSE_TYPE[+r.type] || 'Clôture',
        liquidated: +r.type === 3 || +r.type === 4 || +r.type === 5,
        mgnMode: r.mgnMode || '',
        source: 'api',
      }));
    }
    return out;
  }

  /* ─────────────── 2. spot : appariement FIFO des exécutions ───────────────
     Un « trade » spot = un ordre de vente, apparié aux achats les plus
     anciens encore ouverts. Prix d'entrée = moyenne pondérée des lots
     consommés — c'est la lecture la plus proche de la notion de position. */

  function fromSpotFills(fills, instruments) {
    const byInst = new Map();
    for (const f of fills) {
      if (!byInst.has(f.instId)) byInst.set(f.instId, []);
      byInst.get(f.instId).push(f);
    }

    const out = [];
    let unmatchedQty = 0, unmatchedCount = 0;

    for (const [instId, list] of byInst) {
      list.sort((a, b) => +a.ts - +b.ts);
      const base = instId.split('-')[0];
      const lots = [];   // FIFO : { qty, px, fee, ts }

      // regroupe les exécutions d'un même ordre de vente en un seul trade
      const sells = new Map();

      for (const f of list) {
        const px = +f.fillPx, sz = +f.fillSz;
        if (!px || !sz) continue;
        // frais OKX : négatifs. À l'achat ils sont prélevés en devise de base,
        // à la vente en devise de cotation → tout ramener en cotation.
        const feeRaw = Math.abs(+f.fee || 0);
        const feeQuote = f.feeCcy === base ? feeRaw * px : feeRaw;

        if (f.side === 'buy') {
          lots.push({ qty: sz, px, fee: feeQuote, ts: +f.ts });
          continue;
        }

        // vente : consomme les lots les plus anciens
        let remaining = sz;
        let cost = 0, matched = 0, openFee = 0, firstTs = null;
        while (remaining > 1e-12 && lots.length) {
          const lot = lots[0];
          const take = Math.min(lot.qty, remaining);
          const ratio = take / lot.qty;
          cost += take * lot.px;
          openFee += lot.fee * ratio;
          matched += take;
          if (firstTs == null) firstTs = lot.ts;
          lot.qty -= take;
          lot.fee -= lot.fee * ratio;
          remaining -= take;
          if (lot.qty <= 1e-12) lots.shift();
        }
        if (remaining > 1e-12) { unmatchedQty += remaining; unmatchedCount++; }
        if (matched <= 1e-12) continue;

        const sellFee = feeQuote * (matched / sz);
        const k = `spot:${instId}:${f.ordId}`;
        const prev = sells.get(k);
        if (prev) {
          prev.cost += cost; prev.matched += matched;
          prev.proceeds += matched * px; prev.fee += openFee + sellFee;
          prev.openTime = Math.min(prev.openTime, firstTs);
          prev.closeTime = Math.max(prev.closeTime, +f.ts);
        } else {
          sells.set(k, {
            key: k, instId, cost, matched, proceeds: matched * px,
            fee: openFee + sellFee, openTime: firstTs, closeTime: +f.ts,
          });
        }
      }

      const meta = instruments && instruments.get(instId);
      for (const s of sells.values()) {
        const openPx = s.cost / s.matched;
        const closePx = s.proceeds / s.matched;
        const gross = s.proceeds - s.cost;
        out.push(finish({
          key: s.key,
          instId, instType: 'SPOT',
          side: 'long',
          openTime: s.openTime, closeTime: s.closeTime,
          openPx, closePx,
          qty: s.matched, contracts: s.matched,
          lever: 1, margin: 0,
          gross, fee: s.fee, funding: 0, penalty: 0,
          net: gross - s.fee,
          closeType: 'Vente spot',
          liquidated: false, mgnMode: 'cash',
          digits: meta ? meta.digits : null,
          source: 'spot',
        }));
      }

      // lots encore ouverts = position spot en cours (non comptée en trade)
      if (lots.length) {
        const q = lots.reduce((a, l) => a + l.qty, 0);
        if (q > 1e-10) {
          out.openLots = out.openLots || [];
          out.openLots.push({
            instId, qty: q,
            avgPx: lots.reduce((a, l) => a + l.qty * l.px, 0) / q,
          });
        }
      }
    }

    out.unmatched = { qty: unmatchedQty, count: unmatchedCount };
    return out;
  }

  /* ─────────────── 3. import CSV (exports OKX) ─────────────── */

  /* parseur CSV complet : guillemets, séparateur auto, CRLF */
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const head = text.slice(0, 4000);
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of head) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] !== undefined) counts[ch]++;
    }
    const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  }

  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  /* trouve l'index d'une colonne à partir de mots-clés (FR + EN) */
  function col(headers, ...keys) {
    for (const k of keys) {
      const nk = norm(k);
      const i = headers.findIndex((h) => h === nk);
      if (i >= 0) return i;
    }
    for (const k of keys) {
      const nk = norm(k);
      const i = headers.findIndex((h) => h.includes(nk));
      if (i >= 0) return i;
    }
    return -1;
  }

  function num(v) {
    if (v == null) return 0;
    let s = String(v).trim().replace(/\s| /g, '').replace(/[^\d.,+\-eE]/g, '');
    if (!s) return 0;
    // 1.234,56 (fr) vs 1,234.56 (en)
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function time(v) {
    if (v == null || v === '') return 0;
    const s = String(v).trim();
    if (/^\d{13}$/.test(s)) return +s;
    if (/^\d{10}$/.test(s)) return +s * 1000;
    // « 2026-01-31 14:05:22 » → interprété en heure locale
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    const d = Date.parse(s.replace(' ', 'T'));
    return isNaN(d) ? 0 : d;
  }

  /* Détecte le format et convertit. Renvoie { trades, format, rows, skipped } */
  function fromCsv(text, instruments) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('Fichier CSV vide ou illisible');
    const headers = rows[0].map(norm);
    const body = rows.slice(1);

    const iOpenPx = col(headers, 'openaverageprice', 'avgopenprice', 'openprice', 'prixdouverturemoyen', 'prixouverture', 'entryprice');
    const iClosePx = col(headers, 'closeaverageprice', 'avgcloseprice', 'closeprice', 'prixdecloturemoyen', 'prixcloture', 'exitprice');

    /* — Format A : historique de positions (entrée + sortie sur la ligne) — */
    if (iOpenPx >= 0 && iClosePx >= 0) {
      const iInst = col(headers, 'instrument', 'underlying', 'symbol', 'contract', 'paire');
      const iDir = col(headers, 'direction', 'side', 'positionside', 'sens');
      const iQty = col(headers, 'closedposition', 'positionqty', 'closingquantity', 'quantity', 'amount', 'size', 'quantite', 'volume');
      const iPnl = col(headers, 'realizedpnl', 'pnl', 'profitloss', 'profit', 'gainsetpertes');
      const iFee = col(headers, 'fee', 'fees', 'frais', 'commission');
      const iFund = col(headers, 'fundingfee', 'funding', 'financement');
      const iLev = col(headers, 'leverage', 'lever', 'levier');
      const iOpenT = col(headers, 'opentime', 'createdtime', 'heuredouverture', 'dateouverture');
      const iCloseT = col(headers, 'closetime', 'updatetime', 'heuredecloture', 'datecloture');
      const iType = col(headers, 'closetype', 'typedecloture', 'type');

      const trades = [];
      let skipped = 0;
      for (const r of body) {
        const instId = String(r[iInst] || '').trim().toUpperCase();
        const openPx = num(r[iOpenPx]), closePx = num(r[iClosePx]);
        const qty = Math.abs(num(r[iQty]));
        if (!instId || !openPx || !qty) { skipped++; continue; }
        const dirRaw = norm(r[iDir]);
        const side = /short|sell|vente|vendre|baisse/.test(dirRaw) ? 'short' : 'long';
        const fee = Math.abs(num(r[iFee]));
        const funding = iFund >= 0 ? num(r[iFund]) : 0;
        const net = iPnl >= 0 ? num(r[iPnl]) : 0;
        const openTime = time(r[iOpenT]), closeTime = time(r[iCloseT]);
        const instType = /-SWAP$/.test(instId) ? 'SWAP' : (/-\d{6}$/.test(instId) ? 'FUTURES' : 'SPOT');
        const meta = instruments && instruments.get(instId);
        const ctVal = meta && meta.ctVal ? meta.ctVal : 1;

        trades.push(finish({
          key: `csv:${instId}:${openTime}:${closeTime}:${qty}`,
          instId, instType, side,
          openTime, closeTime,
          openPx, closePx,
          qty: baseQty(instType, qty, ctVal), contracts: qty,
          lever: iLev >= 0 ? (num(r[iLev]) || 1) : 1,
          margin: 0,
          gross: net + fee - funding,
          fee, funding, penalty: 0, net,
          closeType: iType >= 0 ? String(r[iType] || 'Clôture').trim() : 'Clôture',
          liquidated: /liquidat/i.test(String(r[iType] || '')),
          mgnMode: '', source: 'csv',
        }));
      }
      return { trades, format: 'positions', rows: body.length, skipped };
    }

    /* — Format B : historique d'exécutions → FIFO — */
    const iInst = col(headers, 'instrument', 'symbol', 'pair', 'paire', 'contract');
    const iSide = col(headers, 'side', 'direction', 'sens', 'type');
    const iPx = col(headers, 'filledprice', 'avgfilledprice', 'price', 'executionprice', 'prix');
    const iQty = col(headers, 'filledquantity', 'filledamount', 'amount', 'quantity', 'size', 'quantite', 'volume');
    const iFee = col(headers, 'fee', 'fees', 'frais', 'commission');
    const iFeeCcy = col(headers, 'feecurrency', 'feeccy', 'devisedesfrais');
    const iTime = col(headers, 'time', 'ordertime', 'createtime', 'filledtime', 'date', 'heure');
    const iOrd = col(headers, 'orderid', 'ordid', 'numerodordre');

    if (iInst < 0 || iSide < 0 || iPx < 0 || iQty < 0) {
      throw new Error('Colonnes non reconnues. Exportez depuis OKX « Historique des positions » ou « Historique des ordres ».');
    }

    const fills = [];
    let skipped = 0;
    for (const r of body) {
      const instId = String(r[iInst] || '').trim().toUpperCase();
      const px = num(r[iPx]), sz = Math.abs(num(r[iQty]));
      if (!instId || !px || !sz) { skipped++; continue; }
      const sideRaw = norm(r[iSide]);
      const side = /sell|short|vente|vendre/.test(sideRaw) ? 'sell' : 'buy';
      fills.push({
        instId, fillPx: String(px), fillSz: String(sz), side,
        fee: String(-Math.abs(num(r[iFee]))),
        feeCcy: iFeeCcy >= 0 ? String(r[iFeeCcy] || '').trim().toUpperCase() : '',
        ts: String(time(r[iTime])),
        ordId: iOrd >= 0 ? String(r[iOrd] || '').trim() : `${instId}-${time(r[iTime])}-${side}`,
      });
    }
    const trades = fromSpotFills(fills, instruments).map((t) => ({ ...t, source: 'csv', key: 'csv' + t.key.slice(4) }));
    return { trades, format: 'fills', rows: body.length, skipped };
  }

  /* ─────────────── fusion / archive ─────────────── */

  function merge(...lists) {
    const map = new Map();
    for (const list of lists) {
      for (const t of (list || [])) {
        if (!t || !t.key) continue;
        // l'API fait autorité sur le CSV en cas de doublon
        const prev = map.get(t.key);
        if (!prev || (prev.source === 'csv' && t.source !== 'csv')) map.set(t.key, t);
      }
    }
    // dédoublonnage souple : même instrument, même sortie à la seconde près
    const seen = new Map();
    const out = [];
    for (const t of [...map.values()].sort((a, b) => a.closeTime - b.closeTime)) {
      const soft = `${t.instId}|${Math.round(t.closeTime / 1000)}|${t.qty.toFixed(6)}`;
      const prev = seen.get(soft);
      if (prev) {
        if (prev.source === 'csv' && t.source !== 'csv') {
          out[out.indexOf(prev)] = t;
          seen.set(soft, t);
        }
        continue;
      }
      seen.set(soft, t);
      out.push(t);
    }
    return out;
  }

  function toCsv(trades) {
    const head = ['instrument', 'type', 'sens', 'ouverture', 'cloture', 'prix_entree', 'prix_sortie',
      'quantite', 'levier', 'notionnel', 'brut', 'frais', 'financement', 'net', 'ret_marge_pct', 'duree_min', 'cloture_type', 'source'];
    const iso = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '');
    const lines = [head.join(',')];
    for (const t of trades) {
      lines.push([
        t.instId, t.instType, t.side, iso(t.openTime), iso(t.closeTime),
        t.openPx, t.closePx, t.qty, t.lever, t.notional.toFixed(2),
        t.gross.toFixed(6), t.fee.toFixed(6), t.funding.toFixed(6), t.net.toFixed(6),
        t.retMargin.toFixed(3), (t.durationMs / 60000).toFixed(1),
        `"${String(t.closeType).replace(/"/g, '""')}"`, t.source,
      ].join(','));
    }
    return lines.join('\n');
  }

  return { fromPositionsHistory, fromSpotFills, fromCsv, parseCsv, merge, toCsv, finish, CLOSE_TYPE };
})();
