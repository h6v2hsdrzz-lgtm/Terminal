/* ════════════════════════════════════════════════════════════
   desk.js — orchestration du poste.

   Un état, sept vues, un rendu. Chaque changement de sélecteur
   (métal, rapport, base, fenêtre) recalcule l'état puis redessine
   la vue courante : il n'y a pas de chemin de mise à jour partielle
   à maintenir, donc pas d'écran qui affiche à moitié l'ancien métal.
   ════════════════════════════════════════════════════════════ */
'use strict';

const state = {
  metal: 'GOLD',
  report: 'disagg',
  basis: 'futures',
  lookback: 156,
  view: 'overview',
  rows: null,
  joined: [],
  spread: null,
  newsScope: 'all',
  ready: false,
};

/* ═══════════════ Utilitaires ═══════════════ */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const NBSP = ' ';

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('fr-FR').replace(/ /g, NBSP);
}

function fmtSigned(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + fmtInt(v);
}

function fmtNum(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
    .replace(/ /g, NBSP);
}

function fmtPct(v, d = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${fmtNum(v, d)}${NBSP}%`;
}

function fmtSignedPct(v, d = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + fmtPct(v, d);
}

/* notionnel : on ne lit pas « 47 382 910 000 $ », on lit « 47,4 Md$ » */
function fmtUsd(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${fmtNum(a / 1e9, 1)}${NBSP}Md$`;
  if (a >= 1e6) return `${sign}${fmtNum(a / 1e6, 0)}${NBSP}M$`;
  return `${sign}${fmtInt(a)}${NBSP}$`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `il y a ${Math.max(1, Math.floor(diff / 60000))} min`;
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function signClass(v) { return v > 0 ? 'up' : v < 0 ? 'dn' : ''; }

/* échelle du thermomètre : sert au texte et au fond de jauge */
function toneOf(score) {
  if (score >= 45) return 'hot';
  if (score >= 18) return 'warm';
  if (score > -18) return 'neutral';
  if (score > -45) return 'cool';
  return 'cold';
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return [...document.querySelectorAll(sel)]; }

function setStatus(msg, cls = '') {
  const el = $('#status-msg');
  el.textContent = msg;
  el.className = cls;
}

function toast(title, body, err = false) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.innerHTML = `<b>${escapeHtml(title)}</b>${escapeHtml(body || '')}`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 6500);
}

function openModal(title, bodyHtml, buttons) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  const box = $('#modal-btns');
  box.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = b.cls || 'm-cancel';
    el.textContent = b.label;
    el.onclick = () => { if (!b.action || b.action() !== false) closeModal(); };
    box.appendChild(el);
  }
  $('#modal-overlay').classList.remove('hidden');
  const input = $('#modal-body input');
  if (input) input.focus();
}

function closeModal() { $('#modal-overlay').classList.add('hidden'); }

/* ═══════════════ Chargement ═══════════════ */

/* Ouvrir la page par double-clic la charge en file:// — un contexte où
   le navigateur refuse tout fetch, y compris vers les fichiers voisins.
   Le poste ne peut alors rien charger. Autant le dire franchement, avec
   la commande qui règle le problème, plutôt que de tourner sans fin. */
function fileProtocolNotice() {
  const err = $('#boot-error');
  $('#boot-msg').textContent = '';
  err.classList.remove('hidden');
  err.innerHTML = `<b>Il faut servir le poste par HTTP.</b><br>
    La page est ouverte en <code>file://</code> : dans ce mode, le navigateur
    bloque toute requête réseau, y compris vers les fichiers du dossier.<br><br>
    Depuis le dossier du projet :<br>
    <code>python3 -m http.server 8000</code><br>
    puis ouvrez <b>http://localhost:8000</b>`;
}

async function boot() {
  const msg = $('#boot-msg');
  if (location.protocol === 'file:') { fileProtocolNotice(); return; }

  try {
    msg.textContent = 'Chargement des instantanés macro, prix et news…';
    const snap = await Macro.loadSnapshots();

    msg.textContent = 'Cotations spot…';
    /* le spot est un agrément, pas une dépendance : on ne laisse pas une
       API lente retenir tout le démarrage */
    await Promise.race([
      Macro.refreshSpot().catch(() => null),
      new Promise((r) => setTimeout(r, 6000)),
    ]);

    msg.textContent = 'Rapport COT de la CFTC…';
    await loadSeries();

    buildMetalTabs();
    buildPresets();
    wireEvents();
    state.ready = true;

    $('#boot').classList.add('hidden');
    $('#desk').classList.remove('hidden');
    render();

    if (snap.missing.length) {
      toast('Instantané incomplet',
        `Données absentes : ${snap.missing.join(', ')}. Le workflow « instantanés de marché » ne s'est peut-être jamais exécuté.`);
    }

    /* le spot bouge en continu, le COT une fois par semaine */
    setInterval(async () => {
      await Macro.refreshSpot().catch(() => null);
      renderSpotStrip();
    }, 60000);
  } catch (e) {
    const err = $('#boot-error');
    err.classList.remove('hidden');
    err.innerHTML = `<b>Chargement impossible.</b><br>${escapeHtml(e.message)}<br><br>
      L'API publique de la CFTC est peut-être momentanément indisponible.
      Rechargez la page dans quelques instants.`;
    msg.textContent = '';
  }
}

/* recharge la série du métal courant et recalcule tout ce qui en dépend */
async function loadSeries(force = false) {
  const { metal, report, basis } = state;
  state.rows = await CFTC.series(metal, { report, basis, force });
  recompute();
}

function recompute() {
  const key = state.report === 'legacy' ? 'noncomm' : 'money';
  const net = Metrics.series(state.rows, key, 'net');
  state.joined = Metrics.alignPrice(net, Macro.priceSeries(state.metal));
  state.spread = null;
}

/* l'écart or/argent demande les deux séries : chargé à la demande */
async function ensureSpread() {
  if (state.spread !== null) return state.spread;
  const { report, basis } = state;
  const { series } = await CFTC.multi(['GOLD', 'SILVER'], { report, basis });
  state.pair = series;
  state.spread = (series.GOLD && series.SILVER)
    ? Metrics.goldSilverSpread(series.GOLD, series.SILVER, report)
    : false;
  return state.spread;
}

/* ═══════════════ Chrome ═══════════════ */

function buildMetalTabs() {
  const nav = $('#metal-tabs');
  nav.innerHTML = Object.entries(CFTC.markets).map(([k, m]) =>
    `<button class="mt${k === state.metal ? ' on' : ''}" data-metal="${k}"
      title="${escapeHtml(m.desc)}">${escapeHtml(m.label)}</button>`).join('');
}

