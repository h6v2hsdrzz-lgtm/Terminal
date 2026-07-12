/* ════════════════════════════════════════════════════════════
   app.js — Orchestration du terminal : login, panneaux temps
   réel, ligne de commande façon Bloomberg, ticket d'ordre.
   ════════════════════════════════════════════════════════════ */
'use strict';

const $ = (id) => document.getElementById(id);

const DEFAULT_WATCHLIST = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'GOLD', 'SILVER', 'OIL.WTI',
  'US500', 'US100', 'US30', 'DE40', 'BITCOIN', 'ETHEREUM',
];

const state = {
  client: null,
  mode: null,
  symbols: new Map(),     // symbol -> info xAPI (bid/ask/digits/…)
  watchlist: [],
  selected: null,
  positions: new Map(),   // order -> trade
  account: {},
  chart: null,
  period: 60,
  cmdHistory: [],
  cmdIdx: -1,
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

function fmtPrice(v, digits) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(digits == null ? 2 : digits);
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

document.querySelectorAll('input[name=mode]').forEach((r) => {
  r.addEventListener('change', () => {
    $('cred-fields').style.display = r.value === 'sim' && r.checked ? 'none' : '';
  });
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = document.querySelector('input[name=mode]:checked').value;
  const id = $('login-id').value.trim();
  const pw = $('login-pw').value;
  const err = $('login-error');
  err.textContent = '';
  if (mode !== 'sim' && (!id || !pw)) { err.textContent = 'Identifiant et mot de passe requis.'; return; }

  const btn = $('login-btn');
  btn.disabled = true; btn.textContent = 'CONNEXION…';
  try {
    const client = mode === 'sim' ? new SimClient() : new XApiClient(mode);
    await client.connect();
    await client.login(id, pw);
    state.client = client;
    state.mode = mode;
    client.onDisconnect = () => setStatus('CONNEXION PERDUE — rechargez la page pour vous reconnecter', 'err');
    await startTerminal();
  } catch (ex) {
    err.textContent = ex.message || 'Échec de connexion';
    btn.disabled = false; btn.textContent = 'CONNEXION <GO>';
  }
});

$('btn-logout').onclick = () => {
  if (state.client) state.client.close();
  location.reload();
};

/* ─────────────── démarrage ─────────────── */

async function startTerminal() {
  $('login-overlay').classList.add('hidden');
  $('terminal').classList.remove('hidden');
  $('conn-mode').textContent = { demo: 'DÉMO', real: 'RÉEL', sim: 'SIMULATION' }[state.mode];

  state.chart = new CandleChart($('chart'), $('chart-ohlc'));
  startClock();
  bindUI();
  wireStreams();
  setStatus('CHARGEMENT DES DONNÉES…');

  // compte + positions + news en parallèle (la file xAPI espace les requêtes)
  state.client.getMarginLevel()
    .then((m) => updateAccount({
      balance: m.balance, equity: m.equity, margin: m.margin,
      marginFree: m.margin_free, marginLevel: m.margin_level, currency: m.currency,
    }))
    .catch(() => {});
  refreshPositions();
  loadNews();

  // watchlist : chargement symbole par symbole (les absents sont ignorés)
  for (const s of DEFAULT_WATCHLIST) addSymbol(s, { silent: true });

  await selectSymbol(DEFAULT_WATCHLIST[0]);
  setStatus('PRÊT — tapez HELP <GO> pour la liste des commandes', 'ok');
  $('cmd').focus();
}

function wireStreams() {
  const c = state.client;
  c.onStream('tickPrices', onTick);
  c.onStream('trade', onTradeStream);
  c.onStream('profit', onProfitStream);
  c.onStream('balance', (d) => updateAccount(d));
  c.onStream('news', (d) => prependNews(d));
  c.connectStream().then(() => {
    c.subscribe('getTrades');
    c.subscribe('getBalance');
    c.subscribe('getNews');
    c.subscribe('getKeepAlive');
  }).catch((e) => setStatus('STREAMING INDISPONIBLE: ' + e.message, 'err'));
}

/* ─────────────── watchlist ─────────────── */

async function addSymbol(symbol, opts = {}) {
  symbol = symbol.toUpperCase();
  if (state.watchlist.includes(symbol)) { if (!opts.silent) setStatus(symbol + ' déjà dans la watchlist', 'warn'); return true; }
  try {
    const info = await state.client.getSymbol(symbol);
    state.symbols.set(symbol, info);
    state.watchlist.push(symbol);
    renderWatchRow(symbol);
    state.client.subscribe('getTickPrices', { symbol, minArrivalTime: 400, maxLevel: 0 });
    if (!opts.silent) setStatus(symbol + ' ajouté à la watchlist', 'ok');
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

function cssId(s) { return s.replace(/[^A-Za-z0-9]/g, '_'); }

function renderWatchRow(symbol) {
  const info = state.symbols.get(symbol);
  let tr = $('w-' + cssId(symbol));
  if (!tr) {
    tr = document.createElement('tr');
    tr.id = 'w-' + cssId(symbol);
    tr.onclick = () => selectSymbol(symbol);
    tr.innerHTML = `<td class="sym"></td><td class="w-bid"></td><td class="w-ask"></td><td class="dim w-sprd"></td><td class="w-chg"></td>`;
    $('watch-body').appendChild(tr);
  }
  tr.classList.toggle('sel', state.selected === symbol);
  tr.querySelector('.sym').textContent = symbol;
  updateWatchRow(symbol, info.bid, info.ask, null);
}

function updateWatchRow(symbol, bid, ask, dir) {
  const tr = $('w-' + cssId(symbol));
  const info = state.symbols.get(symbol);
  if (!tr || !info) return;
  const d = info.digits;
  const bidTd = tr.querySelector('.w-bid'), askTd = tr.querySelector('.w-ask');
  bidTd.textContent = fmtPrice(bid, d);
  askTd.textContent = fmtPrice(ask, d);
  tr.querySelector('.w-sprd').textContent = bid != null && ask != null ? ((ask - bid) * Math.pow(10, d)).toFixed(0) : '—';
  const chg = tr.querySelector('.w-chg');
  if (dir != null) {
    chg.textContent = dir > 0 ? '▲' : dir < 0 ? '▼' : '=';
    chg.className = 'w-chg ' + (dir > 0 ? 'up' : dir < 0 ? 'dn' : 'dim');
    bidTd.classList.remove('flash-up', 'flash-dn');
    void bidTd.offsetWidth; // relance l'animation
    bidTd.classList.add(dir > 0 ? 'flash-up' : 'flash-dn');
  }
}

function onTick(d) {
  const info = state.symbols.get(d.symbol);
  if (!info) return;
  const dir = d.bid > info.bid ? 1 : d.bid < info.bid ? -1 : 0;
  info.bid = d.bid; info.ask = d.ask;
  updateWatchRow(d.symbol, d.bid, d.ask, dir);

  if (d.symbol === state.selected) {
    $('chart-last').textContent = fmtPrice(d.bid, info.digits);
    $('t-bid').textContent = fmtPrice(d.bid, info.digits);
    $('t-ask').textContent = fmtPrice(d.ask, info.digits);
    state.chart.tick(d.bid, d.timestamp || Date.now());
  }
  // rafraîchit le prix courant des positions sur ce symbole
  for (const t of state.positions.values()) {
    if (t.symbol !== d.symbol) continue;
    const cur = t.cmd === XAPI_CMD.BUY ? d.bid : d.ask;
    const td = document.querySelector(`#p-${t.order} .p-cur`);
    if (td) td.textContent = fmtPrice(cur, info.digits);
  }
}

/* ─────────────── graphique ─────────────── */

async function selectSymbol(symbol, period) {
  symbol = symbol.toUpperCase();
  if (!state.symbols.has(symbol)) {
    const ok = await addSymbol(symbol);
    if (!ok) return;
  }
  state.selected = symbol;
  if (period) state.period = period;
  const info = state.symbols.get(symbol);

  document.querySelectorAll('#watch-body tr').forEach((r) => r.classList.toggle('sel', r.id === 'w-' + cssId(symbol)));
  document.querySelectorAll('#period-btns button').forEach((b) => b.classList.toggle('on', +b.dataset.p === state.period));
  $('chart-sym').textContent = `${symbol} — ${info.description || ''}`;
  $('chart-last').textContent = fmtPrice(info.bid, info.digits);
  $('t-sym').value = symbol;
  $('t-bid').textContent = fmtPrice(info.bid, info.digits);
  $('t-ask').textContent = fmtPrice(info.ask, info.digits);

  const lookback = state.period * 60000 * 320;
  try {
    setStatus(`CHARGEMENT ${symbol}…`);
    const candles = await state.client.getChart(symbol, state.period, Date.now() - lookback);
    if (state.selected !== symbol) return; // l'utilisateur a changé entre-temps
    state.chart.setData(symbol, state.period, info.digits, candles);
    setStatus(`${symbol} ${periodName(state.period)} — ${candles.length} bougies`, 'ok');
  } catch (ex) {
    setStatus(`${symbol}: ${ex.message}`, 'err');
  }
}

function periodName(p) {
  return Object.keys(XAPI_PERIODS).find((k) => XAPI_PERIODS[k] === p) || p + 'min';
}

/* ─────────────── positions ─────────────── */

async function refreshPositions() {
  try {
    const trades = await state.client.getTrades();
    state.positions.clear();
    $('pos-body').innerHTML = '';
    for (const t of trades) upsertPosition(t);
    updatePosCount();
  } catch (ex) {
    setStatus('Positions: ' + ex.message, 'err');
  }
}

function onTradeStream(t) {
  if (!t) return;
  if (t.closed || t.state === 'Deleted') {
    state.positions.delete(t.order);
    const row = $('p-' + t.order);
    if (row) row.remove();
  } else if (t.type === 0 || t.type == null) {
    upsertPosition(t);
  }
  updatePosCount();
  updateOpenPL();
}

function onProfitStream(d) {
  const t = state.positions.get(d.order) || state.positions.get(d.order2);
  if (t) t.profit = d.profit;
  const row = $('p-' + (t ? t.order : d.order));
  if (row) {
    const td = row.querySelector('.p-pl');
    td.textContent = fmtNum(d.profit);
    td.className = 'p-pl ' + (d.profit >= 0 ? 'up' : 'dn');
  }
  updateOpenPL();
}

function upsertPosition(t) {
  state.positions.set(t.order, t);
  const info = state.symbols.get(t.symbol);
  const digits = t.digits != null ? t.digits : (info ? info.digits : 5);
  let tr = $('p-' + t.order);
  if (!tr) {
    tr = document.createElement('tr');
    tr.id = 'p-' + t.order;
    $('pos-body').appendChild(tr);
  }
  const side = t.cmd === XAPI_CMD.BUY ? 'BUY' : 'SELL';
  const cur = info ? (t.cmd === XAPI_CMD.BUY ? info.bid : info.ask) : null;
  tr.innerHTML =
    `<td class="dim">${t.order}</td>` +
    `<td class="sym">${escHtml(t.symbol)}</td>` +
    `<td class="side-${side.toLowerCase()}">${side}</td>` +
    `<td>${fmtNum(t.volume, 2)}</td>` +
    `<td>${fmtPrice(t.open_price, digits)}</td>` +
    `<td class="p-cur">${fmtPrice(cur, digits)}</td>` +
    `<td class="dim">${t.sl ? fmtPrice(t.sl, digits) : '—'}</td>` +
    `<td class="dim">${t.tp ? fmtPrice(t.tp, digits) : '—'}</td>` +
    `<td class="p-pl ${t.profit >= 0 ? 'up' : 'dn'}">${fmtNum(t.profit)}</td>` +
    `<td><button class="btn-close-pos">CLOSE</button></td>`;
  tr.querySelector('.btn-close-pos').onclick = () => confirmClose(t.order);
}

function updatePosCount() {
  $('pos-count').textContent = `— ${state.positions.size}`;
}

function updateOpenPL() {
  let pl = 0;
  for (const t of state.positions.values()) pl += t.profit || 0;
  const el = $('a-pl');
  el.textContent = fmtNum(pl);
  el.style.color = pl >= 0 ? 'var(--up)' : 'var(--dn)';
}

/* ─────────────── compte ─────────────── */

function updateAccount(d) {
  Object.assign(state.account, d);
  const a = state.account;
  const cur = a.currency ? ' ' + a.currency : '';
  $('a-bal').textContent = fmtNum(a.balance) + cur;
  $('a-eq').textContent = fmtNum(a.equity) + cur;
  $('a-mg').textContent = fmtNum(a.margin);
  $('a-free').textContent = fmtNum(a.marginFree != null ? a.marginFree : a.margin_free);
  const lvl = a.marginLevel != null ? a.marginLevel : a.margin_level;
  const lvlEl = $('a-lvl');
  lvlEl.textContent = lvl ? fmtNum(lvl, 0) + '%' : '—';
  lvlEl.style.color = lvl && lvl < 100 ? 'var(--dn)' : lvl && lvl < 200 ? 'var(--yellow)' : 'var(--cyan)';
}

/* ─────────────── news ─────────────── */

async function loadNews() {
  try {
    const items = await state.client.getNews(Date.now() - 3 * 86400e3);
    items.sort((a, b) => b.time - a.time);
    $('news-list').innerHTML = '';
    for (const n of items.slice(0, 60)) appendNews(n);
    if (!items.length) $('news-list').innerHTML = '<div class="news-empty">Aucune actualité sur la période.</div>';
  } catch {
    $('news-list').innerHTML = '<div class="news-empty">Flux news indisponible.</div>';
  }
}

function newsNode(n) {
  const div = document.createElement('div');
  div.className = 'news-item';
  const d = new Date(n.time);
  const pd = (x) => String(x).padStart(2, '0');
  div.innerHTML =
    `<div class="news-time">${pd(d.getDate())}/${pd(d.getMonth() + 1)} ${pd(d.getHours())}:${pd(d.getMinutes())}</div>` +
    `<div class="news-title">${escHtml(n.title)}</div>`;
  div.onclick = () => {
    const tmp = document.createElement('div');
    tmp.innerHTML = n.body || '';
    showModal('NEWS', `<b style="color:var(--yellow)">${escHtml(n.title)}</b><br><br>${escHtml(tmp.textContent.trim() || '(pas de contenu)')}`,
      [{ label: 'FERMER', cls: 'm-cancel' }]);
  };
  return div;
}

function appendNews(n) { $('news-list').appendChild(newsNode(n)); }
function prependNews(n) {
  const list = $('news-list');
  const empty = list.querySelector('.news-empty');
  if (empty) empty.remove();
  list.insertBefore(newsNode(n), list.firstChild);
  setStatus('NEWS: ' + n.title, 'warn');
}

/* ─────────────── ordres ─────────────── */

function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function confirmOrder(side, symbol, volume, sl, tp) {
  symbol = symbol.toUpperCase();
  const info = state.symbols.get(symbol);
  if (!info) { setStatus(`${symbol}: chargez d'abord le symbole (ADD ${symbol})`, 'err'); return; }
  if (!volume || volume <= 0) { setStatus('Volume invalide', 'err'); return; }
  const buy = side === 'BUY';
  const price = buy ? info.ask : info.bid;
  showModal(`CONFIRMATION — ${side} ${symbol}`,
    `<table>
      <tr><td>Instrument</td><td>${escHtml(symbol)} — ${escHtml(info.description || '')}</td></tr>
      <tr><td>Sens</td><td style="color:${buy ? 'var(--up)' : 'var(--dn)'};font-weight:700">${side} (au marché)</td></tr>
      <tr><td>Volume</td><td>${fmtNum(volume, 2)} lot(s)</td></tr>
      <tr><td>Prix indicatif</td><td>${fmtPrice(price, info.digits)}</td></tr>
      <tr><td>Stop Loss</td><td>${sl ? fmtPrice(sl, info.digits) : '—'}</td></tr>
      <tr><td>Take Profit</td><td>${tp ? fmtPrice(tp, info.digits) : '—'}</td></tr>
    </table>
    <div class="m-warn">⚠ Ordre au marché sur compte ${state.mode === 'real' ? 'RÉEL' : state.mode === 'demo' ? 'DÉMO' : 'SIMULÉ'}. Exécution au prix courant du serveur.</div>`,
    [
      { label: 'ANNULER', cls: 'm-cancel' },
      {
        label: `CONFIRMER ${side}`, cls: buy ? 'm-confirm-buy' : 'm-confirm-sell',
        fn: () => sendOrder(buy ? XAPI_CMD.BUY : XAPI_CMD.SELL, symbol, volume, sl, tp),
      },
    ]);
}

async function sendOrder(cmd, symbol, volume, sl, tp) {
  const info = state.symbols.get(symbol);
  try {
    setStatus('ENVOI DE L\'ORDRE…', 'warn');
    const r = await state.client.tradeTransaction({
      cmd, type: XAPI_TYPE.OPEN, symbol, volume,
      price: cmd === XAPI_CMD.BUY ? info.ask : info.bid,
      sl: sl || 0, tp: tp || 0,
      offset: 0, expiration: 0, order: 0, customComment: 'xtb-terminal',
    });
    const st = await state.client.tradeStatus(r.order).catch(() => null);
    if (st && st.requestStatus === 4) {
      setStatus(`ORDRE ${r.order} REJETÉ: ${st.message || 'raison inconnue'}`, 'err');
    } else {
      setStatus(`ORDRE ${r.order} ACCEPTÉ`, 'ok');
    }
    setTimeout(refreshPositions, 800);
  } catch (ex) {
    setStatus('ORDRE REFUSÉ: ' + ex.message, 'err');
  }
}

function confirmClose(order) {
  const t = state.positions.get(order);
  if (!t) { setStatus(`Position ${order} introuvable`, 'err'); return; }
  const side = t.cmd === XAPI_CMD.BUY ? 'BUY' : 'SELL';
  showModal(`CLÔTURE — ${t.symbol}`,
    `<table>
      <tr><td>Position</td><td>#${t.order} ${side} ${fmtNum(t.volume, 2)} ${escHtml(t.symbol)}</td></tr>
      <tr><td>Prix d'ouverture</td><td>${t.open_price}</td></tr>
      <tr><td>P/L actuel</td><td style="color:${(t.profit || 0) >= 0 ? 'var(--up)' : 'var(--dn)'}">${fmtNum(t.profit)}</td></tr>
    </table>
    <div class="m-warn">⚠ Clôture au marché, au prix courant du serveur.</div>`,
    [
      { label: 'ANNULER', cls: 'm-cancel' },
      { label: 'CLÔTURER', cls: 'm-confirm-sell', fn: () => closePosition(order) },
    ]);
}

async function closePosition(order) {
  const t = state.positions.get(order);
  if (!t) return;
  const info = state.symbols.get(t.symbol);
  try {
    setStatus('CLÔTURE EN COURS…', 'warn');
    await state.client.tradeTransaction({
      cmd: t.cmd, type: XAPI_TYPE.CLOSE, order: t.order,
      symbol: t.symbol, volume: t.volume,
      price: info ? (t.cmd === XAPI_CMD.BUY ? info.bid : info.ask) : t.open_price,
      sl: 0, tp: 0, offset: 0, expiration: 0, customComment: 'xtb-terminal',
    });
    setStatus(`POSITION ${order} CLÔTURÉE`, 'ok');
    setTimeout(refreshPositions, 800);
  } catch (ex) {
    setStatus('CLÔTURE REFUSÉE: ' + ex.message, 'err');
  }
}

/* ─────────────── DES (description) ─────────────── */

async function showDes(symbol) {
  symbol = symbol.toUpperCase();
  try {
    const s = await state.client.getSymbol(symbol);
    showModal(`DES — ${symbol}`,
      `<table>
        <tr><td>Description</td><td>${escHtml(s.description)}</td></tr>
        <tr><td>Catégorie</td><td>${escHtml(s.categoryName)}${s.groupName ? ' / ' + escHtml(s.groupName) : ''}</td></tr>
        <tr><td>Bid / Ask</td><td>${fmtPrice(s.bid, s.digits)} / ${fmtPrice(s.ask, s.digits)}</td></tr>
        <tr><td>Taille de contrat</td><td>${fmtNum(s.contractSize, 0)}</td></tr>
        <tr><td>Devise</td><td>${escHtml(s.currency)} (profit: ${escHtml(s.currencyProfit || s.currency)})</td></tr>
        <tr><td>Marge / Levier</td><td>${s.leverage ? s.leverage + '%' : '—'}</td></tr>
        <tr><td>Lot min / step / max</td><td>${s.lotMin} / ${s.lotStep} / ${s.lotMax}</td></tr>
        <tr><td>Swap long / short</td><td>${fmtNum(s.swapLong, 5)} / ${fmtNum(s.swapShort, 5)}</td></tr>
      </table>`,
      [{ label: 'FERMER', cls: 'm-cancel' }]);
  } catch (ex) {
    setStatus(`${symbol}: ${ex.message}`, 'err');
  }
}

/* ─────────────── ligne de commande ─────────────── */

const HELP_HTML = `<div class="help-grid">
  <code>EURUSD</code><span>sélectionne l'instrument (graphe + ticket)</span>
  <code>GOLD GP H4</code><span>graphique — périodes: M1 M5 M15 M30 H1 H4 D1 W1 MN</span>
  <code>US500 DES</code><span>fiche descriptive de l'instrument</span>
  <code>ADD DE40</code><span>ajoute à la watchlist &nbsp;·&nbsp; <code>DEL DE40</code> retire</span>
  <code>BUY GOLD 0.1</code><span>achat au marché (confirmation demandée)</span>
  <code>SELL US500 0.2 5900 6100</code><span>vente + SL + TP optionnels</span>
  <code>CLOSE 123456</code><span>clôture la position n° d'ordre</span>
  <code>POS</code><span>rafraîchit les positions &nbsp;·&nbsp; <code>NEWS</code> recharge les news</span>
  <code>ACCT</code><span>rafraîchit le bandeau de compte</span>
  <code>HELP</code><span>cette aide</span>
</div>
<div class="m-warn">Astuce Bloomberg : tapez la commande puis Entrée (&lt;GO&gt;).</div>`;

function runCommand(raw) {
  const line = raw.trim().toUpperCase();
  if (!line) return;
  state.cmdHistory.unshift(line);
  state.cmdIdx = -1;
  const tk = line.split(/\s+/);

  const periodOf = (s) => XAPI_PERIODS[s] || null;

  switch (tk[0]) {
    case 'HELP': case '?':
      showModal('AIDE — COMMANDES', HELP_HTML, [{ label: 'FERMER', cls: 'm-cancel' }]);
      return;
    case 'ADD': if (tk[1]) addSymbol(tk[1]); return;
    case 'DEL': case 'RM': if (tk[1]) removeSymbol(tk[1]); return;
    case 'POS': refreshPositions(); setStatus('Positions rafraîchies', 'ok'); return;
    case 'NEWS': loadNews(); setStatus('News rechargées', 'ok'); return;
    case 'ACCT':
      state.client.getMarginLevel().then((m) => {
        updateAccount({ balance: m.balance, equity: m.equity, margin: m.margin, marginFree: m.margin_free, marginLevel: m.margin_level, currency: m.currency });
        setStatus('Compte rafraîchi', 'ok');
      }).catch((e) => setStatus(e.message, 'err'));
      return;
    case 'BUY': case 'SELL': {
      const vol = parseNum(tk[2]);
      if (!tk[1] || !vol) { setStatus(`Syntaxe: ${tk[0]} SYMBOLE VOLUME [SL] [TP]`, 'err'); return; }
      confirmOrder(tk[0], tk[1], vol, parseNum(tk[3]), parseNum(tk[4]));
      return;
    }
    case 'CLOSE': {
      const order = parseInt(tk[1], 10);
      if (!order) { setStatus('Syntaxe: CLOSE NUMERO_ORDRE', 'err'); return; }
      confirmClose(order);
      return;
    }
  }

  // formes "SYMBOLE [FONCTION] [ARGS]"
  const sym = tk[0];
  if (tk[1] === 'DES') { showDes(sym); return; }
  if (tk[1] === 'GP' || tk.length === 1 || periodOf(tk[1])) {
    const p = periodOf(tk[2]) || periodOf(tk[1]) || state.period;
    selectSymbol(sym, p);
    return;
  }
  setStatus(`Commande inconnue: ${line} — tapez HELP`, 'err');
}

/* ─────────────── UI bindings ─────────────── */

function bindUI() {
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

  $('t-buy').onclick = () => ticketOrder('BUY');
  $('t-sell').onclick = () => ticketOrder('SELL');

  // "/" focalise la ligne de commande, comme sur un vrai terminal
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault(); cmd.focus();
    }
  });
}

function ticketOrder(side) {
  confirmOrder(side, $('t-sym').value.trim(), parseNum($('t-vol').value), parseNum($('t-sl').value), parseNum($('t-tp').value));
}

/* ─────────────── horloge ─────────────── */

function startClock() {
  const pd = (x) => String(x).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    $('clock-utc').textContent = `UTC ${pd(d.getUTCHours())}:${pd(d.getUTCMinutes())}:${pd(d.getUTCSeconds())}`;
    $('clock-loc').textContent = `LOC ${pd(d.getHours())}:${pd(d.getMinutes())}:${pd(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}
