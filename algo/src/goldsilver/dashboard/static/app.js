/* Dashboard goldsilver — logique d'interface.
 *
 * Conventions de rendu (cf. style.css) :
 *  - grandeurs SIGNÉES (rendements mensuels, R, corrélations) => échelle
 *    divergente bleu↔rouge avec midpoint neutre, valeur toujours écrite ;
 *  - états DISCRETS (gagné/perdu, régime ouvert/fermé) => couleurs de statut
 *    doublées d'un mot ou d'une forme, jamais la couleur seule ;
 *  - aucun double axe : les actifs macro sont indexés base 100 pour tenir sur
 *    un seul axe comparable.
 */
'use strict';

const LWC = window.LightweightCharts;
const $ = (s) => document.querySelector(s);
const el = (t, cls, txt) => { const n = document.createElement(t); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* Le canvas de lightweight-charts ne comprend pas color-mix() : on convertit
 * les hex du thème en rgba() explicite pour les remplissages d'aire. */
function alpha(hex, a) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* Détruit proprement un chart existant (sinon chaque re-rendu fuit). */
function disposeChart(key) {
  const c = state.charts[key];
  if (c) { try { c.remove(); } catch (_) { } }
  delete state.charts[key];
}

const state = {
  snapshot: null, trades: null, stats: null, macro: null, journal: [],
  candles: {},           // asset -> payload
  asset: null,
  source: 'all',
  rangeMonths: 12,      // « tout » écrase 7 ans de trades : 1 an est lisible

  selectedTrade: null,
  sort: { key: 'entry_time', dir: -1 },
  macroMode: 'indexed',
  charts: {},
  series: {},
  priceLines: [],
};

/* ------------------------------------------------------------------ format */

const nf = (v, d = 2) => (v == null || Number.isNaN(v)) ? '—'
  : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v, d = 0) => v == null ? '—' : `${nf(v, d)} $`;
const pct = (v, d = 2) => v == null ? '—' : `${v > 0 ? '+' : ''}${nf(v, d)} %`;
const signCls = (v) => v == null ? 'dim' : (v > 0 ? 'pos' : (v < 0 ? 'neg' : 'dim'));
const dateFmt = (sec, withTime = true) => {
  if (!sec) return '—';
  const d = new Date(sec * 1000);
  const o = { year: 'numeric', month: '2-digit', day: '2-digit' };
  if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
  return d.toLocaleString('fr-FR', { ...o, timeZone: 'UTC' });
};

/* échelle divergente : |v| pilote le mélange vers le pôle, midpoint neutre */
function divColor(v, max) {
  if (v == null || !max) return 'var(--div-mid)';
  const w = Math.min(Math.abs(v) / max, 1) * 100;
  const pole = v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)';
  return `color-mix(in srgb, ${pole} ${w.toFixed(1)}%, var(--div-mid))`;
}

/* ------------------------------------------------------------------ réseau */

/* En export autonome (fichier HTML unique, sans serveur) toutes les réponses
 * d'API sont figées dans window.__GS_DATA__ : même code de rendu, zéro réseau. */
const OFFLINE = () => window.__GS_DATA__ || null;

