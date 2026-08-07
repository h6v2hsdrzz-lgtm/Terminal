/* goldsilver — pilotage de l'algo.
 *
 * Conventions de rendu :
 *  - grandeurs SIGNÉES (rendements, R, corrélations) => échelle divergente
 *    bleu↔rouge, midpoint neutre, valeur toujours écrite ;
 *  - états DISCRETS (gagné/perdu, régime, coupe-circuit) => couleurs de statut
 *    doublées d'un mot ou d'une forme — jamais la couleur seule ;
 *  - aucun double axe : les actifs comparés sont indexés base 100 en log ;
 *  - l'identité (or/acier) habille le chrome, jamais l'encodage des données.
 */
'use strict';

const LWC = window.LightweightCharts;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const el = (t, cls, txt) => {
  const n = document.createElement(t);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  snapshot: null, trades: null, stats: null, macro: null, journal: [], analytics: null,
  candles: {}, asset: null, source: 'all', rangeMonths: 12,
  selectedTrade: null, sort: { key: 'entry_time', dir: -1 },
  charts: {}, series: {}, priceLines: [], allMarkers: [],
};

/* ------------------------------------------------------------------ format */

const nf = (v, d = 2) => (v == null || Number.isNaN(v)) ? '—'
  : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v, d = 0) => v == null ? '—' : `${nf(v, d)} $`;
const pct = (v, d = 2) => v == null ? '—' : `${v > 0 ? '+' : ''}${nf(v, d)} %`;
const sgn = (v) => v == null ? 'dim' : (v > 0 ? 'pos' : (v < 0 ? 'neg' : 'dim'));
const dfmt = (sec, time = true) => {
  if (!sec) return '—';
  const o = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' };
  if (time) { o.hour = '2-digit'; o.minute = '2-digit'; }
  return new Date(sec * 1000).toLocaleString('fr-FR', o);
};
const dec = (a) => (a === 'XAGUSD' ? 3 : 2);

function alpha(hex, a) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* échelle divergente : |v| pilote le mélange vers le pôle, midpoint neutre */
function divColor(v, max) {
  if (v == null || !max) return 'var(--div-mid)';
  const w = Math.min(Math.abs(v) / max, 1) * 100;
  return `color-mix(in srgb, ${v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${w.toFixed(1)}%, var(--div-mid))`;
}

