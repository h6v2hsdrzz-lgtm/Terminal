/* ════════════════════════════════════════════════════════════
   app.js — Orchestration du terminal : login, panneaux temps
   réel, ligne de commande façon Bloomberg, ticket d'ordre,
   alertes de prix, calendrier économique, historique, IA.
   ════════════════════════════════════════════════════════════ */
'use strict';

const $ = (id) => document.getElementById(id);

const DEFAULT_WATCHLIST = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'GOLD', 'SILVER', 'OIL.WTI',
  'US500', 'US100', 'US30', 'DE40', 'BITCOIN', 'ETHEREUM',
];

const ALERT_STORE = 'xtb-term-alerts';

const state = {
  client: null,
  mode: null,
  symbols: new Map(),     // symbol -> info xAPI (bid/ask/digits/prevClose/dayHi/dayLo…)
  watchlist: [],
  selected: null,
  positions: new Map(),   // order -> trade
  account: {},
  chart: null,
  period: 60,
  cmdHistory: [],
  cmdIdx: -1,
  alerts: [],             // {id, symbol, op, price, hit}
  alertSeq: 1,
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

function pd(x) { return String(x).padStart(2, '0'); }

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
  loadAlerts();
  startClock();
  bindUI();
  wireStreams();
  setStatus('CHARGEMENT DES DONNÉES…');

  state.client.getMarginLevel()
    .then((m) => updateAccount({
      balance: m.balance, equity: m.equity, margin: m.margin,
      marginFree: m.margin_free, marginLevel: m.margin_level, currency: m.currency,
    }))
    .catch(() => {});
  refreshPositions();
  loadNews();
  loadCalendar();

  for (const s of DEFAULT_WATCHLIST) addSymbol(s, { silent: true });

  await selectSymbol(DEFAULT_WATCHLIST[0]);
  loadDayChanges();
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

/* variation jour : clôture D1 précédente, chargée en tâche de fond */
async function loadDayChanges() {
  for (const s of [...state.watchlist]) {
    const info = state.symbols.get(s);
    if (!info || info.prevClose != null) continue;
    try {
      const candles = await state.client.getChart(s, 1440, Date.now() - 8 * 86400e3);
      if (candles.length >= 2) {
        info.prevClose = candles[candles.length - 2].c;
        updateWatchRow(s, info.bid, info.ask, null);
        if (state.selected === s) updateQuote(s);
      }
    } catch { /* symbole sans historique D1 : pas de %chg */ }
  }
}

/* ─────────────── watchlist ─────────────── */

async function addSymbol(symbol, opts = {}) {
  symbol = symbol.toUpperCase();
  if (state.watchlist.includes(symbol)) { if (!opts.silent) setStatus(symbol + ' déjà dans la watchlist', 'warn'); return true; }
  try {
    const info = await state.client.getSymbol(symbol);
    info.dayHi = null; info.dayLo = null; info.prevClose = null;
    state.symbols.set(symbol, info);
    state.watchlist.push(symbol);
    renderWatchRow(symbol);
    state.client.subscribe('getTickPrices', { symbol, minArrivalTime: 400, maxLevel: 0 });
    if (!opts.silent) { setStatus(symbol + ' ajouté à la watchlist', 'ok'); loadDayChanges(); }
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
    tr.innerHTML = `<td class="sym"></td><td class="w-bid"></td><td class="w-ask"></td><td class="dim w-sprd"></td><td class="w-pchg"></td><td class="w-chg"></td>`;
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
  const pc = tr.querySelector('.w-pchg');
  if (info.prevClose && bid != null) {
    const pct = (bid - info.prevClose) / info.prevClose * 100;
    pc.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2);
    pc.className = 'w-pchg ' + (pct >= 0 ? 'up' : 'dn');
  } else { pc.textContent = '—'; pc.className = 'w-pchg dim'; }
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
  info.dayHi = info.dayHi == null ? (d.high || d.bid) : Math.max(info.dayHi, d.bid);
  info.dayLo = info.dayLo == null ? (d.low || d.bid) : Math.min(info.dayLo, d.bid);
  updateWatchRow(d.symbol, d.bid, d.ask, dir);
  checkAlerts(d.symbol, d.bid, d.ask);

  if (d.symbol === state.selected) {
    $('chart-last').textContent = fmtPrice(d.bid, info.digits);
    updateQuote(d.symbol);
    state.chart.tick(d.bid, d.timestamp || Date.now());
  }
  for (const t of state.positions.values()) {
    if (t.symbol !== d.symbol) continue;
    const cur = t.cmd === XAPI_CMD.BUY ? d.bid : d.ask;
    const td = document.querySelector(`#p-${t.order} .p-cur`);
    if (td) td.textContent = fmtPrice(cur, info.digits);
  }
}

/* ─────────────── quote monitor ─────────────── */

function updateQuote(symbol) {
  const info = state.symbols.get(symbol);
  if (!info) return;
  const dg = info.digits;
  $('q-sym').textContent = `${symbol} — ${info.description || ''}`;
  $('q-bid').textContent = fmtPrice(info.bid, dg);
  $('q-ask').textContent = fmtPrice(info.ask, dg);
  $('t-bid').textContent = fmtPrice(info.bid, dg);
  $('t-ask').textContent = fmtPrice(info.ask, dg);
  const chgEl = $('q-chg');
  if (info.prevClose) {
    const pct = (info.bid - info.prevClose) / info.prevClose * 100;
    chgEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    chgEl.className = pct >= 0 ? 'up' : 'dn';
  } else { chgEl.textContent = '—'; chgEl.className = ''; }
  $('q-lo').textContent = fmtPrice(info.dayLo, dg);
  $('q-hi').textContent = fmtPrice(info.dayHi, dg);
  $('q-sprd').textContent = (info.bid != null && info.ask != null)
    ? ((info.ask - info.bid) * Math.pow(10, dg)).toFixed(0) + ' pts' : '—';
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
  updateQuote(symbol);

  const lookback = state.period * 60000 * 320;
  try {
    setStatus(`CHARGEMENT ${symbol}…`);
    const candles = await state.client.getChart(symbol, state.period, Date.now() - lookback);
    if (state.selected !== symbol) return; // changement entre-temps
    state.chart.setData(symbol, state.period, info.digits, candles);
    refreshTA();
    setStatus(`${symbol} ${periodName(state.period)} — ${candles.length} bougies`, 'ok');
  } catch (ex) {
    setStatus(`${symbol}: ${ex.message}`, 'err');
  }
}

function periodName(p) {
  return Object.keys(XAPI_PERIODS).find((k) => XAPI_PERIODS[k] === p) || p + 'min';
}

/* ─────────────── positions / historique ─────────────── */

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

function updatePosCount() { $('pos-count').textContent = `(${state.positions.size})`; }

function updateOpenPL() {
  let pl = 0;
  for (const t of state.positions.values()) pl += t.profit || 0;
  const el = $('a-pl');
  el.textContent = fmtNum(pl);
  el.style.color = pl >= 0 ? 'var(--up)' : 'var(--dn)';
}

async function loadHistory() {
  const body = $('hist-body');
  body.innerHTML = '<tr><td colspan="7" class="dim">Chargement…</td></tr>';
  try {
    const hist = await state.client.getTradesHistory(Date.now() - 30 * 86400e3);
    hist.sort((a, b) => (b.close_time || 0) - (a.close_time || 0));
    body.innerHTML = '';
    for (const t of hist.slice(0, 200)) {
      const info = state.symbols.get(t.symbol);
      const dg = t.digits != null ? t.digits : (info ? info.digits : 2);
      const side = t.cmd === XAPI_CMD.BUY ? 'BUY' : 'SELL';
      const d = new Date(t.close_time);
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="dim">${pd(d.getDate())}/${pd(d.getMonth() + 1)} ${pd(d.getHours())}:${pd(d.getMinutes())}</td>` +
        `<td class="sym">${escHtml(t.symbol)}</td>` +
        `<td class="side-${side.toLowerCase()}">${side}</td>` +
        `<td>${fmtNum(t.volume, 2)}</td>` +
        `<td>${fmtPrice(t.open_price, dg)}</td>` +
        `<td>${fmtPrice(t.close_price, dg)}</td>` +
        `<td class="${t.profit >= 0 ? 'up' : 'dn'}">${fmtNum(t.profit)}</td>`;
      body.appendChild(tr);
    }
    if (!hist.length) body.innerHTML = '<tr><td colspan="7" class="dim">Aucun trade clôturé sur 30 jours.</td></tr>';
  } catch (ex) {
    body.innerHTML = `<tr><td colspan="7" class="dn">${escHtml(ex.message)}</td></tr>`;
  }
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

/* ─────────────── calendrier économique ─────────────── */

async function loadCalendar() {
  const body = $('cal-body');
  body.innerHTML = '<tr><td colspan="6" class="dim">Chargement…</td></tr>';
  try {
    let events = await state.client.getCalendar();
    const now = Date.now();
    events = events
      .filter((e) => e.time > now - 12 * 3600e3 && e.time < now + 3 * 86400e3)
      .sort((a, b) => a.time - b.time);
    body.innerHTML = '';
    for (const e of events.slice(0, 80)) {
      const d = new Date(e.time);
      const tr = document.createElement('tr');
      tr.className = `cal-imp${e.impact || 1}` + (e.time < now ? ' cal-past' : '');
      tr.innerHTML =
        `<td class="dim">${pd(d.getDate())}/${pd(d.getMonth() + 1)} ${pd(d.getHours())}:${pd(d.getMinutes())}</td>` +
        `<td>${escHtml(e.country)}</td>` +
        `<td style="text-align:left">${escHtml(e.title)}${e.period ? ' <span class="dim">(' + escHtml(e.period) + ')</span>' : ''}</td>` +
        `<td class="dim">${escHtml(e.previous || '—')}</td>` +
        `<td>${escHtml(e.forecast || '—')}</td>` +
        `<td class="sym">${escHtml(e.current || '—')}</td>`;
      body.appendChild(tr);
    }
    if (!events.length) body.innerHTML = '<tr><td colspan="6" class="dim">Aucun événement à venir.</td></tr>';
  } catch (ex) {
    body.innerHTML = `<tr><td colspan="6" class="dn">${escHtml(ex.message)}</td></tr>`;
  }
}

/* ─────────────── alertes de prix ─────────────── */

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

function saveAlerts() {
  try { localStorage.setItem(ALERT_STORE, JSON.stringify(state.alerts)); } catch {}
}

function addAlert(symbol, op, price) {
  symbol = symbol.toUpperCase();
  state.alerts.push({ id: state.alertSeq++, symbol, op, price, hit: null });
  saveAlerts();
  renderAlerts();
  if (!state.watchlist.includes(symbol)) addSymbol(symbol, { silent: true });
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  setStatus(`ALERTE #${state.alertSeq - 1}: ${symbol} ${op} ${price}`, 'ok');
  showBottomTab('alerts');
}

function deleteAlert(id) {
  state.alerts = state.alerts.filter((a) => a.id !== id);
  saveAlerts();
  renderAlerts();
}

function checkAlerts(symbol, bid) {
  for (const a of state.alerts) {
    if (a.hit || a.symbol !== symbol) continue;
    if ((a.op === '>' && bid > a.price) || (a.op === '<' && bid < a.price)) {
      a.hit = Date.now();
      saveAlerts();
      renderAlerts();
      const msg = `${symbol} ${a.op} ${a.price} — bid ${bid}`;
      toast('ALERTE DÉCLENCHÉE', msg);
      setStatus('⚠ ALERTE: ' + msg, 'warn');
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('XTB Terminal — alerte', { body: msg }); } catch {}
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
      `<td class="dim">${a.id}</td>` +
      `<td class="sym">${escHtml(a.symbol)}</td>` +
      `<td>bid ${a.op} ${a.price}</td>` +
      `<td class="${a.hit ? 'alert-hit' : 'alert-armed'}">${a.hit ? 'DÉCLENCHÉE ' + new Date(a.hit).toLocaleTimeString('fr-FR') : 'ARMÉE'}</td>` +
      `<td><button class="btn-del-alert">SUPPR</button></td>`;
    tr.querySelector('.btn-del-alert').onclick = () => deleteAlert(a.id);
    body.appendChild(tr);
  }
  if (!state.alerts.length) body.innerHTML = '<tr><td colspan="5" class="dim">Aucune alerte.</td></tr>';
  const armed = state.alerts.filter((a) => !a.hit).length;
  $('alert-count').textContent = armed ? `(${armed})` : '';
  $('st-alerts').textContent = armed ? `ALRT ${armed}` : '';
}

/* ─────────────── ordres ─────────────── */

function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function confirmOrder(side, symbol, volume, sl, tp) {
  symbol = (symbol || '').toUpperCase();
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
      toast('ORDRE REJETÉ', st.message || 'raison inconnue');
    } else {
      setStatus(`ORDRE ${r.order} ACCEPTÉ`, 'ok');
      toast('ORDRE ACCEPTÉ', `${cmd === XAPI_CMD.BUY ? 'BUY' : 'SELL'} ${volume} ${symbol}`);
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

/* ─────────────── onglets ─────────────── */

function showSideTab(name) {
  document.querySelectorAll('#panel-tabs .tab-btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  for (const t of ['news', 'cal', 'ai']) $('tab-' + t).classList.toggle('hidden', t !== name);
}

function showBottomTab(name) {
  document.querySelectorAll('#panel-bottom .tab-btn').forEach((b) => b.classList.toggle('on', b.dataset.btab === name));
  for (const t of ['pos', 'hist', 'alerts']) $('btab-' + t).classList.toggle('hidden', t !== name);
  if (name === 'hist') loadHistory();
}

/* ─────────────── IA ─────────────── */

function refreshTA() {
  const report = state.chart.candles.length ? TA.report(state.chart.candles, state.chart.digits) : null;
  $('ai-ta').innerHTML = renderTAReport(state.selected || '—', report);
}

function aiKeyBadge() {
  $('ai-key-btn').classList.toggle('set', !!AIPanel.key);
  $('st-ai').textContent = AIPanel.key ? 'AI ✓' : '';
}

function aiKeyModal() {
  showModal('CLÉ API ANTHROPIC',
    `<p>Le chat IA appelle l'API Anthropic (modèle <b>${AI_MODEL}</b>) directement depuis
     votre navigateur. La clé est stockée <b>localement</b> (localStorage) et n'est envoyée
     qu'à api.anthropic.com.</p><br>
     <input id="m-ai-key" type="password" placeholder="sk-ant-…" value="${escHtml(AIPanel.key)}"
       style="width:100%;background:#000;border:1px solid var(--border);color:var(--yellow);padding:7px 9px;font-size:12px;outline:none">
     <div class="m-warn">Créez une clé sur console.anthropic.com. L'analyse technique (TA) fonctionne sans clé.</div>`,
    [
      { label: 'EFFACER', cls: 'm-cancel', fn: () => { AIPanel.key = ''; aiKeyBadge(); setStatus('Clé API effacée', 'ok'); } },
      {
        label: 'ENREGISTRER', cls: 'm-confirm-buy',
        fn: () => {
          AIPanel.key = document.getElementById('m-ai-key').value.trim();
          aiKeyBadge();
          setStatus(AIPanel.key ? 'Clé API enregistrée (locale)' : 'Clé API effacée', 'ok');
        },
      },
    ]);
}

function aiMsg(cls, text) {
  const div = document.createElement('div');
  div.className = 'ai-msg ' + cls;
  div.textContent = text;
  $('ai-chat').appendChild(div);
  $('ai-chat').scrollTop = $('ai-chat').scrollHeight;
  return div;
}

async function aiAskUI(question) {
  question = (question || '').trim();
  if (!question) return;
  showSideTab('ai');
  if (!AIPanel.key) {
    aiMsg('err', 'Aucune clé API configurée. Cliquez sur 🔑 ou tapez KEY <GO>. L\'analyse technique ci-dessus fonctionne sans clé.');
    return;
  }
  aiMsg('user', question);
  const wait = aiMsg('wait', `${AI_MODEL} réfléchit…`);
  try {
    const answer = await AIPanel.ask(question);
    wait.remove();
    aiMsg('bot', answer);
  } catch (ex) {
    wait.remove();
    aiMsg('err', 'IA: ' + ex.message);
  }
}

/* ─────────────── ligne de commande ─────────────── */

const HELP_HTML = `<div class="help-grid">
  <code>EURUSD</code><span>sélectionne l'instrument (graphe + quote + ticket)</span>
  <code>GOLD GP H4</code><span>graphique — périodes: M1 M5 M15 M30 H1 H4 D1 W1 MN</span>
  <code>US500 DES</code><span>fiche descriptive de l'instrument</span>
  <code>TA [SYM]</code><span>analyse technique IA locale (onglet AI ANALYST)</span>
  <code>AI question…</code><span>pose une question à Claude (clé requise, KEY)</span>
  <code>KEY</code><span>configure la clé API Anthropic (stockée localement)</span>
  <code>ADD DE40</code><span>ajoute à la watchlist &nbsp;·&nbsp; <code>DEL DE40</code> retire</span>
  <code>BUY GOLD 0.1</code><span>achat au marché (confirmation demandée)</span>
  <code>SELL US500 0.2 5900 6100</code><span>vente + SL + TP optionnels</span>
  <code>CLOSE 123456</code><span>clôture la position n° d'ordre</span>
  <code>ALERT GOLD &gt; 2700</code><span>alerte de prix &nbsp;·&nbsp; <code>ALERT DEL 1</code> &nbsp;·&nbsp; <code>ALERT LIST</code></span>
  <code>CAL</code><span>calendrier économique &nbsp;·&nbsp; <code>HIST</code> historique des trades</span>
  <code>IND RSI</code><span>bascule un indicateur: SMA BB VOL RSI MACD &nbsp;·&nbsp; <code>LINE</code>/<code>CNDL</code></span>
  <code>POS</code><span>rafraîchit les positions &nbsp;·&nbsp; <code>NEWS</code> &nbsp;·&nbsp; <code>ACCT</code> &nbsp;·&nbsp; <code>QM</code></span>
  <code>HELP</code><span>cette aide</span>
</div>
<div class="m-warn">Astuce : tapez la commande puis Entrée (&lt;GO&gt;). Touche «/» pour focaliser la ligne de commande.</div>`;

function runCommand(raw) {
  const line = raw.trim();
  if (!line) return;
  const upper = line.toUpperCase();
  state.cmdHistory.unshift(line);
  state.cmdIdx = -1;
  const tk = upper.split(/\s+/);
  const periodOf = (s) => XAPI_PERIODS[s] || null;

  switch (tk[0]) {
    case 'HELP': case '?':
      showModal('AIDE — COMMANDES', HELP_HTML, [{ label: 'FERMER', cls: 'm-cancel' }]);
      return;
    case 'ADD': if (tk[1]) addSymbol(tk[1]); return;
    case 'DEL': case 'RM': if (tk[1]) removeSymbol(tk[1]); return;
    case 'POS': showBottomTab('pos'); refreshPositions(); setStatus('Positions rafraîchies', 'ok'); return;
    case 'HIST': showBottomTab('hist'); return;
    case 'NEWS': showSideTab('news'); loadNews(); setStatus('News rechargées', 'ok'); return;
    case 'CAL': showSideTab('cal'); loadCalendar(); setStatus('Calendrier rechargé', 'ok'); return;
    case 'QM': if (tk[1]) selectSymbol(tk[1]); else setStatus('Quote monitor à droite — QM SYMBOLE pour changer', 'ok'); return;
    case 'GP': if (state.selected) selectSymbol(state.selected, periodOf(tk[1]) || state.period); return;
    case 'TA':
      (tk[1] ? selectSymbol(tk[1]) : Promise.resolve()).then(() => { refreshTA(); showSideTab('ai'); });
      return;
    case 'AI':
      aiAskUI(line.slice(3));
      return;
    case 'AI-FOCUS': showSideTab('ai'); refreshTA(); $('ai-input').focus(); return;
    case 'KEY': aiKeyModal(); return;
    case 'ACCT':
      state.client.getMarginLevel().then((m) => {
        updateAccount({ balance: m.balance, equity: m.equity, margin: m.margin, marginFree: m.margin_free, marginLevel: m.margin_level, currency: m.currency });
        setStatus('Compte rafraîchi', 'ok');
      }).catch((e) => setStatus(e.message, 'err'));
      return;
    case 'IND': {
      const key = (tk[1] || '').toLowerCase();
      if (['sma', 'bb', 'vol', 'rsi', 'macd'].includes(key)) {
        state.chart.setOpt(key);
        syncIndButtons();
        setStatus(`${tk[1]} ${state.chart.opts[key] ? 'activé' : 'désactivé'}`, 'ok');
      } else setStatus('IND SMA|BB|VOL|RSI|MACD', 'err');
      return;
    }
    case 'LINE': state.chart.setOpt('type', 'line'); syncTypeButtons(); return;
    case 'CNDL': case 'CANDLE': state.chart.setOpt('type', 'candle'); syncTypeButtons(); return;
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
    case 'ALERT': {
      if (tk[1] === 'LIST' || !tk[1]) { showBottomTab('alerts'); return; }
      if (tk[1] === 'DEL') { deleteAlert(parseInt(tk[2], 10)); return; }
      const m = upper.match(/^ALERT\s+(\S+)\s*([<>])\s*([\d.,]+)$/);
      if (!m) { setStatus('Syntaxe: ALERT SYMBOLE > PRIX  (ou <)', 'err'); return; }
      addAlert(m[1], m[2], parseNum(m[3]));
      return;
    }
  }

  // formes "SYMBOLE [FONCTION] [ARGS]"
  const sym = tk[0];
  if (tk[1] === 'DES') { showDes(sym); return; }
  if (tk[1] === 'TA') { selectSymbol(sym).then(() => { refreshTA(); showSideTab('ai'); }); return; }
  if (tk[1] === 'GP' || tk.length === 1 || periodOf(tk[1])) {
    const p = periodOf(tk[2]) || periodOf(tk[1]) || state.period;
    selectSymbol(sym, p);
    return;
  }
  setStatus(`Commande inconnue: ${upper} — tapez HELP`, 'err');
}

/* ─────────────── UI bindings ─────────────── */

function syncIndButtons() {
  document.querySelectorAll('#ind-btns button').forEach((b) =>
    b.classList.toggle('on', !!state.chart.opts[b.dataset.i]));
}
function syncTypeButtons() {
  document.querySelectorAll('#type-btns button').forEach((b) =>
    b.classList.toggle('on', state.chart.opts.type === b.dataset.t));
}

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
  document.querySelectorAll('#ind-btns button').forEach((b) => {
    b.onclick = () => { state.chart.setOpt(b.dataset.i); syncIndButtons(); };
  });
  document.querySelectorAll('#type-btns button').forEach((b) => {
    b.onclick = () => { state.chart.setOpt('type', b.dataset.t); syncTypeButtons(); };
  });

  document.querySelectorAll('#panel-tabs .tab-btn').forEach((b) => {
    b.onclick = () => { showSideTab(b.dataset.tab); if (b.dataset.tab === 'ai') refreshTA(); };
  });
  document.querySelectorAll('#panel-bottom .tab-btn').forEach((b) => {
    b.onclick = () => showBottomTab(b.dataset.btab);
  });

  document.querySelectorAll('#softkeys button').forEach((b) => {
    b.onclick = () => runCommand(b.dataset.cmd);
  });

  $('t-buy').onclick = () => ticketOrder('BUY');
  $('t-sell').onclick = () => ticketOrder('SELL');

  $('ai-key-btn').onclick = aiKeyModal;
  aiKeyBadge();
  $('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { aiAskUI($('ai-input').value); $('ai-input').value = ''; }
  });

  // "/" focalise la ligne de commande, comme sur un vrai terminal
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault(); cmd.focus();
    }
  });

  // latence affichée toutes les 5 s
  setInterval(() => {
    const l = state.client && state.client.latency;
    $('st-latency').innerHTML = l != null ? `PING <b>${l} ms</b>` : '';
  }, 5000);
}

function ticketOrder(side) {
  confirmOrder(side, $('t-sym').value.trim(), parseNum($('t-vol').value), parseNum($('t-sl').value), parseNum($('t-tp').value));
}

/* ─────────────── horloge ─────────────── */

function startClock() {
  const tick = () => {
    const d = new Date();
    $('clock-utc').textContent = `UTC ${pd(d.getUTCHours())}:${pd(d.getUTCMinutes())}:${pd(d.getUTCSeconds())}`;
    $('clock-loc').textContent = `LOC ${pd(d.getHours())}:${pd(d.getMinutes())}:${pd(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}
