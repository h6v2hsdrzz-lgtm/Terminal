/* ════════════════════════════════════════════════════════════
   app.js — Orchestration : sélection du courtier, panneaux
   temps réel (watchlist, graphique, carnet, tape, stats, news,
   IA), trading (paper ou réel), alertes, ligne de commande.
   ════════════════════════════════════════════════════════════ */
'use strict';

const $ = (id) => document.getElementById(id);
const ALERT_STORE = 'terminal-alerts';
const TF_NAMES = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1H', 240: '4H', 1440: '1D', 10080: '1W' };
function tfName(tf) { return TF_NAMES[tf] || tf + 'min'; }

const state = {
  provider: null,
  account: null,
  broker: 'okx',
  symbols: new Map(),      // symbol -> info (bid/ask/digits/24h…)
  watchlist: [],
  selected: null,
  tf: 60,
  chart: null,
  lastBook: null,
  lastStats: null,
  alerts: [],
  alertSeq: 1,
  cmdHistory: [],
  cmdIdx: -1,
  tapeBuf: [],
};

/* ─────────────── helpers ─────────────── */

function setStatus(msg, cls) {
  const el = $('status-msg');
  el.textContent = msg;
  el.className = cls || '';
}

function fmtNum(v, d = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtCompact(v) {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + ' Md';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + ' M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + ' k';
  return String(Math.round(v));
}
function fmtPrice(v, digits) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(digits == null ? 2 : digits);
}
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pd(x) { return String(x).padStart(2, '0'); }
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return Math.round(s) + ' s';
  if (s < 5400) return Math.round(s / 60) + ' min';
  if (s < 129600) return Math.round(s / 3600) + ' h';
  return Math.round(s / 86400) + ' j';
}
function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
  return isNaN(n) ? null : n;
}
function cssId(s) { return s.replace(/[^A-Za-z0-9]/g, '_'); }