/* compteur animé — un instrument fait défiler ses chiffres, il ne saute pas */
function setNum(node, value, fmt) {
  const to = Number(value);
  if (!Number.isFinite(to)) { node.textContent = '—'; return; }
  const from = Number(node.dataset.v);
  node.dataset.v = String(to);
  if (REDUCED || !Number.isFinite(from) || from === to) { node.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 520;
  const step = (t) => {
    const k = Math.min((t - t0) / dur, 1);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* lightweight-charts rejette les valeurs nulles (« Value is null ») : le
 * sérialiseur Python produit null pour tout point non fini, il faut donc
 * filtrer avant setData plutôt que laisser un trou casser tout le graphique. */
function linePts(rows, map) {
  const out = [];
  for (const row of rows || []) {
    const p = map(row);
    if (p && p.time != null && Number.isFinite(p.value)) out.push(p);
  }
  // la lib exige des temps strictement croissants et uniques : un doublon
  // laisse la série muette et lève « Value is null » au rendu
  out.sort((a, b) => a.time - b.time);
  const dedup = [];
  for (const p of out) {
    if (dedup.length && dedup[dedup.length - 1].time === p.time) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  return dedup;
}

function svg(tag, attrs, txt) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (txt != null) n.textContent = txt;
  return n;
}
function svgRoot(w, h) {
  const s = svg('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%' });
  s.style.display = 'block';
  return s;
}

/* ------------------------------------------------------------------ réseau */

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
  const r = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

async function loadAll() {
  document.body.classList.add('refreshing');
  try {
    const all = await get('/api/all');
    Object.assign(state, {
      snapshot: all.snapshot, trades: all.trades, stats: all.stats,
      macro: all.macro, journal: all.journal, analytics: all.analytics || {},
    });
    if (!state.asset) state.asset = state.snapshot.diagnostics?.[0]?.asset || 'XAUUSD';
    renderHeader(); renderTiles(); renderKillGauges(); renderExposure(); renderVerdict();
    renderPositions(); renderSignals(); renderTradesTable(); renderPerformance();
    renderBehaviour(); renderMonteCarlo(); renderMacro(); renderJournal();
    await loadCandles(state.asset);
  } catch (e) {
    console.error(e);
    const c = $('#connChip');
    c.textContent = 'erreur : ' + e.message;
    c.className = 'chip bad';
  } finally {
    document.body.classList.remove('refreshing');
  }
}

async function loadCandles(asset) {
  if (!state.candles[asset]) state.candles[asset] = await get('/api/candles?asset=' + asset);
  renderPriceChart();
}

/* ------------------------------------------------------------------ entête */

function renderHeader() {
  const s = state.snapshot;
  const m = $('#modeChip');
  m.textContent = s.mode;
  m.className = 'chip ' + (s.mode === 'live' ? 'bad' : 'gold');

  const c = $('#connChip');
  c.textContent = '';
  c.append(el('span', 'led'), document.createTextNode(
    s.equity_origin === 'ig' ? 'IG en direct' : 'cache disque'));
  c.className = 'chip ' + (s.equity_origin === 'ig' ? 'on' : 'warn');

  const h = $('#haltChip');
  if (s.halted || s.kill_file_present) {
    h.hidden = false;
    h.textContent = s.kill_file_present ? 'KILL armé' : 'halte — ' + s.halt_reason;
  } else h.hidden = true;

  setNum($('#heroEquity'), s.equity, (v) => money(v, 0));
  const d = $('#heroDelta');
  d.textContent = s.day_pnl == null ? '' : `${s.day_pnl >= 0 ? '+' : ''}${nf(s.day_pnl)} $ jour`;
  d.className = 'd ' + sgn(s.day_pnl);

  $('#etatSub').textContent =
    `${s.strategy} · risque ${nf(s.risk.risk_pct, 0)} %/trade · plafond dur ${nf(s.risk.hard_cap_pct, 0)} %`;
  $('#footNote').textContent =
    `Equity : ${s.equity_origin === 'ig' ? 'IG en direct' : 'cache disque'} · bougies : `
    + `${{ ig: 'IG', bot_cache: 'cache du bot', none: 'aucune' }[s.candle_origin] || s.candle_origin}`
    + ` · généré ${s.generated_utc} UTC` + (s.broker_error ? ` · IG : ${s.broker_error}` : '');
}

function tile(k, v, f, cls) {
  const c = el('div', 'card tile reveal');
  c.append(el('div', 'k', k));
  c.append(el('div', 'v' + (cls ? ' ' + cls : ''), v));
  if (f) c.append(el('div', 'f', f));
  return c;
}

function renderTiles() {
  const s = state.snapshot, st = state.stats;
  const bt = st.backtest.metrics || {};
  const box = $('#tiles'); box.textContent = '';
  const openPnl = s.positions.reduce((a, p) => a + (p.unrealized_pnl || 0), 0);

  box.append(tile('Equity', money(s.equity), `plus-haut ${money(s.hwm_equity)}`));
  box.append(tile('Drawdown', pct(s.drawdown_pct), `halte à −${nf(s.risk.max_dd_pct, 0)} %`, sgn(s.drawdown_pct)));
  box.append(tile('Positions', String(s.positions.length),
    s.positions.length ? `${openPnl >= 0 ? '+' : ''}${nf(openPnl)} $ latent` : 'aucune — en attente de signal',
    s.positions.length ? sgn(openPnl) : ''));
  box.append(tile('Trades réels', String(st.forward.n_trades),
    `${nf(st.forward.days_running, 0)} j · PnL ${money(st.forward.total_pnl)}`, sgn(st.forward.total_pnl)));
  box.append(tile('Espérance', `${nf(bt.expectancy_r, 3)} R`,
    `backtest · réussite ${nf(100 * (bt.win_rate || 0), 1)} % · PF ${nf(bt.profit_factor)}`));
  box.append(tile('Attendu', `${nf(100 * (bt.monthly_mean || 0), 2)} %/mois`,
    `au risque du bot ${nf(100 * (st.backtest.risk_pct || 0), 0)} % · DD max ${nf(100 * (bt.max_drawdown || 0), 0)} %`));
  box.append(tile('Pertes d\'affilée', String(s.consecutive_losses),
    `halte à ${s.risk.max_consecutive_losses}`, s.consecutive_losses >= 3 ? 'neg' : ''));
  box.append(tile('Perte du jour', pct(s.day_pnl_pct), `halte à −${nf(s.risk.max_daily_loss_pct, 0)} %`, sgn(s.day_pnl_pct)));
  reveal();
}

/* --------------------------------------------------------- coupe-circuits */

function gauge(label, value, limit, unit, invert) {
  const frac = limit ? Math.min(Math.abs(value || 0) / Math.abs(limit), 1) : 0;
  const col = frac >= 0.75 ? 'var(--critical)' : frac >= 0.45 ? 'var(--warning)' : 'var(--good)';
  const g = el('div', 'gauge');
  const row = el('div', 'row');
  row.append(el('span', 'k', label));
  row.append(el('span', 'v', `${nf(value, unit === '%' ? 2 : 0)}${unit} / ${nf(limit, unit === '%' ? 0 : 0)}${unit}`));
  g.append(row);
  const bar = el('div', 'bar');
  const i = el('i');
  i.style.width = (100 * frac).toFixed(1) + '%';
  i.style.background = col;
  bar.append(i); g.append(bar);
  g.append(el('div', 'cap', frac >= 0.75 ? '⚠ proche du seuil de halte'
    : frac >= 0.45 ? 'à surveiller' : 'marge confortable'));
  return g;
}

function renderKillGauges() {
  const s = state.snapshot;
  const box = $('#killGauges'); box.textContent = '';
  const wrap = el('div'); wrap.style.display = 'grid'; wrap.style.gap = '16px';
  wrap.append(gauge('Drawdown depuis le plus-haut', Math.abs(s.drawdown_pct || 0), s.risk.max_dd_pct, ' %'));
  wrap.append(gauge('Perte sur la journée', Math.abs(Math.min(s.day_pnl_pct || 0, 0)), s.risk.max_daily_loss_pct, ' %'));
  wrap.append(gauge('Pertes consécutives', s.consecutive_losses, s.risk.max_consecutive_losses, ''));
  box.append(wrap);
}

function renderExposure() {
  const s = state.snapshot;
  const box = $('#exposure'); box.textContent = '';
  const openRisk = s.positions.reduce((a, p) => {
    if (!p.sl || !p.avg_price) return a;
    return a + Math.abs(p.avg_price - p.sl) * Math.abs(p.units);
  }, 0);
  const openNotional = s.positions.reduce((a, p) => a + Math.abs(p.units) * (p.avg_price || 0), 0);
  const eq = s.equity || 1;
  const wrap = el('div'); wrap.style.display = 'grid'; wrap.style.gap = '16px';
  wrap.append(gauge('Risque ouvert cumulé', 100 * openRisk / eq, s.risk.max_open_risk_pct, ' %'));
  const kv = el('div', 'kv');
  const add = (k, v) => { const d = el('div'); d.append(el('span', 'k', k), el('span', 'v', v)); kv.append(d); };
  add('Notionnel engagé', money(openNotional));
  add('Levier effectif', `${nf(openNotional / eq, 2)} ×`);
  add('Risque en $', money(openRisk));
  wrap.append(kv);
  box.append(wrap);
}

function renderVerdict() {
  const box = $('#verdict'); box.textContent = '';
  const m = state.stats.backtest.metrics || {}, p = state.stats.backtest.params || {};
  const t = el('table'), tb = el('tbody');
  const row = (k, v, cls) => {
    const tr = el('tr'); tr.style.cursor = 'default';
    tr.append(el('td', 'txt', k)); tr.append(el('td', cls || undefined, v)); tb.append(tr);
  };
  row('Verdict', 'ROBUSTE — 6/7', 'pos');
  row('Trades', String(m.n_trades));
  row('Rendement total', pct(100 * (m.total_return || 0), 1), sgn(m.total_return));
  row('Drawdown max', `−${nf(100 * (m.max_drawdown || 0), 1)} %`, 'neg');
  row('Sharpe', nf(m.sharpe));
  row('Profit factor', nf(m.profit_factor));
  t.append(tb); box.append(t);
  box.append(el('div', 'note',
    `Donchian ${p.donchian_n} · EMA ${p.trend_ema} · SL ${p.sl_atr_mult}×ATR · TP ${p.tp_rr}R · long seul. `
    + `Seul test échoué : le detrending — l'edge dépend de la tendance, d'où le filtre de régime.`));
}

/* --------------------------------------------------------- position ouverte */

function renderPositions() {
  const s = state.snapshot;
  const box = $('#positions'); box.textContent = '';
  $('#positionSub').textContent = s.positions.length
    ? `${s.positions.length} position${s.positions.length > 1 ? 's' : ''} chez IG`
    : 'aucune position — le bot attend un signal';

  if (!s.positions.length) {
    const c = el('div', 'card reveal');
    c.append(el('div', 'empty',
      'Aucune position ouverte. Le panneau ci-dessous montre ce que l\'algo attend pour entrer.'));
    box.append(c); reveal(); return;
  }

  const instrToAsset = {};
  for (const d of (s.diagnostics || [])) instrToAsset[d.asset] = d;

  for (const p of s.positions) {
    const c = el('div', 'card position reveal');
    const head = el('div', 'pos-head');
    const long = (p.units || 0) > 0;
    head.append(el('span', 'name', (p.instrument || '').includes('GOLD') ? 'Or (XAU/USD)' : 'Argent (XAG/USD)'));
    head.append(el('span', 'chip ' + (long ? 'on' : 'bad'), long ? 'ACHAT' : 'VENTE'));
    head.append(el('span', 'chip', `${nf(Math.abs(p.units), 2)} oz`));
    const pnl = el('span', 'pnl ' + sgn(p.unrealized_pnl),
      `${(p.unrealized_pnl || 0) >= 0 ? '+' : ''}${nf(p.unrealized_pnl)} $`);
    head.append(pnl);
    c.append(head);

    const pr = p.progress || {};
    if (pr.entry && pr.sl && pr.tp) {
      const lo = Math.min(pr.sl, pr.tp), hi = Math.max(pr.sl, pr.tp);
      const at = (v) => 100 * (v - lo) / (hi - lo);
      const rail = el('div', 'rail');
      const track = el('div', 'track');
      const fill = el('div', 'fill');
      fill.style.width = Math.max(0, Math.min(100, at(pr.price))) + '%';
      track.append(fill); rail.append(track);
      for (const [v, cls, lbl] of [[pr.sl, '', 'SL ' + nf(pr.sl, 2)],
                                   [pr.entry, 'entry', 'entrée ' + nf(pr.entry, 2)],
                                   [pr.tp, '', 'TP ' + nf(pr.tp, 2)]]) {
        const t = el('div', 'tick ' + cls); t.style.left = at(v) + '%'; rail.append(t);
        const l = el('div', 'lbl', lbl); l.style.left = at(v) + '%';
        if (at(v) < 12) l.style.transform = 'translateX(0)';
        if (at(v) > 88) l.style.transform = 'translateX(-100%)';
        rail.append(l);
      }
      const cur = el('div', 'cursor'); cur.style.left = Math.max(0, Math.min(100, at(pr.price))) + '%';
      rail.append(cur);
      c.append(rail);
    }

    const kv = el('div', 'kv');
    const add = (k, v, cls) => { const d = el('div'); d.append(el('span', 'k', k), el('span', 'v' + (cls ? ' ' + cls : ''), v)); kv.append(d); };
    add('Entrée', nf(p.avg_price, 2));
    add('Prix actuel', nf(pr.price, 2));
    add('Stop', nf(p.sl, 2), 'neg');
    add('Objectif', nf(p.tp, 2), 'pos');
    add('Résultat courant', `${(pr.r_now || 0) >= 0 ? '+' : ''}${nf(pr.r_now, 2)} R`, sgn(pr.r_now));
    add('Objectif', `${nf(pr.r_target, 2)} R`);
    if (p.sl && p.avg_price) {
      const risk = Math.abs(p.avg_price - p.sl) * Math.abs(p.units);
      add('Risque', `${money(risk)} (${nf(100 * risk / (s.equity || 1), 2)} %)`);
    }
    add('Identifiant', p.trade_id || '—');
    c.append(kv);
    box.append(c);
  }
  reveal();
}

/* ------------------------------------------------------------- décision */

function renderSignals() {
  const box = $('#signals'); box.textContent = '';
  const ds = state.snapshot.diagnostics || [];
  if (!ds.length) { box.append(el('div', 'empty', 'aucun diagnostic')); return; }

  for (const d of ds) {
    const c = el('div', 'card reveal');
    const top = el('div', 'top');
    top.append(el('span', 'n', d.asset === 'XAUUSD' ? 'Or (XAU/USD)' : d.asset === 'XAGUSD' ? 'Argent (XAG/USD)' : d.asset));
    if (d.error) { top.append(el('span', 'p', d.error)); c.append(top); box.append(c); continue; }
    top.append(el('span', 'p', nf(d.price, dec(d.asset))));
    c.append(top);

    const will = d.signal > 0 && d.regime?.allowed;
    c.append(el('span', 'chip ' + (will ? 'on' : d.signal > 0 ? 'warn' : ''),
      will ? 'entrée imminente' : d.signal > 0 ? 'signal bloqué par le régime' : 'en attente'));

    if (d.breakout_level != null && d.distance_pct != null) {
      const span = 3.0;
      const done = Math.max(0, Math.min(1, (span - d.distance_pct) / span)) * 100;
      const m = el('div', 'meter');
      const t = el('div', 't'), i = el('i');
      i.style.width = done.toFixed(1) + '%';
      if (d.distance_pct <= 0) i.style.background = 'var(--good)';
      t.append(i); m.append(t);
      const cc = el('div', 'c');
      cc.append(el('span', null, `seuil ${nf(d.breakout_level, dec(d.asset))}`));
      cc.append(el('span', null, d.distance_pct <= 0 ? '✓ franchi' : `manque ${nf(d.distance_pct, 2)} %`));
      m.append(cc); c.append(m);
    }

    const ck = el('div', 'checks');
    const add = (label, ok, v) => {
      const r = el('div', 'check');
      r.append(el('span', 'd ' + (ok ? 'on' : 'off')), el('span', null, label), el('span', 'v', v));
      ck.append(r);
    };
    add('Cassure franchie', d.signal > 0, d.signal > 0 ? 'oui' : 'non');
    add('Prix au-dessus de l\'EMA', !!d.trend_ok, d.trend_ema != null ? nf(d.trend_ema, dec(d.asset)) : '—');
    if (d.regime) {
      add('Pente de tendance', d.regime.slope_pct > 0, pct(d.regime.slope_pct, 2));
      add(`Mouvement directionnel (≥ ${nf(d.regime.er_min, 2)})`,
        d.regime.er_value >= d.regime.er_min, nf(d.regime.er_value, 3));
    }
    c.append(ck);

    if (d.range_recent) {
      c.append(el('div', 'note',
        `Volatilité récente : ${nf(d.range_recent.amplitude_pct, 1)} % d'amplitude sur ~4 jours `
        + `(${nf(d.range_recent.low, dec(d.asset))} – ${nf(d.range_recent.high, dec(d.asset))}). `
        + `Une forte amplitude sans direction ne déclenche rien : c'est le filtre anti-chop.`));
    }
    if (d.next_order && d.next_order.units > 0) {
      c.append(el('div', 'note',
        `Prochain ordre : ${nf(d.next_order.units, 2)} u · risque ${money(d.next_order.risk_amount)} `
        + `(${nf(d.next_order.risk_pct, 0)} %) · SL ${nf(d.next_order.sl_price, 2)} / TP ${nf(d.next_order.tp_price, 2)}`));
    }
    box.append(c);
  }
  reveal();
}

/* --------------------------------------------------------------- chart prix */

function baseOpts(h) {
  return {
    height: h,
    layout: { background: { color: 'transparent' }, textColor: css('--ink-3'), fontFamily: css('--mono') || 'monospace', fontSize: 10 },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
    rightPriceScale: { borderColor: css('--axis'), scaleMargins: { top: 0.12, bottom: 0.12 } },
    timeScale: { borderColor: css('--axis'), timeVisible: true, secondsVisible: false, minBarSpacing: 0.04 },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    localization: { locale: 'fr-FR' },
  };
}

function dispose(k) {
  const c = state.charts[k];
  if (c) { try { c.remove(); } catch (_) { } }
  delete state.charts[k];
}

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
  let l = [];
  if (state.source !== 'live') l = l.concat(t.backtest);
  if (state.source !== 'backtest') l = l.concat(t.live);
  return l;
}

function renderPriceChart() {
  const p = state.candles[state.asset], host = $('#priceChart');
  dispose('price'); state.priceLines = []; host.textContent = '';
  if (!p || !p.candles.length) { host.append(el('div', 'empty', 'aucune bougie')); return; }

  const chart = LWC.createChart(host, baseOpts(host.clientHeight || 470));
  state.charts.price = chart;
  const s = chart.addCandlestickSeries({
    upColor: css('--good'), downColor: css('--critical'),
    wickUpColor: css('--good'), wickDownColor: css('--critical'), borderVisible: false,
    priceFormat: { type: 'price', precision: dec(state.asset), minMove: state.asset === 'XAGUSD' ? 0.001 : 0.01 },
  });
  const data = p.candles
    .filter(r => r.every(v => v != null && Number.isFinite(v)))
    .map(([t, o, h, l, c]) => ({ time: t, open: o, high: h, low: l, close: c }));
  s.setData(data); state.series.price = s;

  const times = data.map(d => d.time), first = times[0], last = times[times.length - 1];
  const marks = [];
  for (const tr of visibleTrades()) {
    if (tr.asset !== state.asset) continue;
    if (tr.entry_time >= first && tr.entry_time <= last) {
      marks.push({
        time: snapTime(tr.entry_time, times), position: 'belowBar', color: css('--good'),
        shape: tr.side > 0 ? 'arrowUp' : 'arrowDown', id: tr.id + ':in',
        _text: (tr.source === 'live' ? '● ' : '') + (tr.side > 0 ? 'Achat' : 'Vente'),
      });
    }
    if (tr.exit_time && tr.exit_time >= first && tr.exit_time <= last) {
      const win = (tr.r_multiple ?? tr.pnl ?? 0) > 0;
      marks.push({
        time: snapTime(tr.exit_time, times), position: 'aboveBar',
        color: win ? css('--s1') : css('--critical'),
        shape: tr.side > 0 ? 'arrowDown' : 'arrowUp', id: tr.id + ':out',
        _text: tr.r_multiple != null ? `${tr.r_multiple > 0 ? '+' : ''}${tr.r_multiple.toFixed(1)}R` : 'sortie',
      });
    }
  }
  marks.sort((a, b) => a.time - b.time);
  state.allMarkers = marks;
  refreshMarkers();
  chart.timeScale().subscribeVisibleTimeRangeChange(debounce(refreshMarkers, 120));

  applyRange();
  highlightTrade(state.selectedTrade, false);
  $('#chartNote').textContent =
    `${p.candles.length} bougies ${p.timeframe} · ${marks.length} marqueurs · `
    + `${p.n_history} historiques + ${p.n_fresh} fraîches (${p.origin === 'ig' ? 'IG' : 'cache du bot'}) · `
    + `zoome pour faire apparaître les étiquettes`;
}

const MAX_LABELS = 24;
function refreshMarkers() {
  const s = state.series.price, c = state.charts.price;
  if (!s || !c) return;
  const all = state.allMarkers || [];
  let inView = all;
  try {
    const r = c.timeScale().getVisibleRange();
    if (r) inView = all.filter(m => m.time >= r.from && m.time <= r.to);
  } catch (_) { }
  const withText = inView.length <= MAX_LABELS;
  s.setMarkers(all.map(m => ({
    time: m.time, position: m.position, color: m.color, shape: m.shape, id: m.id,
    text: withText ? m._text : '',
  })));
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function applyRange() {
  const c = state.charts.price;
  if (!c) return;
  if (!state.rangeMonths) { c.timeScale().fitContent(); return; }
  const p = state.candles[state.asset];
  const last = p.candles[p.candles.length - 1][0];
  c.timeScale().setVisibleRange({ from: last - state.rangeMonths * 30 * 86400, to: last });
}

function highlightTrade(tr, zoom = true) {
  const s = state.series.price, c = state.charts.price;
  if (!s || !c) return;
  for (const pl of state.priceLines) s.removePriceLine(pl);
  state.priceLines = [];
  renderTradeDetail(tr);
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
    c.timeScale().setVisibleRange({ from: tr.entry_time - pad, to: (tr.exit_time || tr.entry_time) + pad });
  }
}

function renderTradeDetail(tr) {
  const box = $('#tradeDetail'); box.textContent = '';
  if (!tr) { box.append(el('div', 'empty', 'aucun trade sélectionné')); return; }
  const ex = (state.analytics?.excursions?.trades || []).find(x => x.id === tr.id);
  const kv = el('div', 'kv');
  const add = (k, v, cls) => { const d = el('div'); d.append(el('span', 'k', k), el('span', 'v' + (cls ? ' ' + cls : ''), v)); kv.append(d); };
  add('Actif', tr.asset === 'XAUUSD' ? 'Or' : 'Argent');
  add('Sens', tr.side > 0 ? 'Achat' : 'Vente');
  add('Entrée', `${nf(tr.entry, dec(tr.asset))}`);
  add('Sortie', tr.exit == null ? 'en cours' : nf(tr.exit, dec(tr.asset)));
  add('Stop', nf(tr.sl, dec(tr.asset)), 'neg');
  add('Objectif', nf(tr.tp, dec(tr.asset)), 'pos');
  add('Résultat', tr.r_multiple == null ? '—' : `${tr.r_multiple > 0 ? '+' : ''}${nf(tr.r_multiple, 2)} R`, sgn(tr.r_multiple));
  add('PnL', tr.pnl == null ? '—' : `${tr.pnl > 0 ? '+' : ''}${nf(tr.pnl)} $`, sgn(tr.pnl));
  add('Durée', tr.bars_held ? `${tr.bars_held} h` : '—');
  add('Motif', ({ tp: 'Objectif', sl: 'Stop', time: 'Durée max', end: 'Fin période', broker: 'Broker' })[tr.reason] || tr.reason);
  if (ex) {
    add('Pire recul (MAE)', `${nf(ex.mae, 2)} R`, 'neg');
    add('Meilleur gain (MFE)', `+${nf(ex.mfe, 2)} R`, 'pos');
  }
  box.append(kv);
  if (ex) {
    box.append(el('div', 'note', ex.win
      ? `Ce trade gagnant est descendu à ${nf(ex.mae, 2)} R avant de se retourner : un stop plus serré l'aurait tué.`
      : `Ce trade perdant avait atteint +${nf(ex.mfe, 2)} R avant de revenir. C'est le prix d'un objectif lointain.`));
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
  const tb = $('#tradesTable tbody'); tb.textContent = '';
  const closed = list.filter(t => t.pnl != null);
  const wins = closed.filter(t => t.pnl > 0).length;
  $('#tradesSub').textContent =
    `${list.length} positions · ${closed.length} clôturées · `
    + `${closed.length ? nf(100 * wins / closed.length, 1) : '—'} % gagnantes · `
    + `${state.trades.live.length} réelles, ${state.trades.backtest.length} en backtest`;

  for (const t of list.slice(0, 600)) {
    const tr = el('tr');
    if (state.selectedTrade?.id === t.id) tr.classList.add('sel');
    tr.append(el('td', 'txt', dfmt(t.entry_time)));
    const a = el('td', 'txt');
    a.append(document.createTextNode(t.asset === 'XAUUSD' ? 'Or' : 'Argent'));
    if (t.source === 'live') { const b = el('span', 'tag live', 'RÉEL'); b.style.marginLeft = '6px'; a.append(b); }
    tr.append(a);
    tr.append(el('td', null, nf(t.entry, dec(t.asset))));
    tr.append(el('td', null, t.exit == null ? 'en cours' : nf(t.exit, dec(t.asset))));
    tr.append(el('td', 'txt', ({ tp: 'Objectif', sl: 'Stop', time: 'Durée max', end: 'Fin', broker: 'Broker', 'en cours': 'En cours' })[t.reason] || t.reason));
    tr.append(el('td', null, t.bars_held ? `${t.bars_held} h` : '—'));
    tr.append(el('td', sgn(t.r_multiple), t.r_multiple == null ? '—' : `${t.r_multiple > 0 ? '+' : ''}${nf(t.r_multiple, 2)}`));
    tr.append(el('td', sgn(t.pnl), t.pnl == null ? '—' : `${t.pnl > 0 ? '+' : ''}${nf(t.pnl)}`));
    tr.onclick = () => {
      state.selectedTrade = t;
      if (t.asset !== state.asset) {
        state.asset = t.asset; syncSegs();
        loadCandles(t.asset).then(() => highlightTrade(t));
      } else highlightTrade(t);
      renderTradesTable();
    };
    tb.append(tr);
  }
}

/* -------------------------------------------------------------- performance */

function renderPerformance() {
  const bt = state.stats.backtest, m = bt.metrics || {};
  $('#perfSub').textContent =
    `${m.n_trades} trades · ${m.start?.slice(0, 10)} → ${m.end?.slice(0, 10)} · risque ${nf(100 * (bt.risk_pct || 0), 2)} %/trade`;
  $('#equitySub').textContent =
    `${money(bt.initial_equity, 0)} de départ · ${pct(100 * (m.total_return || 0), 1)} au total`
    + (bt.risk_source ? ` · risque repris de la ${bt.risk_source.split(' —')[0]}` : '');

  const eh = $('#equityChart'); dispose('equity'); eh.textContent = '';
  const ec = LWC.createChart(eh, baseOpts(eh.clientHeight || 215));
  const es = ec.addAreaSeries({
    lineColor: css('--s1'), lineWidth: 2,
    topColor: alpha(css('--s1'), 0.3), bottomColor: alpha(css('--s1'), 0),
  });
  es.setData(linePts(bt.equity, ([t, v]) => ({ time: t, value: v })));
  requestAnimationFrame(() => { try { ec.timeScale().fitContent(); } catch (_) { } });
  state.charts.equity = ec;

  const dh = $('#ddChart'); dispose('dd'); dh.textContent = '';
  const dc = LWC.createChart(dh, baseOpts(dh.clientHeight || 215));
  const ds = dc.addAreaSeries({
    lineColor: css('--div-neg'), lineWidth: 2,
    topColor: alpha(css('--div-neg'), 0), bottomColor: alpha(css('--div-neg'), 0.32),
    priceFormat: { type: 'percent' },
  });
  ds.setData(linePts(bt.drawdown, ([t, v]) => ({ time: t, value: 100 * v })));
  requestAnimationFrame(() => { try { dc.timeScale().fitContent(); } catch (_) { } });
  state.charts.dd = dc;

  renderKillConflict(bt, m);
  renderMonthly(bt.monthly);
  renderRHist();
}

function haltEpisodes(dd, killFrac) {
  const out = []; let cur = null;
  for (const [t, v] of dd) {
    if (v == null) continue;
    if (v <= -killFrac && !cur) cur = { from: t, to: t, worst: v };
    else if (cur) {
      cur.to = t; cur.worst = Math.min(cur.worst, v);
      if (v > -0.001) { out.push(cur); cur = null; }
    }
  }
  if (cur) out.push(cur);
  return out;
}

function renderKillConflict(bt, m) {
  const box = $('#ddWarn'); box.textContent = '';
  const kill = state.snapshot?.risk?.max_dd_pct;
  const maxDD = 100 * (m.max_drawdown || 0);
  if (!kill || maxDD <= kill) return;
  const eps = haltEpisodes(bt.drawdown || [], kill / 100);
  const c = el('div', 'callout');
  c.append(el('span', 'i', '⚠'));
  const b = el('div');
  b.append(el('strong', null, 'Cette courbe n\'est pas atteignable avec tes réglages.'));
  b.append(el('div', null,
    ` Le backtest descend à −${nf(maxDD, 1)} % alors que le coupe-circuit halte le bot à −${nf(kill, 0)} % — le backtest ne le simule pas.`));
  const ul = el('ul');
  ul.append(el('li', null, `${eps.length} période${eps.length > 1 ? 's' : ''} sous le seuil de halte.`));
  for (const e of eps.slice(0, 3)) {
    ul.append(el('li', null, `${dfmt(e.from, false)} → ${dfmt(e.to, false)} · pire ${nf(100 * e.worst, 1)} %`));
  }
  ul.append(el('li', null, 'Le rendement affiché suppose d\'encaisser ce drawdown sans jamais couper.'));
  b.append(ul); c.append(b); box.append(c);
}

function renderMonthly(monthly) {
  const box = $('#monthly'); box.textContent = '';
  if (!monthly?.length) { box.append(el('div', 'empty', 'pas de données')); return; }
  const years = [...new Set(monthly.map(m => m.year))].sort();
  const max = Math.max(...monthly.map(m => Math.abs(m.ret || 0))) || 0.01;
  const by = new Map(monthly.map(m => [`${m.year}-${m.month}`, m.ret]));
  const names = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const g = el('div', 'heat');
  g.style.gridTemplateColumns = '42px repeat(12, minmax(28px, 1fr)) 54px';
  g.append(el('div', 'hd2', ''));
  names.forEach(n => g.append(el('div', 'hd2', n)));
  g.append(el('div', 'hd2', 'an'));
  for (const y of years) {
    g.append(el('div', 'hd2', String(y)));
    let comp = 1;
    for (let mo = 1; mo <= 12; mo++) {
      const v = by.get(`${y}-${mo}`);
      const c = el('div', 'cell', v == null ? '' : (100 * v).toFixed(1));
      c.style.background = v == null ? 'transparent' : divColor(v, max);
      if (v != null) { comp *= (1 + v); c.title = `${y}-${String(mo).padStart(2, '0')} : ${pct(100 * v, 2)}`; }
      g.append(c);
    }
    const yr = comp - 1;
    const yc = el('div', 'cell', (100 * yr).toFixed(1));
    yc.style.background = divColor(yr, max * 3);
    yc.style.fontWeight = '650';
    g.append(yc);
  }
  box.append(g);
  $('#monthScale').style.background = 'linear-gradient(to right, var(--div-neg), var(--div-mid), var(--div-pos))';
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
  const W = 520, H = 200, pad = { l: 34, r: 8, t: 12, b: 30 };
  const bw = (W - pad.l - pad.r) / counts.length;
  const s = svgRoot(W, H);
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (H - pad.t - pad.b) * i / 4;
    s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: css('--grid'), 'stroke-width': 1 }));
    s.append(svg('text', { x: pad.l - 6, y: y + 3, 'text-anchor': 'end', fill: css('--ink-3'), 'font-size': 9 },
      String(Math.round(maxC * (1 - i / 4)))));
  }
  counts.forEach((c, i) => {
    const h = maxC ? (H - pad.t - pad.b) * c / maxC : 0;
    const x = pad.l + i * bw, y = H - pad.b - h;
    const mid = (edges[i] + Math.min(edges[i + 1], 4)) / 2;
    const r = svg('rect', { x: x + 1, y, width: Math.max(bw - 2, 1), height: h, rx: 3, fill: divColor(mid, 3) });
    r.append(svg('title', {}, `${c} trades entre ${edges[i]}R et ${edges[i + 1]}R`));
    s.append(r);
    if (c) s.append(svg('text', { x: x + bw / 2, y: y - 4, 'text-anchor': 'middle', fill: css('--ink-3'), 'font-size': 9 }, String(c)));
  });
  [0, 4, 8, counts.length - 1].forEach(i => {
    s.append(svg('text', { x: pad.l + i * bw + bw / 2, y: H - pad.b + 15, 'text-anchor': 'middle', fill: css('--ink-3'), 'font-size': 9 },
      i === counts.length - 1 ? '3R+' : `${edges[i]}R`));
  });
  s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, stroke: css('--axis'), 'stroke-width': 1 }));
  host.append(s);
  const wins = rs.filter(r => r > 0).length;
  const aw = rs.filter(r => r > 0).reduce((a, b) => a + b, 0) / (wins || 1);
  const al = rs.filter(r => r <= 0).reduce((a, b) => a + b, 0) / ((rs.length - wins) || 1);
  $('#rNote').textContent =
    `${rs.length} trades · ${nf(100 * wins / rs.length, 1)} % gagnants · gain moyen ${nf(aw, 2)}R · `
    + `perte moyenne ${nf(al, 2)}R · espérance ${nf(rs.reduce((a, b) => a + b, 0) / rs.length, 3)}R par trade`;
}