function renderSpotStrip() {
  const strip = $('#spot-strip');
  const parts = [];
  for (const [sym, label] of [['XAU', 'OR'], ['XAG', 'ARGENT']]) {
    const q = Macro.spot[sym];
    const fallback = Macro.prices && Macro.prices.metals[sym === 'XAU' ? 'gold' : 'silver'];
    const px = q ? q.price : (fallback ? fallback.last : null);
    const live = !!q;
    parts.push(`<div class="spot" title="${escapeHtml(live ? 'Source : ' + q.source : 'Dernier fixing LBMA')}">
      <span class="live${live ? '' : ' stale'}"></span>
      <label>${label}</label>
      <span class="px">${px == null ? '—' : fmtNum(px, 2) + '$'}</span>
    </div>`);
  }
  const ratio = (() => {
    const g = Macro.priceOf('GOLD'), s = Macro.priceOf('SILVER');
    return g && s && s.price ? g.price / s.price : null;
  })();
  parts.push(`<div class="spot" title="Ratio or / argent — onces d'argent pour une once d'or">
    <label>RATIO</label><span class="px">${ratio == null ? '—' : fmtNum(ratio, 1)}</span></div>`);
  strip.innerHTML = parts.join('');
}

function renderStamp() {
  const last = state.rows[state.rows.length - 1];
  const rel = CFTC.nextRelease(last.date);
  $('#cot-date').textContent = fmtDate(last.date);
  $('#cot-stamp').classList.toggle('late', rel.stale);
  $('#cot-stamp').title = rel.stale
    ? `Un arrêté au ${fmtDate(rel.asOf)} est attendu — la CFTC n'a pas encore publié ou le cache est ancien.`
    : `Prochaine publication : vendredi ${rel.at.toLocaleDateString('fr-FR')} vers 20 h 30 (heure de Paris)`;

  const hrs = Math.max(0, Math.floor(rel.msLeft / 3600000));
  const days = Math.floor(hrs / 24);
  $('#st-next').textContent = days >= 1
    ? `Prochain COT dans ${days} j ${hrs % 24} h`
    : `Prochain COT dans ${hrs} h`;
}

/* ═══════════════ Rendu ═══════════════ */

function render() {
  if (!state.ready) return;
  Charts.clear();
  renderSpotStrip();
  renderStamp();

  const views = {
    overview: renderOverview, cohorts: renderCohorts, history: renderHistory,
    extremes: renderExtremes, ratio: renderRatio, macro: renderMacro, news: renderNews,
  };
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const host = $(`#view-${state.view}`);
  host.classList.remove('hidden');
  views[state.view](host);

  const m = CFTC.markets[state.metal];
  setStatus(`${m.label} · ${state.report === 'legacy' ? 'rapport historique' : 'rapport détaillé'} · `
    + `${state.basis === 'combined' ? 'futures + options' : 'futures seuls'} · `
    + `${state.rows.length} arrêtés depuis ${fmtDate(state.rows[0].date)}`);
}

function marketCtx() {
  const market = CFTC.markets[state.metal];
  const price = Macro.priceOf(state.metal);
  return { market, price, px: price ? price.price : null };
}

/* ── carte chiffrée générique ── */
function statCard({ label, value, sub, cls = '', gauge }) {
  return `<div class="stat">
    <div class="stat-lb">${label}</div>
    <div class="stat-v ${cls}">${value}</div>
    ${gauge || ''}
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;
}

function gaugeHtml(pct, tone, scale = ['0', '50', '100']) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="gauge">
      <div class="gauge-fill bg-${tone}" style="width:${p.toFixed(1)}%"></div>
      <div class="gauge-mark" style="left:calc(${p.toFixed(1)}% - 1px)"></div>
    </div>
    <div class="gauge-scale"><span>${scale[0]}</span><span>${scale[1]}</span><span>${scale[2]}</span></div>`;
}

/* ═══════════════ Vue : ensemble ═══════════════ */