function toast(title, body) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<b>${escHtml(title)}</b><br>${escHtml(body)}`;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 7000);
}

/* ─────────────── modal ─────────────── */

function showModal(title, bodyHtml, buttons) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHtml;
  const btns = $('modal-btns');
  btns.innerHTML = '';
  (buttons || []).forEach((b) => {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.className = b.cls || 'm-cancel';
    el.onclick = () => { hideModal(); if (b.fn) b.fn(); };
    btns.appendChild(el);
  });
  $('modal-overlay').classList.remove('hidden');
}
function hideModal() { $('modal-overlay').classList.add('hidden'); }
$('modal-x').onclick = hideModal;
$('modal-overlay').addEventListener('click', (e) => { if (e.target === $('modal-overlay')) hideModal(); });

/* ─────────────── login ─────────────── */

document.querySelectorAll('.broker-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.broker-card').forEach((c) => c.classList.toggle('sel', c === card));
    state.broker = card.dataset.broker;
    $('xtb-fields').classList.toggle('hidden', state.broker !== 'xtb');
  });
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.textContent = '';
  const btn = $('login-btn');
  btn.disabled = true; btn.textContent = 'Connexion…';
  try {
    if (state.broker === 'okx') {
      state.provider = new OKXProvider();
      await state.provider.connect();
      state.account = new PaperAccount('okx', 100000, 'USDT');
    } else if (state.broker === 'xtb') {
      const id = $('login-id').value.trim(), pw = $('login-pw').value;
      if (!id || !pw) throw new Error('Identifiant et mot de passe requis');
      const mode = document.querySelector('input[name=xtbmode]:checked').value;
      state.provider = new XTBProvider(mode);
      await state.provider.connect({ id, pw });
      state.account = new XTBAccount(state.provider);
      await state.account.init();
    } else {
      state.provider = new SimProvider();
      await state.provider.connect();
      state.account = new PaperAccount('sim', 100000, 'USD');
    }
    state.provider.onDisconnect = () => setStatus('Connexion au flux perdue — rechargez la page', 'err');
    await startTerminal();
  } catch (ex) {
    err.textContent = ex.message || 'Échec de connexion';
    btn.disabled = false; btn.textContent = 'Lancer le terminal';
  }
});

$('btn-logout').onclick = () => {
  if (state.provider) state.provider.close();
  location.reload();
};

/* ─────────────── démarrage ─────────────── */

async function startTerminal() {
  $('login-overlay').classList.add('hidden');
  $('terminal').classList.remove('hidden');
  $('conn-mode').textContent = state.provider.label;
  $('ticket-mode').textContent = state.account instanceof PaperAccount ? 'PAPER' : state.provider.label;
  $('t-qty').value = state.provider.defaultQty;
  $('a-extra-label').textContent = state.account instanceof PaperAccount ? 'Trades clos' : 'Marge';

  state.chart = new TerminalChart($('chart'), $('chart-legend'));
  loadAlerts();
  startClock();
  bindUI();
  wireProvider();
  setStatus('Chargement des marchés…');

  for (const s of state.provider.defaultWatchlist) addSymbol(s, { silent: true });
  await selectSymbol(state.provider.defaultWatchlist[0]);

  renderAccount();
  renderPositions();
  loadNews();
  setStatus('Prêt — HELP pour la liste des commandes', 'ok');
  $('cmd').focus();
}

function wireProvider() {
  const p = state.provider;
  p.onTick(onTick);
  p.onBook((b) => { if (b.symbol === state.selected) { state.lastBook = b; renderBook(b); } });
  p.onTrade((t) => { if (t.symbol === state.selected) pushTape(t); });
  if (state.account.onUpdate) {
    state.account.onUpdate((kind, payload) => {
      if (kind === 'closed') {
        const p2 = payload.position;
        toast(payload.reason === 'Manuel' ? 'Position clôturée' : payload.reason + ' exécuté',
          `${p2.side === 'buy' ? 'Achat' : 'Vente'} ${p2.qty} ${p2.symbol} → P/L ${fmtNum(payload.pl)}`);
      }
      renderPositions();
      renderAccount();
    });
  }
  // rafraîchit compte + P/L en continu
  setInterval(() => { renderAccount(); refreshPosPl(); }, 2000);
  // stats instrument périodiques
  setInterval(() => { if (state.selected) loadStats(state.selected, true); }, 30000);
}

/* ─────────────── ticks ─────────────── */

function onTick(d) {
  let info = state.symbols.get(d.symbol);
  if (!info) return;
  const dir = d.last > (info.last || info.bid) ? 1 : d.last < (info.last || info.bid) ? -1 : 0;
  Object.assign(info, {
    bid: d.bid, ask: d.ask, last: d.last,
    high24h: d.high24h != null ? d.high24h : info.high24h,
    low24h: d.low24h != null ? d.low24h : info.low24h,
    open24h: d.open24h != null ? d.open24h : info.open24h,
    vol24h: d.vol24h != null ? d.vol24h : info.vol24h,
    volCcy24h: d.volCcy24h != null ? d.volCcy24h : info.volCcy24h,
  });
  updateWatchRow(d.symbol, dir);
  state.account.tick(d.symbol, d.bid, d.ask);
  checkAlerts(d.symbol, d.last != null ? d.last : d.bid);

  if (d.symbol === state.selected) {
    updateHeader(info);
    state.chart.tick(d.last != null ? d.last : d.bid, d.ts || Date.now());
  }
}

function updateHeader(info) {
  $('chart-last').textContent = fmtPrice(info.last, info.digits);
  $('t-bid').textContent = fmtPrice(info.bid, info.digits);
  $('t-ask').textContent = fmtPrice(info.ask, info.digits);
  const chgEl = $('chart-chg');
  if (info.open24h) {
    const pct = (info.last - info.open24h) / info.open24h * 100;
    chgEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '% 24h';
    chgEl.className = pct >= 0 ? 'up' : 'dn';
  } else { chgEl.textContent = ''; }
}

/* ─────────────── watchlist ─────────────── */

async function addSymbol(symbol, opts = {}) {
  symbol = symbol.toUpperCase();
  if (state.watchlist.includes(symbol)) {
    if (!opts.silent) setStatus(symbol + ' déjà dans la watchlist', 'warn');
    return true;
  }
  try {
    const info = await state.provider.getSymbol(symbol);
    state.symbols.set(symbol, info);
    state.watchlist.push(symbol);
    renderWatchRow(symbol);
    state.provider.subscribe(symbol);
    if (!opts.silent) setStatus(symbol + ' ajouté', 'ok');
    return true;
  } catch (ex) {
    if (!opts.silent) setStatus(`${symbol}: ${ex.message}`, 'err');
    return false;
  }
}

function removeSymbol(symbol) {
  symbol = symbol.toUpperCase();
  const i = state.watchlist.indexOf(symbol);
  if (i < 0) { setStatus(symbol + ' absent de la watchlist', 'warn'); return; }
  state.watchlist.splice(i, 1);
  const row = $('w-' + cssId(symbol));
  if (row) row.remove();
  setStatus(symbol + ' retiré', 'ok');
}

function renderWatchRow(symbol) {
  let tr = $('w-' + cssId(symbol));
  if (!tr) {
    tr = document.createElement('tr');
    tr.id = 'w-' + cssId(symbol);
    tr.onclick = () => selectSymbol(symbol);
    tr.innerHTML = '<td class="sym"></td><td class="w-last num"></td><td class="w-chg num"></td>';
    $('watch-body').appendChild(tr);
  }
  tr.classList.toggle('sel', state.selected === symbol);
  tr.querySelector('.sym').textContent = symbol;
  updateWatchRow(symbol, null);
}

function updateWatchRow(symbol, dir) {
  const tr = $('w-' + cssId(symbol));
  const info = state.symbols.get(symbol);
  if (!tr || !info) return;
  const lastTd = tr.querySelector('.w-last');
  lastTd.textContent = fmtPrice(info.last != null ? info.last : info.bid, info.digits);
  const chgTd = tr.querySelector('.w-chg');
  if (info.open24h) {
    const pct = ((info.last || info.bid) - info.open24h) / info.open24h * 100;
    chgTd.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    chgTd.className = 'w-chg num ' + (pct >= 0 ? 'up' : 'dn');
  } else { chgTd.textContent = '—'; chgTd.className = 'w-chg num muted'; }
  if (dir) {
    lastTd.classList.remove('flash-up', 'flash-dn');
    void lastTd.offsetWidth;
    lastTd.classList.add(dir > 0 ? 'flash-up' : 'flash-dn');
  }
}

/* recherche de symboles */
let suggestTimer = null;
function bindSearch() {
  const inp = $('watch-search'), box = $('watch-suggest');
  inp.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = inp.value.trim();
    if (!q) { box.classList.add('hidden'); return; }
    suggestTimer = setTimeout(async () => {
      const res = await state.provider.searchSymbols(q).catch(() => []);
      box.innerHTML = '';
      if (!res.length) {
        box.innerHTML = `<div class="suggest-item muted">Aucun résultat — Entrée pour essayer « ${escHtml(q.toUpperCase())} »</div>`;
      }
      for (const r of res) {
        const div = document.createElement('div');
        div.className = 'suggest-item';
        div.innerHTML = `<span>${escHtml(r.symbol)}</span><span class="muted">${escHtml(r.description || '')}</span>`;
        div.onclick = () => { inp.value = ''; box.classList.add('hidden'); addSymbol(r.symbol).then((ok) => ok && selectSymbol(r.symbol)); };
        box.appendChild(div);
      }
      box.classList.remove('hidden');
    }, 200);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = inp.value.trim().toUpperCase();
      if (q) addSymbol(q).then((ok) => ok && selectSymbol(q));
      inp.value = ''; box.classList.add('hidden');
    } else if (e.key === 'Escape') { inp.value = ''; box.classList.add('hidden'); }
  });
  document.addEventListener('click', (e) => {
    if (!box.contains(e.target) && e.target !== inp) box.classList.add('hidden');
  });
}

/* ─────────────── sélection & graphique ─────────────── */

async function selectSymbol(symbol, tf) {
  symbol = symbol.toUpperCase();
  if (!state.symbols.has(symbol)) {
    const ok = await addSymbol(symbol);
    if (!ok) return;
  }
  state.selected = symbol;
  if (tf) state.tf = tf;
  const info = state.symbols.get(symbol);

  document.querySelectorAll('#watch-body tr').forEach((r) => r.classList.toggle('sel', r.id === 'w-' + cssId(symbol)));
  document.querySelectorAll('#period-btns button').forEach((b) => b.classList.toggle('on', +b.dataset.p === state.tf));
  $('chart-sym').textContent = symbol;
  updateHeader(info);
  $('book').innerHTML = ''; $('tape').innerHTML = ''; state.tapeBuf = [];
  if (state.provider.focus) state.provider.focus(symbol);

  try {
    setStatus(`Chargement ${symbol} ${tfName(state.tf)}…`);
    const candles = await state.provider.getCandles(symbol, state.tf, 300);
    if (state.selected !== symbol) return;
    state.chart.setData(symbol, state.tf, info.digits, candles);
    drawPositionLines();
    drawAlertLines();
    refreshTA();
    setStatus(`${symbol} ${tfName(state.tf)} — ${candles.length} bougies`, 'ok');
  } catch (ex) {
    setStatus(`${symbol}: ${ex.message}`, 'err');
  }
  loadStats(symbol);
}

/* ─────────────── carnet & tape ─────────────── */

function renderBook(b) {
  const info = state.symbols.get(b.symbol);
  const dg = info ? info.digits : 2;
  const maxQ = Math.max(...b.bids.map((x) => x[1]), ...b.asks.map((x) => x[1]), 1e-9);
  const row = (px, q, cls) =>
    `<div class="book-row ${cls}">
      <span class="br-px">${fmtPrice(px, dg)}</span><span class="br-qty">${fmtNum(q, 4)}</span>
      <span class="br-bar" style="width:${Math.min(100, q / maxQ * 100)}%"></span>
    </div>`;
  const asks = [...b.asks].reverse().map((x) => row(x[0], x[1], 'ask')).join('');
  const bids = b.bids.map((x) => row(x[0], x[1], 'bid')).join('');
  const mid = (b.asks[0][0] + b.bids[0][0]) / 2;
  const spread = b.asks[0][0] - b.bids[0][0];
  $('book').innerHTML = asks +
    `<div class="book-mid num">${fmtPrice(mid, dg)}<span class="book-spread">spread ${fmtPrice(spread, dg)}</span></div>` +
    bids;
}

function pushTape(t) {
  const info = state.symbols.get(t.symbol);
  const dg = info ? info.digits : 2;
  state.tapeBuf.unshift(t);
  if (state.tapeBuf.length > 40) state.tapeBuf.pop();
  const d = new Date(t.ts);
  $('tape').innerHTML = state.tapeBuf.map((x) =>
    `<div class="tape-row">
      <span class="${x.side === 'buy' ? 'up' : 'dn'} num">${fmtPrice(x.px, dg)}</span>
      <span class="num">${fmtNum(x.qty, 4)}</span>
      <span class="muted">${pd(new Date(x.ts).getHours())}:${pd(new Date(x.ts).getMinutes())}:${pd(new Date(x.ts).getSeconds())}</span>
    </div>`).join('');
}

/* ─────────────── stats ─────────────── */

async function loadStats(symbol, silent) {
  try {
    const s = await state.provider.getStats(symbol);
    if (state.selected !== symbol) return;
    state.lastStats = s;
    const info = state.symbols.get(symbol) || {};
    const dg = info.digits;
    const rows = [];
    const add = (label, val, cls) => { if (val != null && val !== '—') rows.push(`<div class="stat-row"><label>${label}</label><span class="${cls || ''}">${val}</span></div>`); };
    const sect = (t) => rows.push(`<div class="stat-sect">${t}</div>`);

    sect('Marché 24h');
    if (s.open24h && s.last) {
      const pct = (s.last - s.open24h) / s.open24h * 100;
      add('Variation', (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%', pct >= 0 ? 'up' : 'dn');
    }
    add('Plus haut', fmtPrice(s.high24h, dg));
    add('Plus bas', fmtPrice(s.low24h, dg));
    add('Volume (base)', fmtCompact(s.vol24h));
    add('Volume (quote)', s.volCcy24h != null ? fmtCompact(s.volCcy24h) + ' $' : null);

    if (s.funding != null || s.oiCcy != null || s.indexPx != null) {
      sect('Dérivés (perp)');
      if (s.funding != null) add('Funding', (s.funding * 100).toFixed(4) + '%', s.funding >= 0 ? 'up' : 'dn');
      if (s.nextFunding) add('Prochain funding', new Date(s.nextFunding).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      if (s.oiCcy != null) add('Open interest', fmtCompact(s.oiCcy));
      if (s.indexPx != null) add('Prix index', fmtPrice(s.indexPx, dg));
    }
    if (s.contractSize != null || s.leverage != null) {
      sect('Contrat CFD');
      add('Taille de contrat', fmtNum(s.contractSize, 0));
      add('Marge requise', s.leverage != null ? s.leverage + '%' : null);
      add('Swap long / short', s.swapLong != null ? `${fmtNum(s.swapLong, 5)} / ${fmtNum(s.swapShort, 5)}` : null);
      add('Spread', s.spreadPts != null ? s.spreadPts + ' pts' : null);
    }

    // volatilité calculée sur le graphique courant
    if (state.chart.candles.length > 15) {
      sect('Volatilité (' + tfName(state.tf) + ')');
      const atr = TA.atr(state.chart.candles);
      const lastAtr = atr[atr.length - 1];
      if (lastAtr != null) {
        add('ATR 14', fmtPrice(lastAtr, dg));
        if (s.last) add('ATR %', (lastAtr / s.last * 100).toFixed(2) + '%');
      }
      const closes = state.chart.candles.map((c) => c.c);
      const rets = [];
      for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
      add('σ par bougie', (sd * 100).toFixed(3) + '%');
    }

    $('stats-body').innerHTML = rows.join('') ||
      '<div class="news-empty">Pas de statistiques disponibles.</div>';
  } catch (ex) {
    if (!silent) $('stats-body').innerHTML = `<div class="news-empty">${escHtml(ex.message)}</div>`;
  }
}

/* ─────────────── compte / positions ─────────────── */

function renderAccount() {
  const s = state.account.getSummary();
  const cur = s.currency ? ' ' + s.currency : '';
  $('a-bal').textContent = fmtNum(s.balance) + cur;
  $('a-eq').textContent = fmtNum(s.equity) + cur;
  const plEl = $('a-pl');
  plEl.textContent = fmtNum(s.openPl);
  plEl.style.color = (s.openPl || 0) >= 0 ? 'var(--up)' : 'var(--dn)';
  if (state.account instanceof PaperAccount) {
    $('a-extra').textContent = String(state.account.history.length);
  } else {
    $('a-extra').textContent = fmtNum(s.margin);
  }
}

function renderPositions() {
  const positions = state.account.getPositions();
  const body = $('pos-body');
  body.innerHTML = '';
  for (const p of positions) {
    const info = state.symbols.get(p.symbol);
    const dg = p.digits != null ? p.digits : (info ? info.digits : 2);
    const cur = info ? (p.side === 'buy' ? info.bid : info.ask) : null;
    const plPct = p.entry ? (p.pl / (p.entry * p.qty)) * 100 : null;
    const tr = document.createElement('tr');
    tr.id = 'pos-' + p.id;
    tr.innerHTML =
      `<td class="sym">${escHtml(p.symbol)}</td>` +
      `<td class="side-${p.side}">${p.side === 'buy' ? 'Achat' : 'Vente'}</td>` +
      `<td class="num">${fmtNum(p.qty, 4)}</td>` +
      `<td class="num">${fmtPrice(p.entry, dg)}</td>` +
      `<td class="num p-cur">${fmtPrice(cur, dg)}</td>` +
      `<td class="num muted">${p.sl ? fmtPrice(p.sl, dg) : '—'}</td>` +
      `<td class="num muted">${p.tp ? fmtPrice(p.tp, dg) : '—'}</td>` +
      `<td class="num p-pl ${p.pl >= 0 ? 'up' : 'dn'}">${fmtNum(p.pl)}</td>` +
      `<td class="num ${plPct >= 0 ? 'up' : 'dn'}">${plPct != null ? (plPct >= 0 ? '+' : '') + plPct.toFixed(2) + '%' : '—'}</td>` +
      `<td><button class="btn-close-pos">Clôturer</button></td>`;
    tr.querySelector('.btn-close-pos').onclick = () => confirmClose(p.id);
    body.appendChild(tr);
  }
  $('pos-count').textContent = positions.length ? `(${positions.length})` : '';
  drawPositionLines();
}

function refreshPosPl() {
  for (const p of state.account.getPositions()) {
    const row = $('pos-' + p.id);
    if (!row) { renderPositions(); return; }
    const info = state.symbols.get(p.symbol);
    const dg = p.digits != null ? p.digits : (info ? info.digits : 2);
    const plTd = row.querySelector('.p-pl');
    plTd.textContent = fmtNum(p.pl);
    plTd.className = 'num p-pl ' + (p.pl >= 0 ? 'up' : 'dn');
    if (info) row.querySelector('.p-cur').textContent = fmtPrice(p.side === 'buy' ? info.bid : info.ask, dg);
  }
  const rows = $('pos-body').children.length;
  if (rows !== state.account.getPositions().length) renderPositions();
}

function drawPositionLines() {
  if (!state.chart) return;
  state.chart.clearPriceLines('pos-');
  for (const p of state.account.getPositions()) {
    if (p.symbol !== state.selected) continue;
    state.chart.setPriceLine('pos-' + p.id, p.entry,
      p.side === 'buy' ? 'rgba(46,189,133,.9)' : 'rgba(246,70,93,.9)',
      (p.side === 'buy' ? 'Achat ' : 'Vente ') + p.qty, 0);
    if (p.sl) state.chart.setPriceLine('pos-sl-' + p.id, p.sl, 'rgba(246,70,93,.5)', 'SL', 2);
    if (p.tp) state.chart.setPriceLine('pos-tp-' + p.id, p.tp, 'rgba(46,189,133,.5)', 'TP', 2);
  }
}

async function loadHistory() {
  const body = $('hist-body');
  body.innerHTML = '<tr><td colspan="8" class="muted">Chargement…</td></tr>';
  try {
    const hist = await Promise.resolve(state.account.getHistory());
    body.innerHTML = '';
    for (const t of hist.slice(0, 200)) {
      const info = state.symbols.get(t.symbol);
      const dg = info ? info.digits : 2;
      const d = new Date(t.closeTime);
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="muted">${pd(d.getDate())}/${pd(d.getMonth() + 1)} ${pd(d.getHours())}:${pd(d.getMinutes())}</td>` +
        `<td class="sym">${escHtml(t.symbol)}</td>` +
        `<td class="side-${t.side}">${t.side === 'buy' ? 'Achat' : 'Vente'}</td>` +
        `<td class="num">${fmtNum(t.qty, 4)}</td>` +
        `<td class="num">${fmtPrice(t.entry, dg)}</td>` +
        `<td class="num">${fmtPrice(t.exit, dg)}</td>` +
        `<td class="num ${t.pl >= 0 ? 'up' : 'dn'}">${fmtNum(t.pl)}</td>` +
        `<td class="muted">${escHtml(t.reason || '—')}</td>`;
      body.appendChild(tr);
    }
    if (!hist.length) body.innerHTML = '<tr><td colspan="8" class="muted">Aucun trade clôturé.</td></tr>';
    renderPfStats(hist);
  } catch (ex) {
    body.innerHTML = `<tr><td colspan="8" class="dn">${escHtml(ex.message)}</td></tr>`;
  }
}