/* ------------------------------------------------------------ comportement */

function renderBehaviour() {
  const a = state.analytics || {};
  renderExcursions(a.excursions);
  renderStreaks(a.streaks);
  renderRolling(a.rolling_expectancy);
  renderByDay(a.time?.by_weekday);
}

function renderExcursions(ex) {
  const box = $('#excursions'); box.textContent = '';
  if (!ex?.trades?.length) { box.append(el('div', 'empty', 'pas de données')); return; }

  const W = 520, H = 210, pad = { l: 38, r: 10, t: 12, b: 32 };
  const xs = ex.trades.map(t => t.mae), ys = ex.trades.map(t => t.r ?? 0);
  const xMin = Math.min(-1.2, ...xs), xMax = 0;
  const yMin = Math.min(-1.5, ...ys), yMax = Math.max(3.5, ...ys);
  const X = (v) => pad.l + (v - xMin) / (xMax - xMin) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v - yMin) / (yMax - yMin) * (H - pad.t - pad.b);
  const s = svgRoot(W, H);
  for (const gy of [0, 1, 2, 3]) {
    if (gy < yMin || gy > yMax) continue;
    s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: Y(gy), y2: Y(gy), stroke: css('--grid'), 'stroke-width': 1 }));
    s.append(svg('text', { x: pad.l - 6, y: Y(gy) + 3, 'text-anchor': 'end', fill: css('--ink-3'), 'font-size': 9 }, `${gy}R`));
  }
  // ligne du stop : à gauche de -1R, le trade aurait été stoppé
  s.append(svg('line', { x1: X(-1), x2: X(-1), y1: pad.t, y2: H - pad.b, stroke: css('--critical'), 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  s.append(svg('text', { x: X(-1) + 4, y: pad.t + 9, fill: css('--critical-text'), 'font-size': 9 }, 'stop −1R'));
  for (const t of ex.trades) {
    const c = svg('circle', {
      cx: X(t.mae), cy: Y(t.r ?? 0), r: 2.6,
      fill: t.win ? alpha(css('--s1'), 0.75) : alpha(css('--critical'), 0.6),
    });
    c.append(svg('title', {}, `${t.win ? 'gagnant' : 'perdant'} — recul ${t.mae}R, résultat ${t.r}R`));
    s.append(c);
  }
  for (const gx of [-1.5, -1, -0.5, 0]) {
    if (gx < xMin) continue;
    s.append(svg('text', { x: X(gx), y: H - pad.b + 15, 'text-anchor': 'middle', fill: css('--ink-3'), 'font-size': 9 }, `${gx}R`));
  }
  s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, stroke: css('--axis'), 'stroke-width': 1 }));
  box.append(s);

  const leg = el('div', 'legend');
  leg.append(mkKey(css('--s1'), 'gagnants'), mkKey(css('--critical'), 'perdants'),
    el('span', 'key dim', '— axe horizontal : pire recul atteint · vertical : résultat final'));
  box.append(leg);

  box.append(el('div', 'note',
    `Recul médian des gagnants : ${nf(ex.median_mae_winners, 2)} R. `
    + `${nf(ex.winners_deep_underwater_pct, 0)} % des gagnants sont passés sous −0,5 R avant de se retourner — `
    + `resserrer le stop les supprimerait. À l'inverse, ${nf(ex.losers_were_ahead_1r_pct, 0)} % des perdants `
    + `avaient déjà atteint +1 R : c'est le coût d'un objectif à 3 R.`));
}