function renderOverview(host) {
  const { market, price, px } = marketCtx();
  const rows = state.rows;
  const last = rows[rows.length - 1];
  const cohorts = CFTC.cohortsFor(state.report);
  const specKey = state.report === 'legacy' ? 'noncomm' : 'money';
  const spec = Metrics.cohortStats(rows, specKey, market, px);
  const specDef = cohorts.find((c) => c.key === specKey);
  const tension = Metrics.tension(rows, state.report, market, state.joined);
  const regime = Macro.regime();

  const idx = spec.index[156];
  const idxTone = idx == null ? 'neutral' : idx >= 80 ? 'hot' : idx >= 60 ? 'warm' : idx <= 20 ? 'cold' : idx <= 40 ? 'cool' : 'neutral';

  /* ── cartes ── */
  const cards = `<div class="grid-4">
    ${statCard({
      label: `Prix ${market.label.toLowerCase()}`,
      value: px == null ? '—' : fmtNum(px, 2) + ' $',
      sub: price ? `${escapeHtml(price.source)}${price.live ? ' · temps réel' : ''}` : 'indisponible',
    })}
    ${statCard({
      label: `Net ${specDef.short.toLowerCase()}`,
      value: fmtSigned(spec.net),
      cls: signClass(spec.net),
      sub: `<b>${fmtSigned(spec.dNet)}</b> sur la semaine · ${fmtUsd(spec.notional)} notionnels`,
    })}
    ${statCard({
      label: 'COT index — 3 ans',
      value: idx == null ? '—' : Math.round(idx),
      cls: `tone-${idxTone}`,
      gauge: idx == null ? '' : gaugeHtml(idx, idxTone, ['plancher', '', 'sommet']),
      sub: `z = ${spec.z[260] == null ? '—' : fmtNum(spec.z[260], 2)}σ sur 5 ans`,
    })}
    ${tension ? statCard({
      label: 'Tension du positionnement',
      value: (tension.score > 0 ? '+' : '') + Math.round(tension.score),
      cls: `tone-${tension.tone} stat-v sm`,
      gauge: gaugeHtml((tension.score + 100) / 2, tension.tone, ['lessivé', 'neutre', 'tendu']),
      sub: escapeHtml(tension.verdict),
    }) : ''}
  </div>`;

  /* ── répartition des cohortes ── */
  const maxAbs = Math.max(...cohorts.map((c) => Math.abs(last.cohorts[c.key].net))) || 1;
  const bars = cohorts.map((c) => {
    const s = last.cohorts[c.key];
    const w = (Math.abs(s.net) / maxAbs) * 50;
    const left = s.net >= 0 ? 50 : 50 - w;
    return `<div class="contrib-row" title="${escapeHtml(c.desc)}">
      <div class="contrib-lb">
        <span class="co-name"><span class="co-dot" style="background:${c.color}"></span>${escapeHtml(c.short)}</span>
        <small>${fmtInt(s.long)} longs · ${fmtInt(s.short)} courts · ${fmtPct(last.oi ? (s.net / last.oi) * 100 : 0)} de l'OI</small>
      </div>
      <div style="display:flex;align-items:center;gap:9px">
        <div class="contrib-bar" style="width:150px">
          <i style="left:${left}%;width:${w}%;background:${s.net >= 0 ? 'var(--up)' : 'var(--dn)'}"></i>
          <i style="left:50%;width:1px;background:var(--border-2);height:10px;top:-3px"></i>
        </div>
        <span class="n ${signClass(s.net)}" style="width:78px;text-align:right">${fmtSigned(s.net)}</span>
      </div>
    </div>`;
  }).join('');

  /* ── graphique net / prix ── */
  const chartId = 'ov-chart';

  /* ── macro ── */
  const macroBlock = regime ? `
    <div class="panel">
      <div class="panel-hd">Régime macro
        <span class="hd-sub tone-${regime.tone}">${escapeHtml(regime.verdict)}</span>
      </div>
      <div class="panel-bd">
        ${gaugeHtml((regime.score + 100) / 2, regime.tone, ['contraire', 'neutre', 'porteur'])}
        <div class="contrib" style="margin-top:13px">
          ${regime.parts.slice(0, 5).map((p) => `
            <div class="contrib-row" title="${escapeHtml(p.why)}">
              <div class="contrib-lb">${escapeHtml(p.label)}
                <small>${fmtNum(p.last, 2)} ${escapeHtml(p.unit === 'idx' ? '' : p.unit)} · ${escapeHtml(p.detail)}</small>
              </div>
              <div class="contrib-bar">
                <i style="left:${p.value >= 0 ? 50 : 50 + p.value * 50}%;width:${Math.abs(p.value) * 50}%;
                   background:${p.value >= 0 ? 'var(--up)' : 'var(--dn)'}"></i>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="note">Chaque moteur est jugé sur sa <b>variation récente</b>, pas sur son niveau :
        ce qui déplace l'or, c'est la direction des taux réels et du dollar.</div>
    </div>` : '';

  const news = Macro.newsItems({ limit: 6 });

  host.innerHTML = `
    ${cards}
    <div class="grid-2">
      <div class="panel">
        <div class="panel-hd">Positionnement net par cohorte
          <span class="hd-sub">arrêté du ${fmtDate(last.date)}</span></div>
        <div class="panel-bd"><div class="contrib">${bars}</div></div>
        <div class="note">Le net d'une cohorte de <b>couverture</b> (producteurs, banques) ne traduit pas
          un avis de marché : c'est la contrepartie mécanique des positions spéculatives et des indices.</div>
      </div>
      ${macroBlock}
    </div>

    <div class="panel">
      <div class="panel-hd">Net ${escapeHtml(specDef.short.toLowerCase())} contre prix
        <span class="hd-sub" id="ov-hover">glissez le curseur sur le graphique</span></div>
      <div class="panel-bd flush"><div class="chart-box" id="${chartId}"></div></div>
      <div class="note" id="ov-diverge"></div>
    </div>

    <div class="panel">
      <div class="panel-hd">Actualité récente
        <span class="hd-sub">${Macro.news ? relTime(Macro.news.generated) : 'indisponible'}</span></div>
      <div class="panel-bd flush">${newsListHtml(news)}</div>
    </div>`;

  /* graphique */
  const netSeries = Metrics.tail(Metrics.series(rows, specKey, 'net'), state.lookback);
  const priceSeries = state.joined.length
    ? Metrics.tail(state.joined, state.lookback).map((p) => ({ ts: p.ts, value: p.price }))
    : [];
  Charts.timeSeries($(`#${chartId}`), [
    { label: specDef.short, color: specDef.color, data: netSeries, scale: 'left', type: 'area', width: 2 },
    ...(priceSeries.length
      ? [{ label: 'Prix', color: '#8892a0', data: priceSeries, scale: 'right', width: 1, dashed: true, precision: 2, minMove: 0.01 }]
      : []),
  ], {
    height: 300, zeroLine: true,
    onCrosshair: (info) => {
      const el = $('#ov-hover');
      if (!el) return;
      if (!info) { el.textContent = 'glissez le curseur sur le graphique'; return; }
      el.innerHTML = info.values.filter((v) => v.value != null)
        .map((v) => `${escapeHtml(v.label)} <b class="cl-val">${fmtInt(v.value)}</b>`).join(' · ');
    },
  });

  const div = state.joined.length ? Metrics.divergence(state.joined, 26) : null;
  const corr = state.joined.length ? Metrics.correlation(state.joined, 52) : null;
  $('#ov-diverge').innerHTML = div
    ? `<b>${escapeHtml(div.label)}.</b> Corrélation entre variations de position et variations de prix
       sur 52 semaines : <b>${corr == null ? '—' : fmtNum(corr, 2)}</b> —
       ${corr == null ? 'échantillon insuffisant.'
      : corr > 0.4 ? 'les fonds suivent le prix (comportement de momentum).'
        : corr < 0.1 ? 'le positionnement a décroché du marché.'
          : 'lien modéré entre flux et prix.'}`
    : 'Historique de prix indisponible — impossible de croiser positionnement et cours.';
}

/* ═══════════════ Vue : cohortes ═══════════════ */