function renderPfStats(hist) {
  const el = $('pf-stats');
  if (!hist.length) { el.innerHTML = ''; return; }
  const wins = hist.filter((t) => t.pl > 0);
  const gw = wins.reduce((a, t) => a + t.pl, 0);
  const gl = Math.abs(hist.filter((t) => t.pl <= 0).reduce((a, t) => a + t.pl, 0));
  const total = hist.reduce((a, t) => a + t.pl, 0);
  const pf = gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0);
  const cell = (label, val, cls) => `<div class="pf-cell"><label>${label}</label><span class="${cls || ''}">${val}</span></div>`;
  el.innerHTML =
    cell('Trades', hist.length) +
    cell('Taux de réussite', (wins.length / hist.length * 100).toFixed(0) + '%') +
    cell('P/L total', fmtNum(total), total >= 0 ? 'up' : 'dn') +
    cell('Profit factor', pf === Infinity ? '∞' : pf.toFixed(2), pf >= 1 ? 'up' : 'dn') +
    cell('Gain moyen', fmtNum(wins.length ? gw / wins.length : 0, 2)) +
    cell('Perte moyenne', fmtNum(hist.length - wins.length ? gl / (hist.length - wins.length) : 0, 2));
}

/* ─────────────── ordres ─────────────── */