function mkKey(color, label) {
  const k = el('span', 'key');
  const sw = el('span', 'sw'); sw.style.background = color;
  k.append(sw, document.createTextNode(label));
  return k;
}

function renderStreaks(st) {
  const box = $('#streaks'); box.textContent = '';
  if (!st?.hist_losses?.length) { box.append(el('div', 'empty', 'pas de données')); return; }
  const limit = state.snapshot?.risk?.max_consecutive_losses;
  const data = st.hist_losses;
  const maxC = Math.max(...data.map(d => d.count));
  const W = 520, H = 200, pad = { l: 34, r: 10, t: 12, b: 34 };
  const bw = (W - pad.l - pad.r) / data.length;
  const s = svgRoot(W, H);
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (H - pad.t - pad.b) * i / 4;
    s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: css('--grid'), 'stroke-width': 1 }));
    s.append(svg('text', { x: pad.l - 6, y: y + 3, 'text-anchor': 'end', fill: css('--ink-3'), 'font-size': 9 },
      String(Math.round(maxC * (1 - i / 4)))));
  }
  data.forEach((d, i) => {
    const h = (H - pad.t - pad.b) * d.count / maxC;
    const x = pad.l + i * bw, y = H - pad.b - h;
    const over = limit && d.len >= limit;
    const r = svg('rect', {
      x: x + 1, y, width: Math.max(bw - 2, 1), height: h, rx: 3,
      fill: over ? css('--critical') : alpha(css('--steel'), 0.55),
    });
    r.append(svg('title', {}, `${d.count} séries de ${d.len} pertes consécutives`));
    s.append(r);
    s.append(svg('text', { x: x + bw / 2, y: H - pad.b + 15, 'text-anchor': 'middle', fill: css('--ink-3'), 'font-size': 9 }, String(d.len)));
    if (d.count) s.append(svg('text', { x: x + bw / 2, y: y - 4, 'text-anchor': 'middle', fill: css('--ink-3'), 'font-size': 9 }, String(d.count)));
  });
  s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, stroke: css('--axis'), 'stroke-width': 1 }));
  s.append(svg('text', { x: (W) / 2, y: H - 3, 'text-anchor': 'middle', fill: css('--ink-3'), 'font-size': 9 }, 'longueur de la série (pertes consécutives)'));
  box.append(s);

  const over = limit ? data.filter(d => d.len >= limit).reduce((a, d) => a + d.count, 0) : 0;
  box.append(el('div', 'note',
    `Pire série observée : ${st.max_losses} pertes d'affilée (moyenne ${nf(st.avg_losses, 1)}). `
    + (limit ? (over
      ? `Les barres rouges atteignent ou dépassent le seuil de halte de ${limit}.`
      : `Aucune n'atteint le seuil de halte de ${limit}.`) : '')));
  if (limit && over) {
    const c = el('div', 'callout');
    c.append(el('span', 'i', '⚠'));
    const d = el('div');
    d.append(el('strong', null,
      `${over} série${over > 1 ? 's' : ''} de pertes atteint le seuil de halte de ${limit}.`));
    d.append(el('div', null,
      ` Le bot se serait arrêté à chaque fois et n'aurait pas repris sans intervention : `
      + `le backtest, lui, continue de trader. La courbe d'equity suppose donc qu'on ne coupe jamais.`));
    c.append(d); box.append(c);
  }
}