function renderCohorts(host) {
  const { market, px } = marketCtx();
  const rows = state.rows;
  const last = rows[rows.length - 1];
  const cohorts = CFTC.cohortsFor(state.report);

  const body = cohorts.map((c) => {
    const s = Metrics.cohortStats(rows, c.key, market, px);
    const gross = s.long + s.short || 1;
    const idx = s.index[156];
    return `<tr title="${escapeHtml(c.desc)}">
      <td><span class="co-name">
        <span class="co-dot" style="background:${c.color}"></span>
        <span>${escapeHtml(c.label)}</span>
        <span class="co-role">${c.side === 'spec' ? 'spéculatif' : c.side === 'hedge' ? 'couverture' : 'retail'}</span>
      </span></td>
      <td class="n">${fmtInt(s.long)}</td>
      <td class="n">${fmtInt(s.short)}</td>
      <td class="n ${signClass(s.net)}"><b>${fmtSigned(s.net)}</b></td>
      <td class="n ${signClass(s.dNet)}">${fmtSigned(s.dNet)}</td>
      <td class="n ${signClass(s.chg4w)}">${fmtSigned(s.chg4w)}</td>
      <td class="n">${fmtPct(s.pctOi)}</td>
      <td><div class="bias" title="${fmtPct((s.long / gross) * 100, 0)} longs">
        <div class="bias-l" style="width:${((s.long / gross) * 100).toFixed(1)}%"></div>
        <div class="bias-s" style="width:${((s.short / gross) * 100).toFixed(1)}%"></div>
      </div></td>
      <td class="n">${idx == null ? '—' : Math.round(idx)}</td>
      <td class="n">${s.z[260] == null ? '—' : fmtNum(s.z[260], 2)}</td>
      <td class="n">${s.traders || '—'}</td>
      <td class="n">${s.netPerTrader == null ? '—' : fmtSigned(s.netPerTrader)}</td>
      <td class="n">${fmtUsd(s.notional)}</td>
    </tr>`;
  }).join('');

  const cards = cohorts.map((c) => {
    const s = Metrics.cohortStats(rows, c.key, market, px);
    const ext = s.extremes[0];
    return `<div class="panel">
      <div class="panel-hd">
        <span class="co-name"><span class="co-dot" style="background:${c.color}"></span>${escapeHtml(c.short)}</span>
        <span class="hd-sub n ${signClass(s.net)}">${fmtSigned(s.net)}</span>
      </div>
      <div class="panel-bd">
        <p class="legend-note" style="margin-bottom:11px">${escapeHtml(c.desc)}</p>
        <table class="tbl"><tbody>
          <tr><td style="color:var(--muted)">Record haussier</td>
              <td class="n">${fmtSigned(ext.high.value)} <span class="dim">${fmtDateShort(ext.high.date)}</span></td></tr>
          <tr><td style="color:var(--muted)">Record baissier</td>
              <td class="n">${fmtSigned(ext.low.value)} <span class="dim">${fmtDateShort(ext.low.date)}</span></td></tr>
          <tr><td style="color:var(--muted)">Percentile historique</td>
              <td class="n">${s.pct[0] == null ? '—' : fmtPct(s.pct[0], 0)}</td></tr>
          <tr><td style="color:var(--muted)">Variation 13 semaines</td>
              <td class="n ${signClass(s.chg13w)}">${fmtSigned(s.chg13w)}</td></tr>
        </tbody></table>
      </div>
    </div>`;
  }).join('');

  host.innerHTML = `
    <div class="panel">
      <div class="panel-hd">Détail par cohorte
        <span class="hd-sub">${escapeHtml(CFTC.markets[state.metal].desc)} · arrêté du ${fmtDate(last.date)}</span></div>
      <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Cohorte</th><th>Longs</th><th>Courts</th><th>Net</th>
          <th title="Variation du net sur la semaine">Δ 1 sem.</th>
          <th title="Variation du net sur 4 semaines">Δ 4 sem.</th>
          <th title="Part du net dans l'open interest total">% OI</th>
          <th title="Répartition longs / courts">Biais</th>
          <th title="Position du net dans son amplitude sur 3 ans">Index 3a</th>
          <th title="Écart à la moyenne 5 ans, en écarts-types">z 5a</th>
          <th title="Nombre d'opérateurs déclarants">Opér.</th>
          <th title="Net moyen par opérateur — mesure de concentration">Net/opér.</th>
          <th title="Valeur notionnelle du net au prix courant">Notionnel</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table></div></div>
      <div class="note">Un <b>net</b> se lit toujours avec son <b>% d'OI</b> : 130 000 contrats sur un marché
        de 380 000 n'ont pas le même poids que sur un marché de 900 000.</div>
    </div>

    <div class="panel">
      <div class="panel-hd">Concentration des plus gros opérateurs
        <span class="hd-sub">part du net détenue par les 4 et 8 premiers</span></div>
      <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Mesure</th><th>Côté long</th><th>Côté court</th></tr></thead>
        <tbody>
          <tr><td>4 plus gros — net</td><td class="n">${fmtPct(last.conc.net4Long)}</td><td class="n">${fmtPct(last.conc.net4Short)}</td></tr>
          <tr><td>8 plus gros — net</td><td class="n">${fmtPct(last.conc.net8Long)}</td><td class="n">${fmtPct(last.conc.net8Short)}</td></tr>
          <tr><td>4 plus gros — brut</td><td class="n">${fmtPct(last.conc.gross4Long)}</td><td class="n">${fmtPct(last.conc.gross4Short)}</td></tr>
          <tr><td>8 plus gros — brut</td><td class="n">${fmtPct(last.conc.gross8Long)}</td><td class="n">${fmtPct(last.conc.gross8Short)}</td></tr>
        </tbody>
      </table></div></div>
      <div class="note">Plus la concentration est forte, plus la sortie d'un seul acteur peut faire bouger le marché.
        Sur l'argent, la concentration côté court des banques est historiquement élevée — c'est un fait structurel
        du marché, pas nécessairement le signe d'une anomalie.</div>
    </div>

    <div class="grid-3">${cards}</div>`;
}

/* ═══════════════ Vue : historique ═══════════════ */

function renderHistory(host) {
  const rows = state.rows;
  const cohorts = CFTC.cohortsFor(state.report);
  const lb = state.lookback;

  host.innerHTML = `
    <div class="panel">
      <div class="panel-hd">Positions nettes par cohorte
        <span class="hd-sub" id="hs-hover">glissez le curseur pour lire les valeurs</span></div>
      <div class="chart-legend" id="hs-legend"></div>
      <div class="panel-bd flush"><div class="chart-box" id="hs-nets"></div></div>
      <div class="note">La somme des nets de toutes les cohortes est toujours nulle :
        chaque contrat long a un contrat court en face. Ce graphique montre donc un <b>transfert de risque</b>
        entre catégories d'opérateurs, pas une création de position nette.</div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-hd">Open interest<span class="hd-sub">nombre total de contrats ouverts</span></div>
        <div class="panel-bd flush"><div class="chart-box" id="hs-oi"></div></div>
      </div>
      <div class="panel">
        <div class="panel-hd">Concentration des 4 premiers<span class="hd-sub">% du net, par côté</span></div>
        <div class="panel-bd flush"><div class="chart-box" id="hs-conc"></div></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-hd">COT index du positionnement spéculatif
        <span class="hd-sub">0 = plancher de la fenêtre · 100 = sommet</span></div>
      <div class="panel-bd flush"><div class="chart-box" id="hs-idx"></div></div>
      <div class="note">Borné entre 0 et 100, l'index reste lisible quand l'open interest change d'échelle
        au fil des années — contrairement au net brut.</div>
    </div>`;

  const series = cohorts.map((c) => ({
    label: c.short, color: c.color,
    data: Metrics.tail(Metrics.series(rows, c.key, 'net'), lb),
    scale: 'left', width: 1.5,
  }));
  const priceRows = state.joined.length
    ? Metrics.tail(state.joined, lb).map((p) => ({ ts: p.ts, value: p.price })) : [];
  if (priceRows.length) {
    series.push({ label: 'Prix', color: '#8892a0', data: priceRows, scale: 'right', width: 1, dashed: true, precision: 2, minMove: 0.01 });
  }

  $('#hs-legend').innerHTML = series.map((s) =>
    `<span class="cl-item"><i class="cl-swatch" style="background:${s.color}"></i>${escapeHtml(s.label)}</span>`).join('');

  Charts.timeSeries($('#hs-nets'), series, {
    height: 360, zeroLine: true,
    onCrosshair: (info) => {
      const el = $('#hs-hover');
      if (!el) return;
      if (!info) { el.textContent = 'glissez le curseur pour lire les valeurs'; return; }
      el.innerHTML = info.values.filter((v) => v.value != null)
        .map((v) => `<span style="color:${v.color}">${escapeHtml(v.label)}</span> <b>${fmtInt(v.value)}</b>`).join(' · ');
    },
  });

  Charts.timeSeries($('#hs-oi'),
    [{ label: 'OI', color: '#6f8fb0', data: Metrics.tail(Metrics.seriesOf(rows, (r) => r.oi), lb), scale: 'left', type: 'area' }],
    { height: 200 });

  Charts.timeSeries($('#hs-conc'), [
    { label: 'Longs', color: 'var(--up)'.replace('var(--up)', '#2ebd85'), data: Metrics.tail(Metrics.seriesOf(rows, (r) => r.conc.net4Long), lb), scale: 'left', precision: 1, minMove: 0.1 },
    { label: 'Courts', color: '#f6465d', data: Metrics.tail(Metrics.seriesOf(rows, (r) => r.conc.net4Short), lb), scale: 'left', precision: 1, minMove: 0.1 },
  ], { height: 200 });

  /* index glissant sur 52 semaines */
  const specKey = state.report === 'legacy' ? 'noncomm' : 'money';
  const net = Metrics.series(rows, specKey, 'net');
  const idxSeries = [];
  for (let i = 51; i < net.length; i++) {
    const w = net.slice(i - 51, i + 1).map((p) => p.value);
    const min = Math.min(...w), max = Math.max(...w);
    idxSeries.push({ ts: net[i].ts, value: max === min ? 50 : ((net[i].value - min) / (max - min)) * 100 });
  }
  Charts.timeSeries($('#hs-idx'),
    [{ label: 'COT index 52 sem.', color: '#d9a441', data: Metrics.tail(idxSeries, lb), scale: 'left', type: 'area', precision: 0 }],
    { height: 200 });
}