function confirmOrder(side, qty, sl, tp) {
  const symbol = state.selected;
  const info = state.symbols.get(symbol);
  if (!info) { setStatus('Sélectionnez d\'abord un instrument', 'err'); return; }
  if (!qty || qty <= 0) { setStatus('Quantité invalide', 'err'); return; }
  const buy = side === 'buy';
  const price = buy ? info.ask : info.bid;
  const isPaper = state.account instanceof PaperAccount;
  const notional = price * qty;
  showModal(`${buy ? 'Achat' : 'Vente'} ${symbol} ${isPaper ? '· paper' : '· ' + state.provider.label}`,
    `<table>
      <tr><td>Instrument</td><td>${escHtml(symbol)} — ${escHtml(info.description || '')}</td></tr>
      <tr><td>Sens</td><td class="${buy ? 'up' : 'dn'}" style="font-weight:650">${buy ? 'ACHAT' : 'VENTE'} au marché</td></tr>
      <tr><td>Quantité</td><td>${fmtNum(qty, 4)}</td></tr>
      <tr><td>Prix indicatif</td><td>${fmtPrice(price, info.digits)}</td></tr>
      <tr><td>Notionnel</td><td>≈ ${fmtNum(notional)} ${escHtml(state.account.getSummary().currency || '')}</td></tr>
      <tr><td>Stop Loss</td><td>${sl ? fmtPrice(sl, info.digits) : '—'}</td></tr>
      <tr><td>Take Profit</td><td>${tp ? fmtPrice(tp, info.digits) : '—'}</td></tr>
    </table>
    <div class="m-warn">${isPaper ? 'Ordre fictif (paper trading) exécuté aux prix réels du marché.' : '⚠ Ordre RÉEL sur votre compte ' + escHtml(state.provider.label) + '.'}</div>`,
    [
      { label: 'Annuler', cls: 'm-cancel' },
      {
        label: buy ? 'Confirmer l\'achat' : 'Confirmer la vente',
        cls: buy ? 'm-confirm-buy' : 'm-confirm-sell',
        fn: async () => {
          try {
            setStatus('Envoi de l\'ordre…', 'warn');
            await state.account.market(symbol, side, qty, sl, tp);
            setStatus('Ordre exécuté', 'ok');
            toast('Ordre exécuté', `${buy ? 'Achat' : 'Vente'} ${qty} ${symbol}`);
            renderPositions(); renderAccount();
          } catch (ex) {
            setStatus('Ordre refusé : ' + ex.message, 'err');
            toast('Ordre refusé', ex.message);
          }
        },
      },
    ]);
}