function renderRolling(pts) {
  const host = $('#rollChart'); dispose('roll'); host.textContent = '';
  if (!pts?.length) { host.append(el('div', 'empty', 'pas assez de trades')); return; }
  const c = LWC.createChart(host, baseOpts(host.clientHeight || 190));
  // ligne simple + repère à zéro : la série « baseline » de la lib lève
  // « Value is null » au rendu sur ce jeu de données.
  const s = c.addLineSeries({ color: css('--s1'), lineWidth: 2, priceLineVisible: false });
  s.setData(linePts(pts, ([t, v]) => ({ time: t, value: v })));
  s.createPriceLine({
    price: 0, color: css('--axis'), lineWidth: 1,
    lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: 'équilibre',
  });
  requestAnimationFrame(() => { try { c.timeScale().fitContent(); } catch (_) { } });
  state.charts.roll = c;
}

function renderByDay(rows) {
  const box = $('#byDay'); box.textContent = '';
  if (!rows?.length) { box.append(el('div', 'empty', 'pas de données')); return; }
  const names = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const max = Math.max(...rows.map(r => Math.abs(r.mean_r)));
  const t = el('table'), tb = el('tbody');
  const th = el('thead');
  const hr = el('tr');
  ['Jour', 'Trades', 'Réussite', 'Espérance'].forEach(h => { const e = el('th', null, h); e.style.cursor = 'default'; hr.append(e); });
  th.append(hr); t.append(th);
  for (const r of rows) {
    const tr = el('tr'); tr.style.cursor = 'default';
    tr.append(el('td', 'txt', names[r.k] || String(r.k)));
    tr.append(el('td', null, String(r.n)));
    tr.append(el('td', null, `${nf(100 * r.win_rate, 0)} %`));
    const td = el('td', null, `${r.mean_r > 0 ? '+' : ''}${nf(r.mean_r, 3)} R`);
    td.style.background = divColor(r.mean_r, max);
    td.style.borderRadius = '4px';
    tr.append(td);
    tb.append(tr);
  }
  t.append(tb); box.append(t);
  box.append(el('div', 'note',
    'Peu de trades par case : ces écarts sont probablement du bruit. À ne pas transformer en filtre.'));
}