/* ═══════════════ Vue : extrêmes ═══════════════ */

function renderExtremes(host) {
  const { market, px } = marketCtx();
  const rows = state.rows;
  const cohorts = CFTC.cohortsFor(state.report);
  const specKey = state.report === 'legacy' ? 'noncomm' : 'money';
  const specDef = cohorts.find((c) => c.key === specKey);
  const netSeries = Metrics.series(rows, specKey, 'net');

  const cell = (v, kind) => {
    if (v == null) return '<td class="n dim">—</td>';
    let tone = 'neutral';
    if (kind === 'idx') tone = v >= 85 ? 'hot' : v >= 65 ? 'warm' : v <= 15 ? 'cold' : v <= 35 ? 'cool' : 'neutral';
    if (kind === 'z') tone = v >= 1.8 ? 'hot' : v >= 0.9 ? 'warm' : v <= -1.8 ? 'cold' : v <= -0.9 ? 'cool' : 'neutral';
    const txt = kind === 'z' ? fmtNum(v, 2) : Math.round(v);
    return `<td class="n tone-${tone}">${txt}</td>`;
  };

  const matrix = cohorts.map((c) => {
    const s = Metrics.cohortStats(rows, c.key, market, px);
    return `<tr title="${escapeHtml(c.desc)}">
      <td><span class="co-name"><span class="co-dot" style="background:${c.color}"></span>${escapeHtml(c.short)}</span></td>
      ${cell(s.index[26], 'idx')}${cell(s.index[52], 'idx')}${cell(s.index[156], 'idx')}${cell(s.index[260], 'idx')}${cell(s.index[0], 'idx')}
      ${cell(s.z[52], 'z')}${cell(s.z[156], 'z')}${cell(s.z[260], 'z')}
      ${cell(s.pct[0], 'idx')}
    </tr>`;
  }).join('');

  const moves = Metrics.bigMoves(netSeries, 156, 2).slice(0, 10);
  const flips = Metrics.flips(netSeries, 520).slice(-8).reverse();
  const analogues = state.joined.length ? Metrics.analogues(state.joined) : null;

  host.innerHTML = `
    <div class="panel">
      <div class="panel-hd">Matrice des extrêmes
        <span class="hd-sub">position du net dans son historique, par fenêtre</span></div>
      <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Cohorte</th>
          <th title="COT index sur 26 semaines">Idx 6m</th><th>Idx 1a</th><th>Idx 3a</th><th>Idx 5a</th><th>Idx tout</th>
          <th title="Z-score sur 52 semaines">z 1a</th><th>z 3a</th><th>z 5a</th>
          <th title="Rang de percentile sur tout l'historique">Perc.</th>
        </tr></thead>
        <tbody>${matrix}</tbody>
      </table></div></div>
      <div class="note">Rouge = tendu à la hausse, bleu = lessivé. Un extrême n'est pas un signal de retournement :
        c'est une mesure d'<b>asymétrie</b> — l'indication qu'un côté du marché a peu de marge pour se charger davantage.</div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-hd">Rotations majeures — ${escapeHtml(specDef.short.toLowerCase())}
          <span class="hd-sub">semaines à plus de 2σ du mouvement habituel</span></div>
        <div class="panel-bd flush"><div class="tbl-wrap tall"><table class="tbl">
          <thead><tr><th>Arrêté</th><th>Variation du net</th><th>Ampleur</th></tr></thead>
          <tbody>${moves.length ? moves.map((m) => `<tr>
            <td>${fmtDate(m.date)}</td>
            <td class="n ${signClass(m.delta)}">${fmtSigned(m.delta)}</td>
            <td class="n">${fmtNum(m.sigma, 1)}σ</td></tr>`).join('')
    : '<tr><td colspan="3" class="dim">Aucune rotation extrême sur la période.</td></tr>'}</tbody>
        </table></div></div>
      </div>

      <div class="panel">
        <div class="panel-hd">Basculements du net
          <span class="hd-sub">passages du positif au négatif, et inversement</span></div>
        <div class="panel-bd flush"><div class="tbl-wrap tall"><table class="tbl">
          <thead><tr><th>Arrêté</th><th>Nouveau régime</th><th>Net</th></tr></thead>
          <tbody>${flips.length ? flips.map((f) => `<tr>
            <td>${fmtDate(f.date)}</td>
            <td class="${f.to === 'long' ? 'up' : 'dn'}">${f.to === 'long' ? 'net acheteur' : 'net vendeur'}</td>
            <td class="n">${fmtSigned(f.value)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="dim">Aucun basculement sur la période — le net n\'a pas changé de signe.</td></tr>'}</tbody>
        </table></div></div>
        <div class="note">Sur l'or, un managed money net vendeur est rare : c'est historiquement
          le marqueur des points bas majeurs.</div>
      </div>
    </div>

    ${analogues && analogues.summary ? `
    <div class="panel">
      <div class="panel-hd">Configurations comparables
        <span class="hd-sub">arrêtés passés au COT index proche de ${Math.round(analogues.current)} · ${analogues.sample} cas</span></div>
      <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Horizon</th><th>Médiane</th><th>Moyenne</th><th>Cas positifs</th><th>Meilleur</th><th>Pire</th><th>n</th></tr></thead>
        <tbody>${Object.entries(analogues.summary).map(([h, s]) => `<tr>
          <td>${h} semaines</td>
          <td class="n ${signClass(s.median)}">${fmtSignedPct(s.median)}</td>
          <td class="n ${signClass(s.mean)}">${fmtSignedPct(s.mean)}</td>
          <td class="n">${fmtPct(s.positive, 0)}</td>
          <td class="n up">${fmtSignedPct(s.best)}</td>
          <td class="n dn">${fmtSignedPct(s.worst)}</td>
          <td class="n dim">${s.n}</td></tr>`).join('')}</tbody>
      </table></div></div>
      <div class="note"><b>À lire avec prudence.</b> Il s'agit de statistique descriptive sur un échantillon
        de ${analogues.sample} épisodes : ce que le prix a fait après des configurations comparables, pas une prévision.
        L'échantillon est petit, les épisodes ne sont pas indépendants, et le contexte macro de chacun différait.</div>
    </div>` : ''}`;
}

/* ═══════════════ Vue : ratio ═══════════════ */

function renderRatio(host) {
  host.innerHTML = `<div class="panel"><div class="panel-bd">
    <span class="dim">Chargement des deux métaux…</span></div></div>`;

  ensureSpread().then((spread) => {
    if (state.view !== 'ratio') return;
    if (!spread) {
      host.innerHTML = `<div class="panel"><div class="panel-bd">
        <span class="dim">Données insuffisantes pour comparer les deux métaux
        sur ce rapport (${state.report === 'legacy' ? 'historique' : 'détaillé'}).</span></div></div>`;
      return;
    }

    const g = Macro.priceOf('GOLD'), s = Macro.priceOf('SILVER');
    const ratio = g && s && s.price ? g.price / s.price : null;
    const last = spread.last;

    host.innerHTML = `
      <div class="grid-3">
        ${statCard({
      label: 'Ratio or / argent',
      value: ratio == null ? '—' : fmtNum(ratio, 1),
      sub: 'onces d\'argent pour une once d\'or',
    })}
        ${statCard({
      label: 'Écart de positionnement',
      value: (last.value > 0 ? '+' : '') + Math.round(last.value),
      cls: last.value > 20 ? 'tone-warm' : last.value < -20 ? 'tone-cool' : '',
      sub: escapeHtml(spread.reading),
    })}
        ${statCard({
      label: 'Rareté de l\'écart',
      value: spread.z == null ? '—' : fmtNum(spread.z, 2) + 'σ',
      sub: spread.percentile == null ? '—' : `${fmtPct(spread.percentile, 0)} de percentile sur 3 ans`,
    })}
      </div>

      <div class="panel">
        <div class="panel-hd">Positionnement normalisé — or contre argent
          <span class="hd-sub">COT index sur 3 ans de chaque métal</span></div>
        <div class="chart-legend">
          <span class="cl-item"><i class="cl-swatch" style="background:#d9a441"></i>Or</span>
          <span class="cl-item"><i class="cl-swatch" style="background:#9fb0c0"></i>Argent</span>
          <span class="cl-item"><i class="cl-swatch" style="background:#8e7ab8"></i>Écart (or − argent)</span>
        </div>
        <div class="panel-bd flush"><div class="chart-box" id="rt-chart"></div></div>
        <div class="note">Les deux métaux sont ramenés à une échelle commune de 0 à 100 avant d'être comparés :
          un contrat d'argent porte 5 000 onces, un contrat d'or seulement 100, donc les nets bruts
          ne sont pas comparables directement. Un écart très positif signale un or nettement plus détenu
          que l'argent — configuration qui a historiquement accompagné les phases de sur-performance de l'argent.</div>
      </div>

      <div class="panel">
        <div class="panel-hd">Comparaison directe
          <span class="hd-sub">mêmes mesures, les deux métaux côte à côte</span></div>
        <div class="panel-bd flush"><div class="tbl-wrap">${pairTableHtml()}</div></div>
        <div class="note">Le <b>notionnel</b> est la seule mesure directement comparable entre les deux métaux :
          il convertit les contrats en dollars réellement engagés.</div>
      </div>`;

    const tail = Metrics.tail(spread.series, state.lookback);
    Charts.timeSeries($('#rt-chart'), [
      { label: 'Or', color: '#d9a441', data: tail.map((p) => ({ ts: p.ts, value: p.gold })), scale: 'left', precision: 0 },
      { label: 'Argent', color: '#9fb0c0', data: tail.map((p) => ({ ts: p.ts, value: p.silver })), scale: 'left', precision: 0 },
      { label: 'Écart', color: '#8e7ab8', data: tail.map((p) => ({ ts: p.ts, value: p.value })), scale: 'right', width: 1.5, precision: 0 },
    ], { height: 340 });
  }).catch((e) => {
    host.innerHTML = `<div class="panel"><div class="panel-bd">
      <span class="dn">Chargement impossible : ${escapeHtml(e.message)}</span></div></div>`;
  });
}

/* tableau comparatif or / argent : mêmes mesures, deux colonnes.
   Les nets bruts ne se comparent pas (100 oz contre 5 000 oz par
   contrat) ; le notionnel et les mesures normalisées, si. */
function pairTableHtml() {
  const key = state.report === 'legacy' ? 'noncomm' : 'money';
  const cols = ['GOLD', 'SILVER'].map((k) => {
    const rows = state.pair && state.pair[k];
    if (!rows) return null;
    return {
      k, market: CFTC.markets[k],
      s: Metrics.cohortStats(rows, key, CFTC.markets[k], (Macro.priceOf(k) || {}).price),
      last: rows[rows.length - 1],
    };
  });
  if (cols.some((c) => !c)) return '<div class="news-empty">Comparaison indisponible.</div>';

  const line = (label, pick, title = '') => `<tr${title ? ` title="${escapeHtml(title)}"` : ''}>
    <td>${escapeHtml(label)}</td>${cols.map((c) => `<td class="n">${pick(c)}</td>`).join('')}</tr>`;

  return `<table class="tbl">
    <thead><tr><th>Mesure</th>
      <th style="color:var(--gold)">Or</th><th style="color:var(--silver)">Argent</th></tr></thead>
    <tbody>
      ${line('Prix spot', (c) => { const p = Macro.priceOf(c.k); return p ? fmtNum(p.price, 2) + ' $' : '—'; })}
      ${line('Net spéculatif (contrats)', (c) => `<span class="${signClass(c.s.net)}">${fmtSigned(c.s.net)}</span>`)}
      ${line('Notionnel du net', (c) => fmtUsd(c.s.notional), 'Contrats × taille du contrat × prix spot')}
      ${line('Variation hebdomadaire', (c) => `<span class="${signClass(c.s.dNet)}">${fmtSigned(c.s.dNet)}</span>`)}
      ${line('Part de l\'open interest', (c) => fmtPct(c.s.pctOi))}
      ${line('COT index 3 ans', (c) => c.s.index[156] == null ? '—' : Math.round(c.s.index[156]))}
      ${line('Z-score 5 ans', (c) => c.s.z[260] == null ? '—' : fmtNum(c.s.z[260], 2))}
      ${line('Percentile historique', (c) => c.s.pct[0] == null ? '—' : fmtPct(c.s.pct[0], 0))}
      ${line('Open interest', (c) => fmtInt(c.last.oi))}
      ${line('Concentration 4 premiers (court)', (c) => fmtPct(c.last.conc.net4Short),
    'Part du net détenue par les quatre plus gros vendeurs')}
      ${line('Opérateurs déclarants', (c) => fmtInt(c.last.traders))}
    </tbody></table>`;
}

/* ═══════════════ Vue : macro ═══════════════ */

function renderMacro(host) {
  const regime = Macro.regime();
  if (!Macro.data) {
    host.innerHTML = `<div class="panel"><div class="panel-bd"><span class="dim">
      Instantané macro absent. Il est produit par <code>scripts/refresh_data.py</code>
      et publié dans <code>data/macro.json</code> par le workflow « instantanés de marché ».
    </span></div></div>`;
    return;
  }

  const ids = Object.keys(Macro.data.series);
  const rowsHtml = ids.map((id) => {
    const s = Macro.snapshot(id);
    if (!s) return '';
    const dir = s.sign === 0 ? '' : (s.d21 || 0) * s.sign > 0 ? 'up' : (s.d21 || 0) * s.sign < 0 ? 'dn' : '';
    const spark = Charts.sparkline(s.obs.slice(-120).map((o) => o[1]));
    return `<tr title="${escapeHtml(s.desc || '')}">
      <td>${escapeHtml(s.label)}<br><small class="dim">${escapeHtml(s.id)} · ${fmtDate(s.date)}</small></td>
      <td class="n"><b>${fmtNum(s.last, 2)}</b> <span class="dim">${escapeHtml(s.unit === 'idx' ? '' : s.unit)}</span></td>
      <td class="n">${s.d5 == null ? '—' : fmtNum(s.d5, 2)}</td>
      <td class="n">${s.d21 == null ? '—' : fmtNum(s.d21, 2)}</td>
      <td class="n">${s.d63 == null ? '—' : fmtNum(s.d63, 2)}</td>
      <td class="n">${s.d252 == null ? '—' : fmtNum(s.d252, 2)}</td>
      <td class="n">${s.range1y ? fmtPct(s.range1y.pct, 0) : '—'}</td>
      <td>${spark}</td>
      <td class="${dir}">${s.sign === 0 ? '<span class="dim">neutre</span>'
      : dir === 'up' ? 'favorable' : dir === 'dn' ? 'défavorable' : '<span class="dim">stable</span>'}</td>
    </tr>`;
  }).join('');

  const corr = [
    ['Taux réel 10 ans', 'DFII10'], ['Dollar large', 'DTWEXBGS'],
    ['Point mort 10 ans', 'T10YIE'], ['VIX', 'VIXCLS'],
    ['Spread high yield', 'BAMLH0A0HYM2'], ['Rendement 2 ans', 'DGS2'],
  ].map(([label, id]) => {
    const g = Macro.correlation('GOLD', id);
    const s = Macro.correlation('SILVER', id);
    return `<tr>
      <td>${escapeHtml(label)}</td>
      <td class="n ${g && g.r < -0.15 ? 'dn' : g && g.r > 0.15 ? 'up' : ''}">${g ? fmtNum(g.r, 2) : '—'}</td>
      <td class="n ${s && s.r < -0.15 ? 'dn' : s && s.r > 0.15 ? 'up' : ''}">${s ? fmtNum(s.r, 2) : '—'}</td>
      <td class="n dim">${g ? g.n : '—'}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    ${regime ? `<div class="panel">
      <div class="panel-hd">Régime macro pour les métaux
        <span class="hd-sub tone-${regime.tone}">${escapeHtml(regime.verdict)} · score ${(regime.score > 0 ? '+' : '') + Math.round(regime.score)}</span></div>
      <div class="panel-bd">
        ${gaugeHtml((regime.score + 100) / 2, regime.tone, ['contraire', 'neutre', 'porteur'])}
        <div class="contrib" style="margin-top:14px">
          ${regime.parts.map((p) => `<div class="contrib-row">
            <div class="contrib-lb">${escapeHtml(p.label)}<small>${escapeHtml(p.why)}</small></div>
            <div style="display:flex;align-items:center;gap:9px">
              <span class="dim n" style="font-size:10.5px">${escapeHtml(p.detail)}</span>
              <div class="contrib-bar">
                <i style="left:${p.value >= 0 ? 50 : 50 + p.value * 50}%;width:${Math.abs(p.value) * 50}%;
                   background:${p.value >= 0 ? 'var(--up)' : 'var(--dn)'}"></i>
              </div>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-hd">Séries macro
        <span class="hd-sub">Réserve fédérale de Saint-Louis (FRED) · ${relTime(Macro.data.generated)}</span></div>
      <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Série</th><th>Niveau</th><th>1 sem.</th><th>1 mois</th><th>3 mois</th><th>1 an</th>
          <th title="Position dans l'amplitude des 12 derniers mois">Range 1a</th><th>Tendance</th><th>Effet or</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div></div>
      <div class="note">Les variations sont affichées en valeur brute, sans couleur : sur ces séries,
        « en hausse » ne veut pas dire « favorable ». La seule colonne qui porte un jugement est
        <b>Effet or</b>, qui applique le sens propre à chaque moteur — une hausse du taux réel pèse sur l'or,
        une baisse du dollar le soutient.</div>
    </div>

    <div class="panel">
      <div class="panel-hd">Corrélations hebdomadaires
        <span class="hd-sub">variations sur 52 semaines · coefficient de Pearson</span></div>
      <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Série macro</th><th>Or</th><th>Argent</th><th>n</th></tr></thead>
        <tbody>${corr}</tbody>
      </table></div></div>
      <div class="note">La corrélation de l'or aux taux réels est le chiffre qui dit si le marché suit encore
        son moteur habituel. Quand elle s'effondre vers zéro alors qu'elle était nettement négative,
        c'est qu'un autre facteur a pris le dessus — achats de banques centrales, prime géopolitique, flux ETF.</div>
    </div>`;
}

/* ═══════════════ Vue : news ═══════════════ */

function newsListHtml(items) {
  if (!items.length) {
    return `<div class="news-empty">Aucune dépêche.<br>
      Le flux est rafraîchi par le workflow « instantanés de marché ».</div>`;
  }
  return `<div class="news-list">${items.map((n) => `
    <div class="news-item">
      <a class="news-t" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)}</a>
      <div class="news-m">
        <span class="news-src">${escapeHtml(n.source)}</span>
        <span>${n.published ? relTime(n.published) : ''}</span>
        <span class="news-tag${n.scope === 'metal' ? ' metal' : ''}">${n.scope === 'metal' ? 'métaux' : 'macro'}</span>
        ${(n.tags || []).slice(0, 3).map((t) => `<span class="news-tag">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>`).join('')}</div>`;
}

function renderNews(host) {
  const items = Macro.newsItems({ scope: state.newsScope, limit: 60 });
  host.innerHTML = `
    <div class="panel">
      <div class="panel-hd">
        <span>Fil d'actualité<span class="hd-sub" style="margin-left:9px">
          ${Macro.news ? `${Macro.news.items.length} dépêches · ${relTime(Macro.news.generated)}` : 'indisponible'}</span></span>
        <span class="seg" id="news-filter">
          <button data-scope="all"${state.newsScope === 'all' ? ' class="on"' : ''}>Tout</button>
          <button data-scope="metal"${state.newsScope === 'metal' ? ' class="on"' : ''}>Métaux</button>
          <button data-scope="macro"${state.newsScope === 'macro' ? ' class="on"' : ''}>Macro</button>
        </span>
      </div>
      <div class="panel-bd flush">${newsListHtml(items)}</div>
      <div class="note">Flux publics agrégés (Réserve fédérale, BCE, presse financière, Google News).
        Le classement par pertinence est une heuristique de mots-clés : l'interprétation revient à l'agent,
        onglet de droite.</div>
    </div>`;

  $$('#news-filter button').forEach((b) => {
    b.onclick = () => { state.newsScope = b.dataset.scope; render(); };
  });
}

/* ═══════════════ Agent ═══════════════ */

function buildPresets() {
  $('#agent-presets').innerHTML = Agent.presets.map((p) =>
    `<button class="ap" data-preset="${p.id}" title="${escapeHtml(p.prompt)}">
      <i>${p.icon}</i>${escapeHtml(p.label)}</button>`).join('');
}

function agentAppend(role, html) {
  const log = $('#agent-log');
  const empty = log.querySelector('.ag-empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = `ag-msg ${role}`;
  el.innerHTML = `<div class="ag-who">${role === 'user' ? 'VOUS' : 'AGENT'}</div>
    <div class="ag-bubble">${html}</div>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el.querySelector('.ag-bubble');
}

function agentBusy(on) {
  $('#agent-send').disabled = on;
  $('#agent-stop').classList.toggle('hidden', !on);
  $$('.ap').forEach((b) => { b.disabled = on; });
}

async function runAgent(question, opts = {}) {
  if (Agent.busy) return;
  if (!Agent.key) { promptForKey(); return; }

  agentAppend('user', escapeHtml(question).replace(/\n/g, '<br>'));
  const bubble = agentAppend('bot', '<div class="ag-thinking"><i></i>Analyse en cours…</div>');
  agentBusy(true);

  const ctx = Agent.buildContext({
    rows: state.rows, report: state.report, basis: state.basis,
    marketKey: state.metal, market: CFTC.markets[state.metal],
    price: Macro.priceOf(state.metal), joined: state.joined, spread: state.spread || null,
  });

  let acc = '';
  try {
    await Agent.ask(question, ctx, {
      effort: opts.effort || 'medium',
      tokens: opts.tokens || 3000,
      onThinking: (on) => {
        if (on && !acc) bubble.innerHTML = '<div class="ag-thinking"><i></i>Raisonnement…</div>';
      },
      onDelta: (_, full) => {
        acc = full;
        bubble.innerHTML = renderAgentText(full);
        $('#agent-log').scrollTop = $('#agent-log').scrollHeight;
      },
    });
    if (!acc) bubble.innerHTML = '<span class="dim">Réponse vide.</span>';
  } catch (e) {
    bubble.innerHTML = acc
      ? renderAgentText(acc) + `<div class="ag-err">${escapeHtml(e.message)}</div>`
      : `<div class="ag-err">${escapeHtml(e.message)}</div>`;
  } finally {
    agentBusy(false);
  }
}

function promptForKey() {
  openModal('Clé API Anthropic', `
    <p>L'agent d'analyse appelle l'API Anthropic <b>directement depuis votre navigateur</b>.
       La clé est enregistrée dans le stockage local de ce navigateur et n'est transmise
       à aucun serveur intermédiaire.</p>
    <input id="key-input" type="password" placeholder="sk-ant-…" autocomplete="off"
      value="${escapeHtml(Agent.key)}">
    <p class="dim" style="font-size:11px">Clé disponible sur
      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.
      Le reste du poste — COT, macro, prix, news — fonctionne sans clé.</p>`,
  [
    { label: 'Supprimer', action: () => { Agent.key = ''; updateKeyButton(); toast('Clé supprimée', 'L\'agent est désactivé.'); } },
    {
      label: 'Enregistrer', cls: 'm-primary', action: () => {
        const v = $('#key-input').value.trim();
        if (!v) return false;
        Agent.key = v;
        updateKeyButton();
        toast('Clé enregistrée', 'L\'agent est prêt.');
      },
    },
  ]);
}

function updateKeyButton() {
  const b = $('#btn-key');
  b.classList.toggle('armed', !!Agent.key);
  b.title = Agent.key ? 'Clé API enregistrée — cliquer pour modifier' : 'Aucune clé API — cliquer pour en saisir une';
}

/* ═══════════════ Événements ═══════════════ */

function wireEvents() {
  /* navigation */
  $$('.rail-item').forEach((b) => {
    b.onclick = () => {
      $$('.rail-item').forEach((x) => x.classList.toggle('on', x === b));
      state.view = b.dataset.view;
      render();
    };
  });

  /* métal */
  $('#metal-tabs').onclick = async (e) => {
    const b = e.target.closest('.mt');
    if (!b || b.dataset.metal === state.metal) return;
    state.metal = b.dataset.metal;
    buildMetalTabs();
    setStatus('Chargement…');
    try { await loadSeries(); render(); }
    catch (err) { setStatus(err.message, 'err'); toast('Chargement impossible', err.message, true); }
  };

  /* rapport / base */
  const swap = async (sel, key, attr) => {
    $$(`${sel} button`).forEach((b) => {
      b.onclick = async () => {
        if (b.classList.contains('on')) return;
        $$(`${sel} button`).forEach((x) => x.classList.toggle('on', x === b));
        state[key] = b.dataset[attr];
        setStatus('Chargement…');
        try { await loadSeries(); render(); }
        catch (err) { setStatus(err.message, 'err'); toast('Chargement impossible', err.message, true); }
      };
    });
  };
  swap('#opt-report', 'report', 'report');
  swap('#opt-basis', 'basis', 'basis');

  /* fenêtre */
  $$('#opt-lookback button').forEach((b) => {
    b.onclick = () => {
      $$('#opt-lookback button').forEach((x) => x.classList.toggle('on', x === b));
      state.lookback = parseInt(b.dataset.lb, 10);
      render();
    };
  });

  /* rafraîchir */
  $('#btn-refresh').onclick = async () => {
    setStatus('Rechargement depuis la CFTC…');
    try {
      CFTC.clearCache();
      await Macro.refreshSpot().catch(() => null);
      await loadSeries(true);
      render();
      toast('Données rechargées', 'Cache vidé, série CFTC redemandée.');
    } catch (e) { setStatus(e.message, 'err'); toast('Rechargement impossible', e.message, true); }
  };

  /* clé */
  $('#btn-key').onclick = promptForKey;
  updateKeyButton();

  /* agent */
  $('#agent-presets').onclick = (e) => {
    const b = e.target.closest('.ap');
    if (!b) return;
    const p = Agent.presets.find((x) => x.id === b.dataset.preset);
    if (p) runAgent(p.prompt, { effort: p.effort, tokens: p.tokens });
  };
  $('#agent-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#agent-input');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    runAgent(q);
  };
  $('#agent-input').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#agent-form').requestSubmit(); }
  };
  $('#agent-stop').onclick = () => Agent.stop();
  $('#agent-clear').onclick = () => {
    Agent.reset();
    $('#agent-log').innerHTML = `<div class="ag-empty">
      <p>Conversation effacée. Le contexte du poste sera réinjecté à la prochaine question.</p></div>`;
  };
  $('#agent-collapse').onclick = () => {
    $('#agent-dock').classList.add('collapsed');
    $('#agent-reopen').classList.remove('hidden');
  };
  $('#agent-reopen').onclick = () => {
    $('#agent-dock').classList.remove('collapsed');
    $('#agent-reopen').classList.add('hidden');
  };

  /* modal */
  $('#modal-x').onclick = closeModal;
  $('#modal-overlay').onclick = (e) => { if (e.target.id === 'modal-overlay') closeModal(); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-overlay').classList.contains('hidden')) closeModal();
  });
}

document.addEventListener('DOMContentLoaded', boot);