function confirmClose(id) {
  const p = state.account.getPositions().find((x) => x.id === id);
  if (!p) return;
  showModal(`Clôturer ${p.symbol}`,
    `<table>
      <tr><td>Position</td><td>#${p.id} · ${p.side === 'buy' ? 'Achat' : 'Vente'} ${fmtNum(p.qty, 4)} ${escHtml(p.symbol)}</td></tr>
      <tr><td>Entrée</td><td>${p.entry}</td></tr>
      <tr><td>P/L actuel</td><td class="${(p.pl || 0) >= 0 ? 'up' : 'dn'}">${fmtNum(p.pl)}</td></tr>
    </table>`,
    [
      { label: 'Annuler', cls: 'm-cancel' },
      {
        label: 'Clôturer au marché', cls: 'm-confirm-sell',
        fn: async () => {
          try {
            await state.account.close(id);
            setStatus(`Position ${id} clôturée`, 'ok');
            renderPositions(); renderAccount();
          } catch (ex) { setStatus('Clôture refusée : ' + ex.message, 'err'); }
        },
      },
    ]);
}

/* ─────────────── news ─────────────── */

async function loadNews() {
  const list = $('news-list');
  list.innerHTML = '<div class="news-empty">Chargement…</div>';
  try {
    const items = await state.provider.getNews();
    items.sort((a, b) => b.time - a.time);
    list.innerHTML = '';
    for (const n of items.slice(0, 50)) {
      const div = document.createElement('div');
      div.className = 'news-item';
      div.innerHTML =
        `<div class="news-meta"><span class="news-src">${escHtml(n.source || '')}</span><span>il y a ${ago(n.time)}</span></div>` +
        `<div class="news-title">${escHtml(n.title)}</div>`;
      div.onclick = () => {
        if (n.url) window.open(n.url, '_blank', 'noopener');
        else {
          const tmp = document.createElement('div');
          tmp.innerHTML = n.body || '';
          showModal('News', `<b>${escHtml(n.title)}</b><br><br>${escHtml(tmp.textContent.trim() || '(pas de contenu)')}`,
            [{ label: 'Fermer', cls: 'm-cancel' }]);
        }
      };
      list.appendChild(div);
    }
    if (!items.length) list.innerHTML = '<div class="news-empty">Aucune actualité.</div>';
  } catch (ex) {
    list.innerHTML = `<div class="news-empty">News indisponibles : ${escHtml(ex.message)}</div>`;
  }
}