/* -------------------------------------------------------------- Monte-Carlo */

function renderMonteCarlo() {
  const mc = state.analytics?.monte_carlo;
  const host = $('#mcChart'), stats = $('#mcStats'), leg = $('#mcLegend');
  host.textContent = ''; stats.textContent = ''; leg.textContent = '';
  if (!mc?.bands) { host.append(el('div', 'empty', 'pas assez de trades')); return; }

  $('#mcSub').textContent =
    `${mc.paths.toLocaleString('fr-FR')} trajectoires · ${mc.horizon_trades} trades projetés `
    + `(~12 mois au rythme observé) · risque ${nf(100 * mc.risk_pct, 0)} %/trade`;

  const b = mc.bands, n = b.p50.length;
  // viewBox large : la hauteur rendue découle de la largeur de la carte,
  // un ratio trop carré donnerait un graphique démesurément haut.
  const W = 1000, H = 260, pad = { l: 52, r: 14, t: 16, b: 28 };
  const all = [...b.p5, ...b.p95];
  const yMin = Math.min(...all), yMax = Math.max(...all);
  const X = (i) => pad.l + i / (n - 1) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v - yMin) / (yMax - yMin || 1) * (H - pad.t - pad.b);
  const s = svgRoot(W, H);

  const band = (lo, hi, op) => {
    const d = lo.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')
      + hi.map((v, i) => `L${X(hi.length - 1 - i).toFixed(1)},${Y(hi[hi.length - 1 - i]).toFixed(1)}`).join('') + 'Z';
    s.append(svg('path', { d, fill: alpha(css('--s1'), op), stroke: 'none' }));
  };
  band(b.p5, b.p95, 0.13);
  band(b.p25, b.p75, 0.22);

  // zéro : la frontière entre gagner et perdre
  if (yMin < 0 && yMax > 0) {
    s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0), stroke: css('--axis'), 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  }
  s.append(svg('path', {
    d: b.p50.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(''),
    fill: 'none', stroke: css('--s1'), 'stroke-width': 2,
  }));
  for (const q of [yMin, 0, yMax]) {
    if (!Number.isFinite(q)) continue;
    s.append(svg('text', { x: pad.l - 6, y: Y(q) + 3, 'text-anchor': 'end', fill: css('--ink-3'), 'font-size': 9 },
      `${(100 * q).toFixed(0)} %`));
  }
  s.append(svg('text', { x: W - pad.r, y: H - 6, 'text-anchor': 'end', fill: css('--ink-3'), 'font-size': 9 },
    `${mc.horizon_trades} trades`));
  host.append(s);

  leg.append(mkKey(css('--s1'), 'médiane'),
    el('span', 'key dim', 'bandes : 25–75 % et 5–95 % des trajectoires'));

  const kv = el('div', 'kv');
  const add = (k, v, cls) => { const d = el('div'); d.append(el('span', 'k', k), el('span', 'v' + (cls ? ' ' + cls : ''), v)); kv.append(d); };
  add('Médiane', pct(mc.final_pct.p50, 1), sgn(mc.final_pct.p50));
  add('Scénario bas (5 %)', pct(mc.final_pct.p5, 1), sgn(mc.final_pct.p5));
  add('Scénario haut (95 %)', pct(mc.final_pct.p95, 1), sgn(mc.final_pct.p95));
  add('Drawdown médian', `${nf(mc.max_dd_pct.p50, 1)} %`, 'neg');
  add('Drawdown sévère (5 %)', `${nf(mc.max_dd_pct.p5, 1)} %`, 'neg');
  add('Proba de finir négatif', `${nf(100 * mc.prob_negative, 1)} %`);
  stats.append(kv);

  const kill = state.snapshot?.risk?.max_dd_pct;
  if (kill && mc.prob_dd_over_20 != null) {
    const c = el('div', 'callout warn');
    c.append(el('span', 'i', '⚠'));
    const d = el('div');
    d.append(el('strong', null, `${nf(100 * mc.prob_dd_over_20, 0)} % des trajectoires dépassent −20 % de drawdown.`));
    d.append(el('div', null,
      ` Ton coupe-circuit halte le bot à −${nf(kill, 0)} %. Sur cet horizon, l'arrêt est donc le scénario le plus probable, pas l'exception.`));
    c.append(d);
    stats.append(c);
  }
  stats.append(el('div', 'note',
    'Hypothèse assumée et fausse en toute rigueur : trades indépendants, tirés de la même loi. '
    + 'La simulation ignore les changements de régime de marché — précisément le risque principal.'));
}