async function get(path) {
  const emb = OFFLINE();
  if (emb) {
    const [route, qs] = path.split('?');
    if (route === '/api/candles') {
      const a = new URLSearchParams(qs || '').get('asset');
      return emb.candles[a] || { asset: a, candles: [], n_history: 0, n_fresh: 0, origin: 'export' };
    }
    if (route === '/api/all') return emb.all;
    throw new Error('route indisponible en export : ' + route);
  }
  const r = await fetch(path, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

async function loadAll() {
  document.body.classList.add('refreshing');
  try {
    const all = await get('/api/all');
    state.snapshot = all.snapshot;
    state.trades = all.trades;
    state.stats = all.stats;
    state.macro = all.macro;
    state.journal = all.journal;
    if (!state.asset) state.asset = (state.snapshot.diagnostics?.[0]?.asset) || 'XAUUSD';
    renderHeader(); renderTiles(); renderSignals(); renderVerdict();
    renderTradesTable(); renderPerformance(); renderMacro(); renderJournal();
    await loadCandles(state.asset);
  } catch (e) {
    console.error(e);
    $('#connBadge').textContent = 'erreur : ' + e.message;
    $('#connBadge').className = 'badge bad';
  } finally {
    document.body.classList.remove('refreshing');
  }
}

async function loadCandles(asset) {
  if (!state.candles[asset]) state.candles[asset] = await get('/api/candles?asset=' + asset);
  renderPriceChart();
}

/* ------------------------------------------------------------------ header */

function renderHeader() {
  const s = state.snapshot;
  const mb = $('#modeBadge');
  mb.textContent = s.mode.toUpperCase();
  mb.className = 'badge ' + s.mode;

  const cb = $('#connBadge');
  if (s.equity_origin === 'ig') { cb.textContent = 'IG en direct'; cb.className = 'badge ok'; }
  else { cb.textContent = 'hors-ligne (cache)'; cb.className = 'badge warn'; }

  const hb = $('#haltBadge');
  if (s.halted || s.kill_file_present) {
    hb.hidden = false;
    hb.className = 'badge bad';
    hb.textContent = s.kill_file_present ? '⛔ KILL armé' : '⛔ halte : ' + s.halt_reason;
  } else hb.hidden = true;

  $('#heroEquity').textContent = money(s.equity);
  const d = $('#heroDelta');
  d.textContent = s.day_pnl == null ? '' : `${s.day_pnl >= 0 ? '+' : ''}${nf(s.day_pnl)} $ aujourd'hui`;
  d.className = 'delta ' + signCls(s.day_pnl);

  $('#footNote').textContent =
    `Données ${s.equity_origin === 'ig' ? 'IG en direct' : 'cache disque'} · bougies : `
    + `${s.candle_origin === 'ig' ? 'IG' : (s.candle_origin === 'bot_cache' ? 'cache du bot' : 'aucune')}`
    + ` · généré ${s.generated_utc} UTC`
    + (s.broker_error ? ` · IG : ${s.broker_error}` : '');
}

function tile(label, value, foot, cls) {
  const c = el('div', 'card tile');
  c.append(el('div', 'label', label));
  const v = el('div', 'value' + (cls ? ' ' + cls : ''), value);
  c.append(v);
  if (foot) c.append(el('div', 'foot', foot));
  return c;
}

function renderTiles() {
  const s = state.snapshot, st = state.stats;
  const box = $('#tiles'); box.textContent = '';
  const bt = st.backtest.metrics || {};

  box.append(tile('Equity', money(s.equity),
    `plus haut ${money(s.hwm_equity)}`));
  box.append(tile('Drawdown actuel', pct(s.drawdown_pct),
    `coupure à −${nf(s.risk.max_dd_pct, 0)} %`, signCls(s.drawdown_pct)));
  box.append(tile('Risque par trade', `${nf(s.risk.risk_pct, 0)} %`,
    `plafond dur ${nf(s.risk.hard_cap_pct, 0)} % · max ${nf(s.risk.max_open_risk_pct, 0)} % cumulé`));
  box.append(tile('Positions ouvertes', String(s.positions.length),
    s.positions.length
      ? s.positions.map(p => `${p.instrument.split('.')[2] || p.instrument} ${nf(p.units, 2)}`).join(' · ')
      : 'aucune — l\'algo attend un signal'));
  box.append(tile('Trades réels', String(st.forward.n_trades),
    `${nf(st.forward.days_running, 1)} j de forward · PnL ${money(st.forward.total_pnl)}`,
    signCls(st.forward.total_pnl)));
  // le rendement mensuel N'EST PAS invariant au risque : le backtest tourne à
  // 0,75 %/trade, le bot à 4 %. On affiche donc le niveau de risque de
  // référence plutôt que de laisser croire à une prévision transposable.
  box.append(tile('Attendu (backtest)', `${nf(100 * (bt.monthly_mean || 0), 2)} %/mois`,
    `au risque backtest ${nf(100 * (st.backtest.risk_pct || 0), 2)} % · `
    + `${bt.n_trades} trades · réussite ${nf(100 * (bt.win_rate || 0), 1)} % · PF ${nf(bt.profit_factor)}`));
}

/* -------------------------------------------------- panneau de décision --- */

function renderSignals() {
  const box = $('#signals'); box.textContent = '';
  const diags = state.snapshot.diagnostics || [];
  if (!diags.length) { box.append(el('div', 'empty', 'aucun diagnostic')); return; }

  for (const d of diags) {
    const c = el('div', 'sig');
    const head = el('div', 'head');
    head.append(el('span', 'name', d.asset === 'XAUUSD' ? 'Or (XAU/USD)' : (d.asset === 'XAGUSD' ? 'Argent (XAG/USD)' : d.asset)));
    if (d.error) {
      head.append(el('span', 'px', d.error));
      c.append(head); box.append(c); continue;
    }
    head.append(el('span', 'px', nf(d.price, d.asset === 'XAGUSD' ? 3 : 2)));
    c.append(head);

    // verdict d'entrée : il faut le signal ET le régime
    const willTrade = d.signal > 0 && d.regime?.allowed;
    const badge = el('span', 'badge ' + (willTrade ? 'ok' : (d.signal > 0 ? 'warn' : 'paper')),
      willTrade ? '● Entrée imminente' : (d.signal > 0 ? '● Signal bloqué par le régime' : '● En attente'));
    c.append(badge);

    // distance à la cassure : barre = part du chemin parcouru sur les 3 derniers %
    if (d.breakout_level != null && d.distance_pct != null) {
      const span = 3.0;
      const done = Math.max(0, Math.min(1, (span - d.distance_pct) / span)) * 100;
      const m = el('div', 'meter');
      const track = el('div', 'track'); const fill = el('div', 'fill');
      fill.style.width = done.toFixed(1) + '%';
      if (d.distance_pct <= 0.5) fill.style.background = 'var(--good)';
      track.append(fill); m.append(track);
      const cap = el('div', 'cap');
      cap.append(el('span', null, `seuil de cassure ${nf(d.breakout_level, d.asset === 'XAGUSD' ? 3 : 2)}`));
      cap.append(el('span', null, d.distance_pct <= 0 ? 'franchi' : `manque ${nf(d.distance_pct, 2)} %`));
      m.append(cap); c.append(m);
    }

    const checks = el('div', 'checks');
    const addCheck = (label, ok, val) => {
      const r = el('div', 'check');
      const dot = el('span', 'dot ' + (ok ? 'on' : 'off'));
      r.append(dot, el('span', null, label), el('span', 'val', val));
      checks.append(r);
    };
    addCheck('Tendance (prix > EMA)', !!d.trend_ok,
      d.trend_ema != null ? nf(d.trend_ema, d.asset === 'XAGUSD' ? 3 : 2) : '—');
    if (d.regime) {
      addCheck('Pente de tendance', d.regime.slope_pct > 0, pct(d.regime.slope_pct, 2));
      addCheck(`Mouvement directionnel (ER ≥ ${nf(d.regime.er_min, 2)})`,
        d.regime.er_value >= d.regime.er_min, nf(d.regime.er_value, 2));
    }
    c.append(checks);

    if (d.range_recent) {
      c.append(el('div', 'note',
        `Volatilité récente : ${nf(d.range_recent.amplitude_pct, 1)} % d'amplitude sur ~4 jours `
        + `(${nf(d.range_recent.low, 2)} – ${nf(d.range_recent.high, 2)}). `
        + `Une forte amplitude sans direction ne déclenche rien : c'est le filtre anti-chop.`));
    }
    if (d.next_order && d.next_order.units > 0) {
      c.append(el('div', 'note',
        `Prochain ordre si ça part : ${nf(d.next_order.units, 2)} u · risque ${money(d.next_order.risk_amount)} `
        + `(${nf(d.next_order.risk_pct, 0)} %) · SL ${nf(d.next_order.sl_price, 2)} / TP ${nf(d.next_order.tp_price, 2)}`));
    }
    box.append(c);
  }
}

function renderVerdict() {
  const box = $('#verdict'); box.textContent = '';
  const m = state.stats.backtest.metrics || {};
  const p = state.stats.backtest.params || {};
  const rows = [
    ['Verdict', 'ROBUSTE — 6 tests sur 7', 'ok'],
    ['Trades (backtest)', `${m.n_trades}`, null],
    ['Rendement total', pct(100 * (m.total_return || 0), 1), signCls(m.total_return)],
    ['Rendement mensuel moyen', pct(100 * (m.monthly_mean || 0), 2), signCls(m.monthly_mean)],
    ['Drawdown max', `−${nf(100 * (m.max_drawdown || 0), 1)} %`, 'neg'],
    ['Taux de réussite', `${nf(100 * (m.win_rate || 0), 1)} %`, null],
    ['Profit factor', nf(m.profit_factor), null],
    ['Espérance', `${nf(m.expectancy_r, 3)} R`, signCls(m.expectancy_r)],
    ['Sharpe', nf(m.sharpe), null],
  ];
  const t = el('table');
  const tb = el('tbody');
  for (const [k, v, cls] of rows) {
    const tr = el('tr');
    tr.style.cursor = 'default';
    tr.append(el('td', null, k));
    const td = el('td', cls || undefined, v);
    tr.append(td);
    tb.append(tr);
  }
  t.append(tb); box.append(t);
  box.append(el('div', 'note',
    `Paramètres : Donchian ${p.donchian_n} · EMA ${p.trend_ema} · SL ${p.sl_atr_mult}×ATR · TP ${p.tp_rr}R · long seul. `
    + `Le seul test échoué est le detrending : l'edge dépend de la tendance — c'est pourquoi le filtre de régime existe.`));
}

/* -------------------------------------------------------------- chart prix */

function baseChartOptions(h) {
  return {
    height: h,
    layout: { background: { color: 'transparent' }, textColor: css('--muted'), fontFamily: css('--font') || 'system-ui', fontSize: 11 },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
    rightPriceScale: { borderColor: css('--axis'), scaleMargins: { top: 0.12, bottom: 0.12 } },
    // minBarSpacing par défaut (0.5) empêche fitContent d'afficher plusieurs
    // milliers de bougies dans la largeur disponible : la vue « Tout » serait
    // tronquée aux dernières années sans qu'on comprenne pourquoi.
    timeScale: {
      borderColor: css('--axis'), timeVisible: true, secondsVisible: false,
      minBarSpacing: 0.04,
    },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    localization: { locale: 'fr-FR' },
  };
}

/* les marqueurs doivent tomber sur un temps existant de la série */
function snapTime(t, times) {
  let lo = 0, hi = times.length - 1, best = times[0];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) { best = times[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

function visibleTrades() {
  const t = state.trades;
  let list = [];
  if (state.source === 'all' || state.source === 'backtest') list = list.concat(t.backtest);
  if (state.source === 'all' || state.source === 'live') list = list.concat(t.live);
  return list;
}

function renderPriceChart() {
  const payload = state.candles[state.asset];
  const host = $('#priceChart');
  disposeChart('price');
  state.priceLines = [];
  host.textContent = '';
  if (!payload || !payload.candles.length) { host.append(el('div', 'empty', 'aucune bougie')); return; }

  const chart = LWC.createChart(host, baseChartOptions(host.clientHeight || 460));
  state.charts.price = chart;

  const s = chart.addCandlestickSeries({
    upColor: css('--good'), downColor: css('--critical'),
    wickUpColor: css('--good'), wickDownColor: css('--critical'),
    borderVisible: false,
    priceFormat: { type: 'price', precision: state.asset === 'XAGUSD' ? 3 : 2, minMove: state.asset === 'XAGUSD' ? 0.001 : 0.01 },
  });
  const data = payload.candles.map(([t, o, h, l, c]) => ({ time: t, open: o, high: h, low: l, close: c }));
  s.setData(data);
  state.series.price = s;

  const times = data.map(d => d.time);
  const first = times[0], last = times[times.length - 1];

  const markers = [];
  for (const tr of visibleTrades()) {
    if (tr.asset !== state.asset) continue;
    if (tr.entry_time && tr.entry_time >= first && tr.entry_time <= last) {
      markers.push({
        time: snapTime(tr.entry_time, times),
        position: 'belowBar',
        color: css('--good'),
        shape: tr.side > 0 ? 'arrowUp' : 'arrowDown',
        _text: (tr.source === 'live' ? '● RÉEL ' : '') + (tr.side > 0 ? 'Achat' : 'Vente'),
        id: tr.id + ':in',
      });
    }
    if (tr.exit_time && tr.exit_time >= first && tr.exit_time <= last) {
      const win = (tr.r_multiple ?? tr.pnl ?? 0) > 0;
      markers.push({
        time: snapTime(tr.exit_time, times),
        position: 'aboveBar',
        color: win ? css('--s1') : css('--critical'),
        shape: tr.side > 0 ? 'arrowDown' : 'arrowUp',
        _text: (tr.r_multiple != null ? `${tr.r_multiple > 0 ? '+' : ''}${tr.r_multiple.toFixed(1)}R` : 'sortie'),
        id: tr.id + ':out',
      });
    }
  }
  markers.sort((a, b) => a.time - b.time);
  state.allMarkers = markers;
  refreshMarkers();
  // au-delà d'une certaine densité les étiquettes se chevauchent et deviennent
  // illisibles : on ne les affiche que quand le zoom laisse la place
  chart.timeScale().subscribeVisibleTimeRangeChange(debounce(refreshMarkers, 120));

  applyRange();
  highlightTrade(state.selectedTrade, false);

  $('#chartNote').textContent =
    `${payload.candles.length} bougies ${payload.timeframe} · ${markers.length} marqueurs · `
    + `historique versionné ${payload.n_history} + ${payload.n_fresh} fraîches (${payload.origin === 'ig' ? 'IG' : 'cache du bot'})`
    + ` · zoome pour faire apparaître les étiquettes`;
}

const MAX_LABELS = 24;

function refreshMarkers() {
  const s = state.series.price, chart = state.charts.price;
  if (!s || !chart) return;
  const all = state.allMarkers || [];
  let inView = all;
  try {
    const r = chart.timeScale().getVisibleRange();
    if (r) inView = all.filter(m => m.time >= r.from && m.time <= r.to);
  } catch (_) { /* chart pas encore dimensionné */ }
  const withText = inView.length <= MAX_LABELS;
  s.setMarkers(all.map(m => ({
    time: m.time, position: m.position, color: m.color, shape: m.shape,
    id: m.id, text: withText ? m._text : '',
  })));
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function applyRange() {
  const chart = state.charts.price;
  if (!chart) return;
  if (!state.rangeMonths) { chart.timeScale().fitContent(); return; }
  const payload = state.candles[state.asset];
  const last = payload.candles[payload.candles.length - 1][0];
  chart.timeScale().setVisibleRange({ from: last - state.rangeMonths * 30 * 86400, to: last });
}

function highlightTrade(tr, zoom = true) {
  const s = state.series.price, chart = state.charts.price;
  if (!s || !chart) return;
  for (const pl of state.priceLines) s.removePriceLine(pl);
  state.priceLines = [];
  if (!tr || tr.asset !== state.asset) return;

  const add = (price, color, title, style) => {
    if (price == null) return;
    state.priceLines.push(s.createPriceLine({
      price, color, lineWidth: 1, lineStyle: style ?? LWC.LineStyle.Dashed,
      axisLabelVisible: true, title,
    }));
  };
  add(tr.entry, css('--ink-2'), 'entrée', LWC.LineStyle.Solid);
  add(tr.sl, css('--critical'), 'SL');
  add(tr.tp, css('--s3'), 'TP');
  if (tr.exit != null) add(tr.exit, css('--s1'), 'sortie', LWC.LineStyle.Solid);

  if (zoom && tr.entry_time) {
    const pad = 40 * 4 * 3600;
    const to = (tr.exit_time || tr.entry_time) + pad;
    chart.timeScale().setVisibleRange({ from: tr.entry_time - pad, to });
  }
}

/* ------------------------------------------------------------ table trades */

function renderTradesTable() {
  const list = visibleTrades().slice();
  const { key, dir } = state.sort;
  list.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });

  const tb = $('#tradesTable tbody');
  tb.textContent = '';
  const closed = list.filter(t => t.pnl != null);
  const wins = closed.filter(t => t.pnl > 0).length;
  $('#tradesSub').textContent =
    `${list.length} positions affichées · ${closed.length} clôturées · `
    + `${closed.length ? nf(100 * wins / closed.length, 1) : '—'} % gagnantes · `
    + `${state.trades.live.length} réelles, ${state.trades.backtest.length} en backtest`;

  if (!list.length) { tb.append(el('tr', null, '')); return; }

  for (const t of list.slice(0, 600)) {
    const tr = el('tr');
    if (state.selectedTrade && state.selectedTrade.id === t.id) tr.classList.add('sel');
    tr.append(el('td', null, dateFmt(t.entry_time)));
    tr.append(el('td', null, t.asset === 'XAUUSD' ? 'Or' : (t.asset === 'XAGUSD' ? 'Argent' : t.asset)));
    const sideTd = el('td');
    sideTd.append(el('span', 'pill', t.side > 0 ? '▲ Achat' : '▼ Vente'));
    if (t.source === 'live') { const b = el('span', 'pill', ' RÉEL'); b.style.marginLeft = '4px'; b.style.color = 'var(--s1)'; sideTd.append(b); }
    tr.append(sideTd);
    tr.append(el('td', null, nf(t.entry, t.asset === 'XAGUSD' ? 3 : 2)));
    tr.append(el('td', null, t.exit == null ? 'en cours' : nf(t.exit, t.asset === 'XAGUSD' ? 3 : 2)));
    tr.append(el('td', null, ({ tp: 'Take profit', sl: 'Stop loss', time: 'Durée max', end: 'Fin période', broker: 'Broker', 'en cours': 'En cours' })[t.reason] || t.reason));
    tr.append(el('td', signCls(t.r_multiple), t.r_multiple == null ? '—' : `${t.r_multiple > 0 ? '+' : ''}${nf(t.r_multiple, 2)}`));
    tr.append(el('td', signCls(t.pnl), t.pnl == null ? '—' : `${t.pnl > 0 ? '+' : ''}${nf(t.pnl)}`));
    tr.onclick = () => {
      state.selectedTrade = t;
      if (t.asset !== state.asset) {
        state.asset = t.asset;
        syncSegs();
        loadCandles(t.asset).then(() => highlightTrade(t));
      } else highlightTrade(t);
      renderTradesTable();
    };
    tb.append(tr);
  }
}

/* -------------------------------------------------------------- performance */

function renderPerformance() {
  const bt = state.stats.backtest;
  const m = bt.metrics || {};
  $('#equitySub').textContent =
    `${money(bt.initial_equity, 0)} de départ · risque ${nf(100 * (bt.risk_pct || 0), 2)} %/trade `
    + `· ${m.n_trades} trades · ${m.start?.slice(0, 10)} → ${m.end?.slice(0, 10)}`;

  // equity — une seule série, donc pas de légende (le titre la nomme)
  const eh = $('#equityChart'); disposeChart('equity'); eh.textContent = '';
  const ec = LWC.createChart(eh, baseChartOptions(eh.clientHeight || 210));
  const es = ec.addAreaSeries({
    lineColor: css('--s1'), lineWidth: 2,
    topColor: alpha(css('--s1'), 0.28),
    bottomColor: alpha(css('--s1'), 0.0),
  });
  es.setData(bt.equity.map(([t, v]) => ({ time: t, value: v })));
  ec.timeScale().fitContent();
  state.charts.equity = ec;

  // drawdown — série unique en aire, pôle négatif de l'échelle divergente
  const dh = $('#ddChart'); disposeChart('dd'); dh.textContent = '';
  const dc = LWC.createChart(dh, baseChartOptions(dh.clientHeight || 210));
  const ds = dc.addAreaSeries({
    lineColor: css('--div-neg'), lineWidth: 2,
    topColor: alpha(css('--div-neg'), 0.0),
    bottomColor: alpha(css('--div-neg'), 0.30),
    priceFormat: { type: 'percent' },
  });
  ds.setData(bt.drawdown.map(([t, v]) => ({ time: t, value: 100 * v })));
  dc.timeScale().fitContent();
  state.charts.dd = dc;

  renderMonthly(bt.monthly);
  renderRHist();
}

function renderMonthly(monthly) {
  const box = $('#monthly'); box.textContent = '';
  if (!monthly?.length) { box.append(el('div', 'empty', 'pas de données')); return; }
  const years = [...new Set(monthly.map(m => m.year))].sort();
  const max = Math.max(...monthly.map(m => Math.abs(m.ret || 0))) || 0.01;
  const byKey = new Map(monthly.map(m => [`${m.year}-${m.month}`, m.ret]));
  const names = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  const grid = el('div', 'heat');
  grid.style.gridTemplateColumns = `44px repeat(12, minmax(30px, 1fr)) 56px`;
  grid.append(el('div', 'hd', ''));
  names.forEach(n => grid.append(el('div', 'hd', n)));
  grid.append(el('div', 'hd', 'année'));

  for (const y of years) {
    grid.append(el('div', 'hd', String(y)));
    let compound = 1;
    for (let mo = 1; mo <= 12; mo++) {
      const v = byKey.get(`${y}-${mo}`);
      const c = el('div', 'cell', v == null ? '' : (100 * v).toFixed(1));
      // mois sans données : cellule vide, jamais confondue avec un 0 %
      c.style.background = v == null ? 'transparent' : divColor(v, max);
      if (v != null) { compound *= (1 + v); c.title = `${y}-${String(mo).padStart(2, '0')} : ${pct(100 * v, 2)}`; }
      grid.append(c);
    }
    const yr = compound - 1;
    const yc = el('div', 'cell', (100 * yr).toFixed(1));
    yc.style.background = divColor(yr, max * 3);
    yc.style.fontWeight = '600';
    grid.append(yc);
  }
  box.append(grid);
  $('#monthScale').style.background =
    `linear-gradient(to right, var(--div-neg), var(--div-mid), var(--div-pos))`;
}

function renderRHist() {
  const host = $('#rHist'); host.textContent = '';
  const rs = visibleTrades().map(t => t.r_multiple).filter(v => v != null);
  if (!rs.length) { host.append(el('div', 'empty', 'pas de trades clôturés')); return; }

  const edges = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 10];
  const counts = new Array(edges.length - 1).fill(0);
  for (const r of rs) {
    let i = edges.findIndex((e, k) => k < edges.length - 1 && r >= e && r < edges[k + 1]);
    if (r >= edges[edges.length - 1]) i = counts.length - 1;
    if (i < 0) i = r < edges[0] ? 0 : counts.length - 1;
    counts[i]++;
  }
  const maxC = Math.max(...counts);
  const W = 520, H = 190, pad = { l: 34, r: 8, t: 10, b: 30 };
  const bw = (W - pad.l - pad.r) / counts.length;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.style.display = 'block';

  const mk = (tag, attrs, txt) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (txt != null) n.textContent = txt;
    return n;
  };
  // grille en filet + axe
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (H - pad.t - pad.b) * i / 4;
    svg.append(mk('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: css('--grid'), 'stroke-width': 1 }));
    svg.append(mk('text', { x: pad.l - 6, y: y + 3, 'text-anchor': 'end', fill: css('--muted'), 'font-size': 9 },
      String(Math.round(maxC * (1 - i / 4)))));
  }
  counts.forEach((c, i) => {
    const h = maxC ? (H - pad.t - pad.b) * c / maxC : 0;
    const x = pad.l + i * bw, y = H - pad.b - h;
    const mid = (edges[i] + Math.min(edges[i + 1], 4)) / 2;
    // 2px d'écart de surface entre barres adjacentes, coins hauts arrondis
    const rect = mk('rect', {
      x: x + 1, y, width: Math.max(bw - 2, 1), height: h,
      rx: Math.min(4, Math.max(bw - 2, 1) / 2), fill: divColor(mid, 3),
    });
    rect.append(mk('title', {}, `${c} trades entre ${edges[i]}R et ${edges[i + 1]}R`));
    svg.append(rect);
    if (c) svg.append(mk('text', { x: x + bw / 2, y: y - 3, 'text-anchor': 'middle', fill: css('--muted'), 'font-size': 9 }, String(c)));
  });
  // étiquettes d'axe sélectives (pas un nombre sous chaque barre)
  [0, 4, 8, counts.length - 1].forEach(i => {
    svg.append(mk('text', {
      x: pad.l + i * bw + bw / 2, y: H - pad.b + 14, 'text-anchor': 'middle',
      fill: css('--muted'), 'font-size': 9,
    }, i === counts.length - 1 ? '3R+' : `${edges[i]}R`));
  });
  svg.append(mk('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, stroke: css('--axis'), 'stroke-width': 1 }));
  host.append(svg);

  const wins = rs.filter(r => r > 0).length;
  const avgW = rs.filter(r => r > 0).reduce((a, b) => a + b, 0) / (wins || 1);
  const avgL = rs.filter(r => r <= 0).reduce((a, b) => a + b, 0) / ((rs.length - wins) || 1);
  $('#rNote').textContent =
    `${rs.length} trades · ${nf(100 * wins / rs.length, 1)} % gagnants · `
    + `gain moyen ${nf(avgW, 2)}R · perte moyenne ${nf(avgL, 2)}R · `
    + `espérance ${nf(rs.reduce((a, b) => a + b, 0) / rs.length, 3)}R par trade`;
}

/* ------------------------------------------------------------------- macro */

function renderMacro() {
  const m = state.macro;
  renderCorr(m);

  const host = $('#macroChart'); disposeChart('macro'); host.textContent = '';
  const leg = $('#macroLegend'); leg.textContent = '';
  if (!m.series || !Object.keys(m.series).length) { host.append(el('div', 'empty', 'pas de données macro')); return; }

  // échelle LOG : BTC fait x15 sur la période, Bitcoin écraserait les autres
  // en une ligne plate sur une échelle linéaire. En log, une même pente = une
  // même performance en %, ce qui est justement la comparaison recherchée.
  const opts = baseChartOptions(host.clientHeight || 230);
  opts.rightPriceScale = { ...opts.rightPriceScale, mode: LWC.PriceScaleMode.Logarithmic };
  const chart = LWC.createChart(host, opts);
  state.charts.macro = chart;
  const palette = ['--s1', '--s2', '--s3', '--s4', '--s5'];
  const labels = m.labels || {};

  Object.keys(m.series).forEach((sym, i) => {
    const pts = m.series[sym];
    if (!pts?.length) return;
    // indexation base 100 : deux échelles différentes ne partagent JAMAIS un axe
    const base = pts.find(p => p[1])?.[1] || 1;
    const s = chart.addLineSeries({
      color: css(palette[i % palette.length]), lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
      title: labels[sym] || sym,
    });
    s.setData(pts.map(([t, v]) => ({ time: t, value: 100 * v / base })));
    const k = el('span', 'key');
    const sw = el('span', 'swatch line');
    sw.style.background = css(palette[i % palette.length]);
    k.append(sw, document.createTextNode(labels[sym] || sym));
    leg.append(k);
  });
  // le recadrage doit attendre que le conteneur ait sa largeur définitive
  requestAnimationFrame(() => { try { chart.timeScale().fitContent(); } catch (_) { } });
  leg.append(el('span', 'key dim', '— base 100 au 1ᵉʳ janvier 2019, échelle log'));

  if (m.live_ratio) {
    leg.append(el('span', 'key', `· ratio or/argent en direct : ${nf(m.live_ratio, 1)}`));
  }
}

function renderCorr(m) {
  const box = $('#corr'); box.textContent = '';
  const c = m.correlation;
  if (!c?.symbols?.length) { box.append(el('div', 'empty', 'pas de corrélations')); return; }
  const short = { XAUUSD: 'Or', XAGUSD: 'Arg', USA500IDXUSD: 'S&P', LIGHTCMDUSD: 'WTI', BTCUSD: 'BTC' };
  const n = c.symbols.length;

  const grid = el('div', 'heat');
  grid.style.gridTemplateColumns = `52px repeat(${n}, minmax(38px, 1fr))`;
  grid.append(el('div', 'hd', ''));
  c.symbols.forEach(s => grid.append(el('div', 'hd', short[s] || s)));
  c.matrix.forEach((row, i) => {
    grid.append(el('div', 'hd', short[c.symbols[i]] || c.symbols[i]));
    row.forEach((v, j) => {
      const cell = el('div', 'cell', v == null ? '' : v.toFixed(2));
      cell.style.background = i === j ? 'var(--div-mid)' : divColor(v, 1);
      cell.title = `${short[c.symbols[i]]} vs ${short[c.symbols[j]]} : ${v}`;
      grid.append(cell);
    });
  });
  box.append(grid);
  box.append(el('div', 'note', c.note || ''));
}

/* ----------------------------------------------------------------- journal */

function renderJournal() {
  const box = $('#journal'); box.textContent = '';
  if (!state.journal.length) { box.append(el('div', 'empty', 'journal vide')); return; }
  const label = {
    cycle: 'cycle', order: 'ORDRE', trade_closed: 'CLÔTURE', reject: 'rejet',
    error: 'ERREUR', regime: 'régime', decision: 'décision', slippage: 'slippage',
    killswitch: 'KILL', flatten: 'FLATTEN', reconcile_adopted: 'adoption',
  };
  for (const e of state.journal) {
    const r = el('div', 'ev');
    r.append(el('span', 'ts', (e.ts || '').replace('T', ' ').replace('+00:00', '')));
    const ty = el('span', 'ty', label[e.type] || e.type);
    if (['order', 'trade_closed', 'killswitch', 'flatten'].includes(e.type)) ty.style.color = 'var(--s1)';
    if (['error', 'killswitch'].includes(e.type)) ty.style.color = 'var(--critical)';
    r.append(ty);
    const { ts, type, ...rest } = e;
    r.append(el('span', 'msg', Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' · ')));
    box.append(r);
  }
}

/* ------------------------------------------------------------- interactions */

function syncSegs() {
  document.querySelectorAll('#assetSeg button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.asset === state.asset)));
  document.querySelectorAll('#sourceSeg button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.src === state.source)));
  document.querySelectorAll('#rangeSeg button').forEach(b =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.range) === state.rangeMonths)));
}

function buildAssetSeg() {
  const seg = $('#assetSeg'); seg.textContent = '';
  const names = { XAUUSD: 'Or', XAGUSD: 'Argent' };
  for (const d of (state.snapshot.diagnostics || [])) {
    const b = el('button', null, names[d.asset] || d.asset);
    b.dataset.asset = d.asset;
    b.onclick = async () => {
      state.asset = d.asset; syncSegs();
      await loadCandles(d.asset);
    };
    seg.append(b);
  }
  syncSegs();
}

function wire() {
  $('#refreshBtn').onclick = () => { state.candles = {}; loadAll(); };

  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : (cur === 'light' ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gs-theme', next); } catch (_) { /* stockage bloqué */ }
    // le redessin est pris en charge par watchTheme()
  };

  document.querySelectorAll('#sourceSeg button').forEach(b => {
    b.onclick = () => { state.source = b.dataset.src; syncSegs(); renderPriceChart(); renderTradesTable(); renderRHist(); };
  });
  document.querySelectorAll('#rangeSeg button').forEach(b => {
    b.onclick = () => { state.rangeMonths = Number(b.dataset.range); syncSegs(); applyRange(); };
  });
  $('#fitBtn').onclick = () => { state.selectedTrade = null; state.rangeMonths = 0; syncSegs(); highlightTrade(null); applyRange(); renderTradesTable(); };

  document.querySelectorAll('#tradesTable th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
      renderTradesTable();
    };
  });

  const dlg = $('#killDlg');
  $('#killBtn').onclick = () => { $('#killInput').value = ''; $('#killErr').textContent = ''; dlg.showModal(); };
  $('#killCancel').onclick = () => dlg.close();
  $('#killConfirm').onclick = async () => {
    if ($('#killInput').value.trim() !== 'KILL') { $('#killErr').textContent = 'Tape exactement KILL.'; return; }
    try {
      const r = await fetch('/api/kill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'KILL' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'échec');
      dlg.close(); loadAll();
    } catch (e) { $('#killErr').textContent = e.message; }
  };

  window.addEventListener('resize', () => {
    for (const c of Object.values(state.charts)) { try { c.applyOptions({}); } catch (_) { } }
  });
}

/* ------------------------------------------------------------------ départ */

/* Les charts peignent sur un canvas : ils ne relisent pas les variables CSS
 * quand le thème bascule. On les reconstruit à chaque changement, d'où qu'il
 * vienne — bouton local, bascule de la page hôte, ou préférence système. */
function watchTheme() {
  const redraw = debounce(() => {
    if (!state.snapshot) return;
    renderPriceChart(); renderPerformance(); renderMacro();
  }, 80);
  new MutationObserver(redraw).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', redraw);
}

(async function main() {
  // Si l'hôte a déjà imposé un thème (page publiée, bascule du lecteur), il
  // commande : on ne le contredit pas avec une préférence locale périmée.
  if (!document.documentElement.hasAttribute('data-theme')) {
    let saved = null;
    try { saved = localStorage.getItem('gs-theme'); } catch (_) { /* bloqué */ }
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }
  watchTheme();
  wire();
  await loadAll();
  buildAssetSeg();
  if (OFFLINE()) {
    // instantané figé : ni rafraîchissement, ni action sur le bot
    $('#refreshBtn').hidden = true;
    $('#killBtn').hidden = true;
    const b = $('#connBadge');
    b.textContent = 'instantané exporté';
    b.className = 'badge warn';
  } else {
    setInterval(loadAll, 60000);   // le bot décide toutes les 4 h : 1 min suffit
  }
})();