/* ─────────────── alertes ─────────────── */

function loadAlerts() {
  try {
    const raw = localStorage.getItem(ALERT_STORE);
    if (raw) {
      state.alerts = JSON.parse(raw);
      state.alertSeq = state.alerts.reduce((m, a) => Math.max(m, a.id), 0) + 1;
    }
  } catch {}
  renderAlerts();
}
function saveAlerts() { try { localStorage.setItem(ALERT_STORE, JSON.stringify(state.alerts)); } catch {} }

function addAlert(symbol, op, price) {
  symbol = symbol.toUpperCase();
  state.alerts.push({ id: state.alertSeq++, symbol, op, price, hit: null });
  saveAlerts(); renderAlerts(); drawAlertLines();
  if (!state.watchlist.includes(symbol)) addSymbol(symbol, { silent: true });
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  setStatus(`Alerte #${state.alertSeq - 1} : ${symbol} ${op} ${price}`, 'ok');
}

function deleteAlert(id) {
  state.alerts = state.alerts.filter((a) => a.id !== id);
  saveAlerts(); renderAlerts(); drawAlertLines();
}

function checkAlerts(symbol, price) {
  for (const a of state.alerts) {
    if (a.hit || a.symbol !== symbol) continue;
    if ((a.op === '>' && price > a.price) || (a.op === '<' && price < a.price)) {
      a.hit = Date.now();
      saveAlerts(); renderAlerts(); drawAlertLines();
      const msg = `${symbol} ${a.op} ${a.price} — dernier ${price}`;
      toast('Alerte déclenchée', msg);
      setStatus('Alerte : ' + msg, 'warn');
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Terminal — alerte', { body: msg }); } catch {}
      }
    }
  }
}

function renderAlerts() {
  const body = $('alert-body');
  body.innerHTML = '';
  for (const a of state.alerts) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="muted">${a.id}</td>` +
      `<td class="sym">${escHtml(a.symbol)}</td>` +
      `<td class="num">dernier ${a.op} ${a.price}</td>` +
      `<td class="${a.hit ? 'alert-hit' : 'alert-armed'}">${a.hit ? 'Déclenchée ' + new Date(a.hit).toLocaleTimeString('fr-FR') : 'Armée'}</td>` +
      `<td><button class="btn-del-alert">Suppr.</button></td>`;
    tr.querySelector('.btn-del-alert').onclick = () => deleteAlert(a.id);
    body.appendChild(tr);
  }
  if (!state.alerts.length) body.innerHTML = '<tr><td colspan="5" class="muted">Aucune alerte.</td></tr>';
  const armed = state.alerts.filter((a) => !a.hit).length;
  $('alert-count').textContent = armed ? `(${armed})` : '';
  $('st-alerts').textContent = armed ? `⏰ ${armed}` : '';
}

function drawAlertLines() {
  if (!state.chart) return;
  state.chart.clearPriceLines('alert-');
  for (const a of state.alerts) {
    if (a.hit || a.symbol !== state.selected) continue;
    state.chart.setPriceLine('alert-' + a.id, a.price, 'var(--accent)', '⏰ alerte', 3);
  }
}

/* ─────────────── onglets ─────────────── */

function showSideTab(name) {
  document.querySelectorAll('#panel-tabs .tab-btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  for (const t of ['book', 'stats', 'news', 'ai']) $('tab-' + t).classList.toggle('hidden', t !== name);
  if (name === 'ai') refreshTA();
  if (name === 'stats' && state.selected) loadStats(state.selected);
}
function showBottomTab(name) {
  document.querySelectorAll('#panel-bottom .tab-btn').forEach((b) => b.classList.toggle('on', b.dataset.btab === name));
  for (const t of ['pos', 'hist', 'alerts']) $('btab-' + t).classList.toggle('hidden', t !== name);
  if (name === 'hist') loadHistory();
}

/* ─────────────── IA ─────────────── */

function refreshTA() {
  const report = state.chart && state.chart.candles.length ? TA.report(state.chart.candles, state.chart.digits) : null;
  $('ai-ta').innerHTML = renderTAReport(state.selected || '—', report);
}

function aiKeyBadge() {
  $('ai-key-btn').classList.toggle('set', !!AIPanel.key);
  $('st-ai').textContent = AIPanel.key ? 'IA ✓' : '';
}

function aiKeyModal() {
  showModal('Clé API Anthropic',
    `<p>Le chat IA appelle l'API Anthropic (modèle <b>${AI_MODEL}</b>) directement depuis votre
     navigateur. La clé est stockée <b>localement</b> et n'est envoyée qu'à api.anthropic.com.</p><br>
     <input id="m-ai-key" type="password" placeholder="sk-ant-…" value="${escHtml(AIPanel.key)}"
       style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--txt);padding:8px 10px;font-size:12px;outline:none">
     <div class="m-warn">Clé à créer sur console.anthropic.com. L'analyse technique locale fonctionne sans clé.</div>`,
    [
      { label: 'Effacer', cls: 'm-cancel', fn: () => { AIPanel.key = ''; aiKeyBadge(); setStatus('Clé effacée', 'ok'); } },
      {
        label: 'Enregistrer', cls: 'm-confirm-buy',
        fn: () => {
          AIPanel.key = document.getElementById('m-ai-key').value.trim();
          aiKeyBadge();
          setStatus(AIPanel.key ? 'Clé enregistrée (localement)' : 'Clé effacée', 'ok');
        },
      },
    ]);
}