/* ------------------------------------------------------------------- macro */

function renderMacro() {
  const m = state.macro;
  renderCorr(m);
  const host = $('#macroChart'), leg = $('#macroLegend');
  dispose('macro'); host.textContent = ''; leg.textContent = '';
  if (!m.series || !Object.keys(m.series).length) { host.append(el('div', 'empty', 'pas de données')); return; }
  const opts = baseOpts(host.clientHeight || 235);
  opts.rightPriceScale = { ...opts.rightPriceScale, mode: LWC.PriceScaleMode.Logarithmic };
  const c = LWC.createChart(host, opts);
  state.charts.macro = c;
  const pal = ['--s1', '--s2', '--s3', '--s4', '--s5'];
  const labels = m.labels || {};
  Object.keys(m.series).forEach((sym, i) => {
    const pts = m.series[sym];
    if (!pts?.length) return;
    const base = pts.find(p => p[1])?.[1] || 1;
    const s = c.addLineSeries({ color: css(pal[i % pal.length]), lineWidth: 2, priceLineVisible: false, title: labels[sym] || sym });
    s.setData(linePts(pts, ([t, v]) => ({ time: t, value: 100 * v / base })));
    const k = el('span', 'key');
    const sw = el('span', 'sw line'); sw.style.background = css(pal[i % pal.length]);
    k.append(sw, document.createTextNode(labels[sym] || sym));
    leg.append(k);
  });
  requestAnimationFrame(() => { try { c.timeScale().fitContent(); } catch (_) { } });
  leg.append(el('span', 'key dim', '— base 100 au 1ᵉʳ janvier 2019'));
  if (m.live_ratio) leg.append(el('span', 'key au', `ratio or/argent : ${nf(m.live_ratio, 1)}`));
}

function renderCorr(m) {
  const box = $('#corr'); box.textContent = '';
  const c = m.correlation;
  if (!c?.symbols?.length) { box.append(el('div', 'empty', 'pas de corrélations')); return; }
  const short = { XAUUSD: 'Or', XAGUSD: 'Arg', USA500IDXUSD: 'S&P', LIGHTCMDUSD: 'WTI', BTCUSD: 'BTC' };
  const n = c.symbols.length;
  const g = el('div', 'heat');
  g.style.gridTemplateColumns = `48px repeat(${n}, minmax(36px, 1fr))`;
  g.append(el('div', 'hd2', ''));
  c.symbols.forEach(s => g.append(el('div', 'hd2', short[s] || s)));
  c.matrix.forEach((row, i) => {
    g.append(el('div', 'hd2', short[c.symbols[i]] || c.symbols[i]));
    row.forEach((v, j) => {
      const cell = el('div', 'cell', v == null ? '' : v.toFixed(2));
      cell.style.background = i === j ? 'var(--div-mid)' : divColor(v, 1);
      cell.title = `${short[c.symbols[i]]} vs ${short[c.symbols[j]]} : ${v}`;
      g.append(cell);
    });
  });
  box.append(g);
  box.append(el('div', 'note', c.note || ''));
}

/* ----------------------------------------------------------------- journal */

function renderJournal() {
  const box = $('#journalLog'); box.textContent = '';
  if (!state.journal.length) { box.append(el('div', 'empty', 'journal vide')); return; }
  const lbl = {
    cycle: 'cycle', order: 'ordre', trade_closed: 'clôture', reject: 'rejet', error: 'erreur',
    regime: 'régime', decision: 'décision', slippage: 'slippage', killswitch: 'kill',
    flatten: 'flatten', reconcile_adopted: 'adoption',
  };
  for (const e of state.journal) {
    const r = el('div', 'ev');
    r.append(el('span', 'ts', (e.ts || '').replace('T', ' ').replace('+00:00', '')));
    const ty = el('span', 'ty', lbl[e.type] || e.type);
    if (['order', 'trade_closed', 'flatten'].includes(e.type)) ty.style.color = 'var(--gold)';
    if (['error', 'killswitch'].includes(e.type)) ty.style.color = 'var(--critical-text)';
    r.append(ty);
    const { ts, type, ...rest } = e;
    r.append(el('span', 'ms', Object.entries(rest).map(([k, v]) => `${k}=${v}`).join('  ')));
    box.append(r);
  }
}

/* ------------------------------------------------------------ interactions */

function syncSegs() {
  $$('#assetSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.asset === state.asset)));
  $$('#sourceSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.src === state.source)));
  $$('#rangeSeg button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === state.rangeMonths)));
}

function buildAssetSeg() {
  const seg = $('#assetSeg'); seg.textContent = '';
  const names = { XAUUSD: 'Or', XAGUSD: 'Argent' };
  for (const d of (state.snapshot.diagnostics || [])) {
    const b = el('button', null, names[d.asset] || d.asset);
    b.dataset.asset = d.asset;
    b.onclick = async () => { state.asset = d.asset; syncSegs(); await loadCandles(d.asset); };
    seg.append(b);
  }
  syncSegs();
}

let revealObserver = null;
function reveal() {
  if (REDUCED) { $$('.reveal').forEach(n => n.classList.add('in')); return; }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -40px 0px' });
  }
  $$('.reveal:not(.in)').forEach(n => revealObserver.observe(n));
}

function watchTheme() {
  const redraw = debounce(() => {
    if (!state.snapshot) return;
    renderPriceChart(); renderPerformance(); renderBehaviour(); renderMonteCarlo(); renderMacro();
  }, 90);
  new MutationObserver(redraw).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', redraw);
}

function watchScroll() {
  const links = $$('nav.sections a');
  const secs = links.map(a => $(a.getAttribute('href'))).filter(Boolean);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    }
  }, { rootMargin: '-120px 0px -65% 0px' });
  secs.forEach(s => io.observe(s));
}

function wire() {
  $('#refreshBtn').onclick = () => { state.candles = {}; loadAll(); };
  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gs-theme', next); } catch (_) { }
  };
  $$('#sourceSeg button').forEach(b => {
    b.onclick = () => { state.source = b.dataset.src; syncSegs(); renderPriceChart(); renderTradesTable(); renderRHist(); };
  });
  $$('#rangeSeg button').forEach(b => {
    b.onclick = () => { state.rangeMonths = Number(b.dataset.range); syncSegs(); applyRange(); };
  });
  $('#fitBtn').onclick = () => {
    state.selectedTrade = null; state.rangeMonths = 0; syncSegs();
    highlightTrade(null); applyRange(); renderTradesTable();
  };
  $$('#tradesTable th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      if (!k) return;
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
}

/* ------------------------------------------------------------------ départ */

(async function main() {
  if (!document.documentElement.hasAttribute('data-theme')) {
    let saved = null;
    try { saved = localStorage.getItem('gs-theme'); } catch (_) { }
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }
  watchTheme(); wire();
  await loadAll();
  buildAssetSeg(); reveal(); watchScroll();
  if (OFFLINE()) {
    $('#refreshBtn').hidden = true;
    $('#killBtn').hidden = true;
    const c = $('#connChip');
    c.textContent = 'instantané';
    c.className = 'chip warn';
  } else {
    setInterval(loadAll, 60000);
  }
})();