function aiMsg(cls, html, asText) {
  const div = document.createElement('div');
  div.className = 'ai-msg ' + cls;
  if (asText) div.textContent = html; else div.innerHTML = html;
  $('ai-chat').appendChild(div);
  $('ai-chat').scrollTop = $('ai-chat').scrollHeight;
  return div;
}

async function aiAskUI(question) {
  question = (question || '').trim();
  if (!question) return;
  showSideTab('ai');
  if (!AIPanel.key) {
    aiMsg('err', 'Aucune clé API configurée. Bouton ⚙ ci-dessous ou commande KEY. L\'analyse technique au-dessus fonctionne sans clé.', true);
    return;
  }
  aiMsg('user', question, true);
  const wait = aiMsg('wait', 'Analyse en cours…', true);
  try {
    const answer = await AIPanel.ask(question);
    wait.remove();
    aiMsg('bot', renderAiText(answer));
  } catch (ex) {
    wait.remove();
    aiMsg('err', 'IA : ' + ex.message, true);
  }
}

/* ─────────────── ligne de commande ─────────────── */

const HELP_HTML = `<div class="help-grid">
  <code>BTC-USDT</code><span>sélectionne l'instrument</span>
  <code>ETH-USDT 4H</code><span>instrument + unité de temps (1m 5m 15m 30m 1H 4H 1D 1W)</span>
  <code>BUY 0.05</code><span>achat au marché sur l'instrument courant (+ SL TP optionnels)</span>
  <code>SELL 0.05 98000 92000</code><span>vente + Stop Loss + Take Profit</span>
  <code>CLOSE 3</code><span>clôture la position n°3 · <code>CLOSE ALL</code> tout clôturer</span>
  <code>ALERT BTC-USDT &gt; 70000</code><span>alerte de prix · <code>ALERT DEL 1</code> supprimer</span>
  <code>ADD SOL-USDT</code> <span>ajoute à la watchlist · <code>DEL SOL-USDT</code> retire</span>
  <code>TA</code><span>analyse technique locale (onglet IA)</span>
  <code>AI ta question…</code><span>chat avec l'analyste IA · <code>KEY</code> configurer la clé</span>
  <code>BOOK / STATS / NEWS</code><span>onglets du panneau latéral</span>
  <code>IND RSI</code><span>bascule un indicateur : EMA BB VWAP VOL RSI MACD</span>
  <code>RESET PAPER</code><span>réinitialise le compte paper à 100 000</span>
</div>`;

function runCommand(raw) {
  const line = raw.trim();
  if (!line) return;
  state.cmdHistory.unshift(line);
  state.cmdIdx = -1;
  const up = line.toUpperCase();
  const tk = up.split(/\s+/);
  const tfOf = (s) => { const e = Object.entries(TF_NAMES).find(([, n]) => n.toUpperCase() === s); return e ? +e[0] : null; };

  switch (tk[0]) {
    case 'HELP': case '?':
      showModal('Commandes', HELP_HTML, [{ label: 'Fermer', cls: 'm-cancel' }]);
      return;
    case 'ADD': if (tk[1]) addSymbol(tk[1]); return;
    case 'DEL': case 'RM': if (tk[1]) removeSymbol(tk[1]); return;
    case 'BUY': case 'SELL': {
      const qty = parseNum(tk[1]);
      if (!qty) { setStatus(`Syntaxe : ${tk[0]} QTÉ [SL] [TP]`, 'err'); return; }
      confirmOrder(tk[0] === 'BUY' ? 'buy' : 'sell', qty, parseNum(tk[2]), parseNum(tk[3]));
      return;
    }
    case 'CLOSE': {
      if (tk[1] === 'ALL') {
        const ids = state.account.getPositions().map((p) => p.id);
        showModal('Tout clôturer', `<p>Clôturer les ${ids.length} positions ouvertes au marché ?</p>`, [
          { label: 'Annuler', cls: 'm-cancel' },
          { label: 'Tout clôturer', cls: 'm-confirm-sell', fn: async () => { for (const id of ids) await Promise.resolve(state.account.close(id)).catch(() => {}); renderPositions(); renderAccount(); } },
        ]);
        return;
      }
      const id = parseInt(tk[1], 10);
      if (!id) { setStatus('Syntaxe : CLOSE ID (voir tableau positions)', 'err'); return; }
      confirmClose(id);
      return;
    }
    case 'ALERT': {
      if (tk[1] === 'DEL') { deleteAlert(parseInt(tk[2], 10)); return; }
      if (tk[1] === 'LIST' || !tk[1]) { showBottomTab('alerts'); return; }
      const m = up.match(/^ALERT\s+(\S+)\s*([<>])\s*([\d.,\s]+)$/);
      if (!m) { setStatus('Syntaxe : ALERT SYMBOLE > PRIX (ou <)', 'err'); return; }
      addAlert(m[1], m[2], parseNum(m[3]));
      showBottomTab('alerts');
      return;
    }
    case 'TA': showSideTab('ai'); refreshTA(); return;
    case 'AI': aiAskUI(line.slice(3)); return;
    case 'KEY': aiKeyModal(); return;
    case 'BOOK': showSideTab('book'); return;
    case 'STATS': showSideTab('stats'); return;
    case 'NEWS': showSideTab('news'); loadNews(); return;
    case 'POS': showBottomTab('pos'); return;
    case 'HIST': showBottomTab('hist'); return;
    case 'IND': {
      const key = (tk[1] || '').toLowerCase();
      if (['ema', 'bb', 'vwap', 'vol', 'rsi', 'macd'].includes(key)) {
        state.chart.setOpt(key); syncIndButtons();
        setStatus(`${tk[1]} ${state.chart.opts[key] ? 'activé' : 'désactivé'}`, 'ok');
      } else setStatus('IND EMA|BB|VWAP|VOL|RSI|MACD', 'err');
      return;
    }
    case 'RESET':
      if (tk[1] === 'PAPER' && state.account instanceof PaperAccount) {
        showModal('Réinitialiser le paper trading', '<p>Solde remis à 100 000, positions et historique effacés. Continuer ?</p>', [
          { label: 'Annuler', cls: 'm-cancel' },
          { label: 'Réinitialiser', cls: 'm-confirm-sell', fn: () => { state.account.reset(100000); renderPositions(); renderAccount(); setStatus('Compte paper réinitialisé', 'ok'); } },
        ]);
      }
      return;
  }

  // formes "SYMBOLE [TF]"
  const maybeTf = tfOf(tk[1] || '');
  if (tk.length <= 2) { selectSymbol(tk[0], maybeTf || undefined); return; }
  setStatus(`Commande inconnue : ${up} — tapez HELP`, 'err');
}

/* ─────────────── bindings UI ─────────────── */

function syncIndButtons() {
  document.querySelectorAll('#ind-btns button').forEach((b) =>
    b.classList.toggle('on', !!state.chart.opts[b.dataset.i]));
}

function bindUI() {
  bindSearch();
  const cmd = $('cmd');
  cmd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { runCommand(cmd.value); cmd.value = ''; }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.cmdIdx < state.cmdHistory.length - 1) cmd.value = state.cmdHistory[++state.cmdIdx] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmd.value = state.cmdIdx > 0 ? state.cmdHistory[--state.cmdIdx] : (state.cmdIdx = -1, '');
    } else if (e.key === 'Escape') { cmd.value = ''; }
  });

  document.querySelectorAll('#period-btns button').forEach((b) => {
    b.onclick = () => { if (state.selected) selectSymbol(state.selected, +b.dataset.p); };
  });
  document.querySelectorAll('#type-btns button').forEach((b) => {
    b.onclick = () => {
      state.chart.setOpt('type', b.dataset.t);
      document.querySelectorAll('#type-btns button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  document.querySelectorAll('#ind-btns button').forEach((b) => {
    b.onclick = () => { state.chart.setOpt(b.dataset.i); syncIndButtons(); };
  });
  $('btn-log').onclick = () => {
    state.chart.setOpt('log');
    $('btn-log').classList.toggle('on', state.chart.opts.log);
  };
  $('btn-fit').onclick = () => state.chart.fit();
  $('btn-alert-here').onclick = () => {
    const info = state.symbols.get(state.selected);
    if (!info) return;
    const px = info.last || info.bid;
    const val = prompt(`Alerte sur ${state.selected} — prix de déclenchement :`, fmtPrice(px, info.digits));
    const target = parseNum(val);
    if (target) addAlert(state.selected, target > px ? '>' : '<', target);
  };

  document.querySelectorAll('#panel-tabs .tab-btn').forEach((b) => { b.onclick = () => showSideTab(b.dataset.tab); });
  document.querySelectorAll('#panel-bottom .tab-btn').forEach((b) => { b.onclick = () => showBottomTab(b.dataset.btab); });

  $('t-buy').onclick = () => confirmOrder('buy', parseNum($('t-qty').value), parseNum($('t-sl').value), parseNum($('t-tp').value));
  $('t-sell').onclick = () => confirmOrder('sell', parseNum($('t-qty').value), parseNum($('t-sl').value), parseNum($('t-tp').value));

  $('ai-key-btn').onclick = aiKeyModal;
  aiKeyBadge();
  $('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { aiAskUI($('ai-input').value); $('ai-input').value = ''; }
  });
  document.querySelectorAll('#ai-presets button').forEach((b) => {
    b.onclick = () => aiAskUI(b.dataset.q);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); cmd.focus(); }
  });

  $('st-conn').textContent = state.provider.label;
}

/* ─────────────── horloge ─────────────── */

function startClock() {
  const tick = () => {
    const d = new Date();
    $('clock-utc').textContent =
      `${pd(d.getHours())}:${pd(d.getMinutes())}:${pd(d.getSeconds())} · UTC ${pd(d.getUTCHours())}:${pd(d.getUTCMinutes())}`;
  };
  tick();
  setInterval(tick, 1000);
}
