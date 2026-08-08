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
  newsCat: 'all',
  tapeBar: '1H',
  tapeBars: 300,
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
    overview: renderOverview, gold: renderGold, shortterm: renderShortTerm,
    tape: renderTape, cohorts: renderCohorts,
    history: renderHistory, extremes: renderExtremes, ratio: renderRatio,
    macro: renderMacro, news: renderNews,
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

/* ═══════════════ Échelles de temps par graphique ═══════════════
   Chaque graphique porte sa propre barre d'échelles. Le graphique
   reçoit toujours la série entière ; les boutons ne font que déplacer
   la fenêtre visible. Conséquence pratique : changer d'échelle est
   instantané, ne relance aucun calcul, et « Tout » affiche réellement
   tout — pas ce qui restait après un découpage en amont. */

function chartFrame(id, { height = 300, ranges = CHART_RANGES_WEEKLY, active = 0, hover = '' } = {}) {
  return `<div class="ch-frame">
    <div class="ch-bar">
      <span class="ch-hover" id="${id}-hover">${hover}</span>
      <span class="ch-ranges" data-chart="${id}">${ranges.map((r) =>
    `<button class="ch-rb${r.n === active ? ' on' : ''}" data-bars="${r.n}"
       title="${r.n ? `${r.n} derniers points` : 'tout l\'historique'}">${r.t}</button>`).join('')}</span>
    </div>
    <div class="chart-box" id="${id}" style="height:${height}px"></div>
  </div>`;
}

/* Choisit l'échelle initiale : la fenêtre globale du poste si elle tient
   dans la série, sinon tout. */
function initialRange(len, ranges = CHART_RANGES_WEEKLY) {
  const lb = state.lookback;
  if (!lb || lb >= len) return 0;
  return ranges.some((r) => r.n === lb) ? lb : 0;
}

function wireChartRanges(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.ch-rb');
    if (!b) return;
    const host = b.closest('.ch-ranges');
    const inst = Charts.byId(host.dataset.chart);
    if (!inst) return;
    host.querySelectorAll('.ch-rb').forEach((x) => x.classList.toggle('on', x === b));
    Charts.setRange(inst, Number(b.dataset.bars));
  });
}

/* ═══════════════ Tiroir détaillé ═══════════════
   Un clic sur une cohorte ou une série macro ouvre tout ce que la
   donnée contient à son sujet, sans quitter la vue d'origine. */

function openDrawer(eyebrow, title, bodyHtml, after) {
  $('#drawer-eyebrow').textContent = eyebrow;
  $('#drawer-title').textContent = title;
  $('#drawer-bd').innerHTML = bodyHtml;
  $('#drawer-overlay').classList.remove('hidden');
  $('#drawer-bd').scrollTop = 0;
  if (after) after();
}

function closeDrawer() {
  $('#drawer-overlay').classList.add('hidden');
  /* les graphiques du tiroir sont détruits avec le reste au prochain
     rendu ; on vide le corps pour ne pas garder de canvas orphelins */
  $('#drawer-bd').innerHTML = '';
}

function kv(label, value, sub, cls = '') {
  return `<div class="dr-kv"><label>${label}</label>
    <span class="${cls}">${value}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

/* Histogramme de répartition : la barre allumée est le décile où se
   trouve la valeur du jour. Un percentile seul est un chiffre ; la
   distribution montre s'il est au bord d'une falaise ou au milieu. */
function distributionHtml(values, current) {
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values);
  if (!(max > min)) return '';
  const bins = new Array(20).fill(0);
  for (const v of values) bins[Math.min(19, Math.floor(((v - min) / (max - min)) * 20))]++;
  const here = Math.min(19, Math.floor(((current - min) / (max - min)) * 20));
  const peak = Math.max(...bins) || 1;
  return `<div class="dr-dist">${bins.map((b, i) =>
    `<i class="${i === here ? 'here' : ''}" style="height:${Math.max(3, (b / peak) * 100)}%"
        title="${b} arrêté${b > 1 ? 's' : ''}"></i>`).join('')}</div>
    <div class="dr-axis"><span>${fmtInt(min)}</span><span>répartition historique</span><span>${fmtInt(max)}</span></div>`;
}

function openCohortDrawer(cohortKey) {
  const { market, px } = marketCtx();
  const rows = state.rows;
  const cohorts = CFTC.cohortsFor(state.report);
  const c = cohorts.find((x) => x.key === cohortKey);
  if (!c) return;
  const s = Metrics.cohortStats(rows, cohortKey, market, px);
  const last = rows[rows.length - 1];
  const net = Metrics.series(rows, cohortKey, 'net');
  const values = net.map((p) => p.value);
  const flips = Metrics.flips(net, 0);
  const moves = Metrics.bigMoves(net, 260, 2).slice(0, 8);
  const joined = Metrics.alignPrice(net, Macro.priceSeries(state.metal));
  const corr = joined.length ? Metrics.correlation(joined, 52) : null;
  const vel = Metrics.velocity(net);

  const body = `
    <div class="dr-sec">
      <div class="dr-h">QUI SONT-ILS</div>
      <p class="dr-p">${escapeHtml(c.desc)}</p>
      <p class="dr-p"><b>Rôle de marché :</b> ${c.side === 'spec'
      ? 'spéculatif — la position exprime une opinion directionnelle.'
      : c.side === 'hedge'
        ? 'couverture — la position compense une exposition prise ailleurs (physique, OTC, indices). Elle ne traduit pas un avis de marché.'
        : 'petits porteurs — sous le seuil de déclaration, agrégés sans détail.'}</p>
    </div>

    <div class="dr-sec">
      <div class="dr-h">POSITION AU ${fmtDate(last.date).toUpperCase()}</div>
      <div class="dr-grid">
        ${kv('Longs', fmtInt(s.long), `${fmtPct(s.pctLong)} de l'OI`)}
        ${kv('Courts', fmtInt(s.short), `${fmtPct(s.pctShort)} de l'OI`)}
        ${kv('Net', fmtSigned(s.net), `${fmtPct(s.pctOi)} de l'OI`, signClass(s.net))}
        ${kv('Spread', fmtInt(s.spread), 'positions appariées')}
        ${kv('Notionnel', fmtUsd(s.notional), `${fmtInt(s.ounces)} ${escapeHtml(market.unit)}`)}
        ${kv('Biais long / court', fmtPct(s.bias, 0), 'borné à ±100')}
      </div>
    </div>

    <div class="dr-sec">
      <div class="dr-h">OPÉRATEURS</div>
      <div class="dr-grid">
        ${kv('Déclarants', s.traders || '—', `${s.tradersLong} longs · ${s.tradersShort} courts`)}
        ${kv('Net par opérateur', s.netPerTrader == null ? '—' : fmtSigned(Math.round(s.netPerTrader)),
    'plus il est élevé, plus un débouclage est brutal')}
        ${kv('Part des 4 premiers', `${fmtPct(last.conc.net4Long)} / ${fmtPct(last.conc.net4Short)}`, 'long / court, tous opérateurs')}
      </div>
      <p class="dr-p">La CFTC agrège volontairement : elle publie des catégories et des nombres
        d'opérateurs, jamais les positions nominatives. Le net par opérateur est la mesure la plus
        fine accessible — elle dit si la position est portée par beaucoup de mains ou par quelques-unes.</p>
    </div>

    <div class="dr-sec">
      <div class="dr-h">OÙ SE SITUE CETTE POSITION</div>
      <div class="dr-grid">
        ${kv('COT index 1 an', s.index[52] == null ? '—' : Math.round(s.index[52]), '0 = plancher · 100 = sommet')}
        ${kv('COT index 3 ans', s.index[156] == null ? '—' : Math.round(s.index[156]))}
        ${kv('Z-score 5 ans', s.z[260] == null ? '—' : fmtNum(s.z[260], 2) + 'σ')}
        ${kv('Percentile historique', s.pct[0] == null ? '—' : fmtPct(s.pct[0], 0), `${rows.length} arrêtés`)}
      </div>
      ${distributionHtml(values, s.net)}
    </div>

    <div class="dr-sec">
      <div class="dr-h">HISTORIQUE — ${fmtDate(rows[0].date)} À AUJOURD'HUI</div>
      ${chartFrame('dr-chart', { height: 260, active: 0 })}
      <p class="dr-p dim">Net de la cohorte (échelle de gauche, contrats) contre le prix du métal
        (pointillés, échelle de droite, dollars). Les deux courbes couvrent les
        ${rows.length} arrêtés hebdomadaires disponibles ; les boutons ci-dessus ne changent que
        la fenêtre affichée.</p>
    </div>

    <div class="dr-sec">
      <div class="dr-h">RYTHME</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Horizon</th><th>Δ net</th><th>% amplitude 1 an</th></tr></thead>
        <tbody>${[1, 2, 4, 8, 13].map((h) => {
      const v = vel[h];
      return `<tr><td>${h} sem.</td>
        <td class="n ${signClass(v && v.delta)}">${v ? fmtSigned(v.delta) : '—'}</td>
        <td class="n">${v && v.share != null ? fmtSignedPct(v.share, 0) : '—'}</td></tr>`;
    }).join('')}</tbody>
      </table></div>
    </div>

    <div class="dr-sec">
      <div class="dr-h">RELATION AU PRIX</div>
      <p class="dr-p">Corrélation entre variations hebdomadaires de position et de prix sur 52 semaines :
        <b>${corr == null ? '—' : fmtNum(corr, 2)}</b>${corr == null ? '.'
      : corr > 0.4 ? ' — cette cohorte suit le prix.'
        : corr < -0.2 ? ' — elle va à contre-courant du prix, comportement typique d\'une contrepartie.'
          : ' — lien faible : sa position ne se déduit pas du prix.'}</p>
    </div>

    <div class="dr-sec">
      <div class="dr-h">MOUVEMENTS NOTABLES</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Arrêté</th><th>Variation</th><th>Ampleur</th></tr></thead>
        <tbody>${moves.length ? moves.map((m) => `<tr>
          <td>${fmtDate(m.date)}</td>
          <td class="n ${signClass(m.delta)}">${fmtSigned(m.delta)}</td>
          <td class="n">${fmtNum(m.sigma, 1)}σ</td></tr>`).join('')
      : '<tr><td colspan="3" class="dim">Aucun mouvement au-delà de 2σ sur la période.</td></tr>'}</tbody>
      </table></div>
      ${flips.length ? `<p class="dr-p">Le net a changé de signe <b>${flips.length} fois</b>
        depuis ${fmtDate(rows[0].date)} — dernier basculement le ${fmtDate(flips[flips.length - 1].date)}
        vers ${flips[flips.length - 1].to === 'long' ? 'acheteur' : 'vendeur'}.</p>` : ''}
    </div>

    <div class="dr-sec">
      <div class="dr-h">CE QUI N'EST PAS PUBLIÉ</div>
      <p class="dr-p">Aucune source publique ne donne les positions nominatives d'un établissement,
        ses prix d'entrée, ses stops ou ses objectifs. La CFTC agrège précisément pour que ces
        informations ne soient pas identifiables, et les seuls chiffres qu'une banque diffuse sur
        l'or sont ses notes de recherche — une opinion publiée, pas son livre. Tout écran affichant
        « JPMorgan : long 4 200 lots, stop à 4 180 » serait une invention.</p>
    </div>`;

  openDrawer(`COHORTE · ${market.label.toUpperCase()}`, c.label, body, () => {
    Charts.timeSeries($('#dr-chart'), [
      { label: c.short, color: c.color, data: net, scale: 'left', type: 'area', width: 2 },
      ...(joined.length ? [{
        label: 'Prix', color: '#8892a0',
        data: joined.map((p) => ({ ts: p.ts, value: p.price })),
        scale: 'right', width: 1, dashed: true, precision: 2, minMove: 0.01,
      }] : []),
    ], { id: 'dr-chart', height: 260, zeroLine: true, range: 0 });
  });
}

function openMacroDrawer(id) {
  const s = Macro.snapshot(id);
  if (!s) return;
  const values = s.obs.map((o) => o[1]);
  const g = Macro.correlation('GOLD', id);
  const si = Macro.correlation('SILVER', id);

  const body = `
    <div class="dr-sec">
      <div class="dr-h">CE QUE MESURE CETTE SÉRIE</div>
      <p class="dr-p">${escapeHtml(s.desc || '')}</p>
      <p class="dr-p"><b>Sens pour l'or :</b> ${s.sign === -1
      ? 'une hausse pèse sur le métal.' : s.sign === 1
        ? 'une hausse le soutient.' : 'pas de sens directionnel simple.'}
        Code FRED <b>${escapeHtml(s.id)}</b>, dernière observation le ${fmtDate(s.date)}.</p>
    </div>

    <div class="dr-sec">
      <div class="dr-h">NIVEAU ET VARIATIONS</div>
      <div class="dr-grid">
        ${kv('Niveau', fmtNum(s.last, 2) + (s.unit === 'idx' ? '' : ' ' + escapeHtml(s.unit)))}
        ${kv('1 semaine', s.d5 == null ? '—' : fmtNum(s.d5, 2))}
        ${kv('1 mois', s.d21 == null ? '—' : fmtNum(s.d21, 2))}
        ${kv('3 mois', s.d63 == null ? '—' : fmtNum(s.d63, 2))}
        ${kv('1 an', s.d252 == null ? '—' : fmtNum(s.d252, 2))}
        ${kv('Dans son amplitude 1 an', s.range1y ? fmtPct(s.range1y.pct, 0) : '—',
      s.range1y ? `${fmtNum(s.range1y.min, 2)} – ${fmtNum(s.range1y.max, 2)}` : '')}
      </div>
      <p class="dr-p">Les variations sont brutes, sans couleur : sur ces séries, « en hausse »
        ne veut pas dire « favorable ». Le sens propre à chaque moteur est indiqué ci-dessus.</p>
    </div>

    <div class="dr-sec">
      <div class="dr-h">HISTORIQUE</div>
      ${chartFrame('dr-chart', { height: 260, ranges: CHART_RANGES_DAILY, active: 0 })}
    </div>

    <div class="dr-sec">
      <div class="dr-h">RÉPARTITION</div>
      ${distributionHtml(values, s.last)}
    </div>

    <div class="dr-sec">
      <div class="dr-h">LIEN AVEC LES MÉTAUX</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Métal</th><th>Corrélation 52 sem.</th><th>Observations</th></tr></thead>
        <tbody>
          <tr><td>Or</td><td class="n">${g ? fmtNum(g.r, 2) : '—'}</td><td class="n dim">${g ? g.n : '—'}</td></tr>
          <tr><td>Argent</td><td class="n">${si ? fmtNum(si.r, 2) : '—'}</td><td class="n dim">${si ? si.n : '—'}</td></tr>
        </tbody>
      </table></div>
      <p class="dr-p">Corrélation des variations hebdomadaires, pas des niveaux. Une valeur proche
        de zéro ne veut pas dire que la série est sans importance : elle dit que sur cette fenêtre,
        le métal n'a pas suivi ce moteur — ce qui est en soi une information sur le régime en cours.</p>
    </div>`;

  openDrawer('SÉRIE MACRO · FRED', s.label, body, () => {
    const pts = s.obs.map(([d, v]) => ({ ts: Math.floor(Date.parse(d + 'T00:00:00Z') / 1000), value: v }));
    Charts.timeSeries($('#dr-chart'), [{
      label: s.label, color: '#6f8fb0', data: pts, scale: 'left', type: 'area',
      precision: 2, minMove: 0.01,
    }], { id: 'dr-chart', height: 260, range: 0 });
  });
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
    return `<div class="contrib-row clickable" data-cohort="${c.key}" title="${escapeHtml(c.desc)} — cliquer pour le détail">
      <div class="contrib-lb">
        <span class="co-name"><span class="co-dot" style="background:${c.color}"></span>${escapeHtml(c.short)}</span>
        <small>${fmtInt(s.long)} longs · ${fmtInt(s.short)} courts · ${fmtPct(last.oi ? (s.net / last.oi) * 100 : 0)} de l'OI</small>
      </div>
      <div class="contrib-side">
        <div class="contrib-bar wide">
          <i style="left:${left}%;width:${w}%;background:${s.net >= 0 ? 'var(--up)' : 'var(--dn)'}"></i>
          <i class="contrib-zero"></i>
        </div>
        <span class="contrib-val n ${signClass(s.net)}">${fmtSigned(s.net)}</span>
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
      <div class="panel-hd">Net ${escapeHtml(specDef.short.toLowerCase())} contre prix</div>
      <div class="panel-bd flush">${chartFrame(chartId, {
      height: 300, active: initialRange(rows.length),
      hover: 'glissez le curseur sur le graphique',
    })}</div>
      <div class="note" id="ov-diverge"></div>
    </div>

    <div class="panel">
      <div class="panel-hd">Actualité récente
        <span class="hd-sub">${Macro.news ? relTime(Macro.news.generated) : 'indisponible'}</span></div>
      <div class="panel-bd flush">${newsListHtml(news)}</div>
    </div>`;

  /* graphique — série entière, la fenêtre est réglée par la barre d'échelles */
  const netSeries = Metrics.series(rows, specKey, 'net');
  const priceSeries = state.joined.length
    ? state.joined.map((p) => ({ ts: p.ts, value: p.price })) : [];
  Charts.timeSeries($(`#${chartId}`), [
    { label: specDef.short, color: specDef.color, data: netSeries, scale: 'left', type: 'area', width: 2 },
    ...(priceSeries.length
      ? [{ label: 'Prix', color: '#8892a0', data: priceSeries, scale: 'right', width: 1, dashed: true, precision: 2, minMove: 0.01 }]
      : []),
  ], {
    id: chartId, height: 300, zeroLine: true, range: initialRange(rows.length),
    onCrosshair: (info) => {
      const el = $(`#${chartId}-hover`);
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

/* ═══════════════ Vue : analyse Or ═══════════════
   Une lecture d'ensemble de l'or, indépendante du métal sélectionné
   ailleurs. Elle assemble les quatre plans qui décident du métal —
   positionnement, macro, structure de prix, contexte inter-métaux —
   et affiche chaque conclusion avec le chiffre qui la porte. */

async function renderGold(host) {
  host.innerHTML = `<div class="panel"><div class="panel-bd">
    <span class="dim">Assemblage de l'analyse…</span></div></div>`;

  let rows;
  try {
    rows = await CFTC.series('GOLD', { report: state.report, basis: state.basis });
  } catch (e) {
    host.innerHTML = `<div class="panel"><div class="panel-bd">
      <span class="dn">Chargement impossible : ${escapeHtml(e.message)}</span></div></div>`;
    return;
  }
  if (state.view !== 'gold') return;

  const market = CFTC.markets.GOLD;
  const price = Macro.priceOf('GOLD');
  const px = price ? price.price : null;
  const cohorts = CFTC.cohortsFor(state.report);
  const specKey = state.report === 'legacy' ? 'noncomm' : 'money';
  const last = rows[rows.length - 1];
  const spec = Metrics.cohortStats(rows, specKey, market, px);
  const netSeries = Metrics.series(rows, specKey, 'net');
  const joined = Metrics.alignPrice(netSeries, Macro.priceSeries('GOLD'));
  const tension = Metrics.tension(rows, state.report, market, joined);
  const regime = Macro.regime();
  const gap = Metrics.sinceCutoff(rows, Macro.priceSeries('GOLD'), px);
  const daily = Macro.priceSeries('GOLD', { full: false });
  const spread = await ensureSpread().catch(() => null);

  /* structure de prix à partir des fixings quotidiens : où se situe le
     cours dans ses amplitudes, et à quelle distance de ses moyennes */
  const closes = daily.map((p) => p.close);
  const cur = px != null ? px : closes[closes.length - 1];
  const stat = (n) => {
    const w = closes.slice(-n);
    if (w.length < 5) return null;
    /* Le cours courant vient du spot temps réel, l'amplitude des fixings
       quotidiens : sans l'inclure, un spot au-delà du dernier fixing
       produit une position supérieure à 100 %. */
    const hi = Math.max(...w, cur), lo = Math.min(...w, cur);
    const ma = w.reduce((a, b) => a + b, 0) / w.length;
    return { hi, lo, ma, pos: hi > lo ? ((cur - lo) / (hi - lo)) * 100 : 50, vsMa: ((cur - ma) / ma) * 100 };
  };
  const s20 = stat(20), s60 = stat(60), s250 = stat(250);

  /* volatilité réalisée sur les fixings quotidiens */
  const rv = (n) => {
    const w = closes.slice(-(n + 1));
    if (w.length < 10) return null;
    const r = [];
    for (let i = 1; i < w.length; i++) r.push(Math.log(w[i] / w[i - 1]));
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1) * 252) * 100;
  };

  /* les quatre plans, chacun avec son verdict et le chiffre qui le porte */
  const planes = [
    {
      name: 'Positionnement', tone: tension ? tension.tone : 'neutral',
      verdict: tension ? tension.verdict : '—',
      detail: `Net ${cohorts.find((c) => c.key === specKey).short.toLowerCase()} à `
        + `<b>${fmtSigned(spec.net)}</b> contrats (${fmtPct(spec.pctOi)} de l'open interest), `
        + `COT index ${spec.index[156] == null ? '—' : Math.round(spec.index[156])}/100 sur trois ans, `
        + `z = ${spec.z[260] == null ? '—' : fmtNum(spec.z[260], 2)}σ sur cinq ans.`,
    },
    {
      name: 'Macro', tone: regime ? regime.tone : 'neutral',
      verdict: regime ? regime.verdict : 'Instantané macro indisponible',
      detail: regime
        ? regime.parts.slice(0, 3).map((p) => `${escapeHtml(p.label)} ${escapeHtml(p.detail)}`).join(' · ')
        : '—',
    },
    {
      name: 'Structure de prix',
      tone: s60 ? (s60.pos > 80 ? 'hot' : s60.pos > 60 ? 'warm' : s60.pos < 20 ? 'cold' : s60.pos < 40 ? 'cool' : 'neutral') : 'neutral',
      verdict: s60 ? (s60.pos > 80 ? 'Haut de son amplitude trimestrielle'
        : s60.pos < 20 ? 'Bas de son amplitude trimestrielle'
          : 'Milieu de son amplitude trimestrielle') : '—',
      detail: s60
        ? `À <b>${fmtPct(s60.pos, 0)}</b> de l'amplitude 60 jours, `
        + `${fmtSignedPct(s60.vsMa)} par rapport à sa moyenne, `
        + `volatilité réalisée ${fmtPct(rv(60), 1)} annualisée.`
        : '—',
    },
    {
      name: 'Or contre argent',
      tone: spread && spread.last ? (spread.last.value > 20 ? 'warm' : spread.last.value < -20 ? 'cool' : 'neutral') : 'neutral',
      verdict: spread && spread.reading ? spread.reading : 'Comparaison indisponible',
      detail: spread && spread.last
        ? `Écart de positionnement normalisé <b>${(spread.last.value > 0 ? '+' : '') + Math.round(spread.last.value)}</b>, `
        + `${spread.z == null ? '' : `soit ${fmtNum(spread.z, 2)}σ, `}`
        + `ratio or/argent ${(() => { const s = Macro.priceOf('SILVER'); return s && s.price ? fmtNum(cur / s.price, 1) : '—'; })()}.`
        : '—',
    },
  ];

  /* concordance : combien de plans tirent dans le même sens */
  const dirOf = (t) => (t === 'hot' || t === 'warm' ? 1 : t === 'cold' || t === 'cool' ? -1 : 0);
  const dirs = planes.map((p) => dirOf(p.tone));
  const agree = dirs.filter((d) => d > 0).length - dirs.filter((d) => d < 0).length;

  host.innerHTML = `
    <div class="grid-4">
      ${statCard({
    label: 'Or — cours',
    value: cur == null ? '—' : fmtNum(cur, 2) + ' $',
    sub: price ? `${escapeHtml(price.source)}${price.live ? ' · temps réel' : ''}` : '—',
  })}
      ${statCard({
    label: 'Amplitude 250 jours',
    value: s250 ? fmtPct(s250.pos, 0) : '—',
    cls: 'stat-v sm',
    gauge: s250 ? gaugeHtml(s250.pos, s250.pos > 70 ? 'warm' : s250.pos < 30 ? 'cool' : 'neutral', ['bas', '', 'haut']) : '',
    sub: s250 ? `${fmtNum(s250.lo, 0)} – ${fmtNum(s250.hi, 0)} $` : '—',
  })}
      ${statCard({
    label: 'Volatilité réalisée',
    value: rv(20) == null ? '—' : fmtPct(rv(20), 1),
    cls: 'stat-v sm',
    sub: `20 jours · ${rv(60) == null ? '—' : fmtPct(rv(60), 1)} sur 60 jours`,
  })}
      ${statCard({
    label: 'Concordance des plans',
    value: `${agree > 0 ? '+' : ''}${agree} / 4`,
    cls: `stat-v sm tone-${agree >= 2 ? 'warm' : agree <= -2 ? 'cool' : 'neutral'}`,
    sub: agree >= 2 ? 'plans majoritairement porteurs'
      : agree <= -2 ? 'plans majoritairement contraires'
        : 'plans partagés — pas de lecture dominante',
  })}
    </div>

    <div class="panel">
      <div class="panel-hd">Les quatre plans
        <span class="hd-sub">chaque verdict avec le chiffre qui le porte</span></div>
      <div class="panel-bd flush">
        ${planes.map((p) => `<div class="plane">
          <div class="plane-hd">
            <span class="plane-name">${escapeHtml(p.name)}</span>
            <span class="plane-verdict tone-${p.tone}">${escapeHtml(p.verdict)}</span>
          </div>
          <div class="plane-detail">${p.detail}</div>
        </div>`).join('')}
      </div>
      <div class="note">${agree === 0
    ? `<b>Les plans ne convergent pas.</b> C'est l'état le plus fréquent, et le plus honnête à afficher :
       une lecture unique n'émerge que lorsque positionnement, macro et prix pointent ensemble.`
    : `<b>${Math.abs(agree)} plan${Math.abs(agree) > 1 ? 's' : ''} sur quatre</b> penche${Math.abs(agree) > 1 ? 'nt' : ''}
       ${agree > 0 ? 'du côté porteur' : 'du côté contraire'}. La concordance n'est pas une prévision :
       elle dit seulement que les angles d'analyse racontent la même histoire en ce moment.`}</div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-hd">Structure de prix<span class="hd-sub">fixings quotidiens LBMA</span></div>
        <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Fenêtre</th><th>Bas</th><th>Haut</th><th>Position</th><th>Écart moyenne</th></tr></thead>
          <tbody>
            ${[['20 jours', s20], ['60 jours', s60], ['250 jours', s250]].map(([lb, st]) => st ? `
              <tr><td>${lb}</td>
                <td class="n">${fmtNum(st.lo, 2)}</td>
                <td class="n">${fmtNum(st.hi, 2)}</td>
                <td class="n">${fmtPct(st.pos, 0)}</td>
                <td class="n ${signClass(st.vsMa)}">${fmtSignedPct(st.vsMa)}</td></tr>` : '').join('')}
          </tbody>
        </table></div></div>
      </div>

      <div class="panel">
        <div class="panel-hd">Moteurs macro de l'or
          <span class="hd-sub">classés par contribution · cliquez pour le détail</span></div>
        <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Moteur</th><th>Niveau</th><th>Variation</th><th>Effet</th></tr></thead>
          <tbody>${regime ? regime.parts.map((p) => `
            <tr class="clickable" data-macro="${escapeHtml(p.id)}" title="${escapeHtml(p.why)}">
              <td>${escapeHtml(p.label)}</td>
              <td class="n">${fmtNum(p.last, 2)}</td>
              <td class="n">${escapeHtml(p.detail)}</td>
              <td class="${p.value > 0.1 ? 'up' : p.value < -0.1 ? 'dn' : 'dim'}">
                ${p.value > 0.1 ? 'favorable' : p.value < -0.1 ? 'défavorable' : 'neutre'}</td>
            </tr>`).join('') : '<tr><td colspan="4" class="dim">Instantané macro indisponible.</td></tr>'}</tbody>
        </table></div></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-hd">Positionnement contre cours — historique complet</div>
      <div class="panel-bd flush">${chartFrame('gd-chart', {
      height: 340, active: 0, hover: 'survolez le graphique',
    })}</div>
    </div>

    <div class="panel">
      <div class="panel-hd">Ce que cette analyse ne couvre pas</div>
      <div class="panel-bd">
        <p class="legend-note">Le COT ne voit que les contrats à terme américains. Trois moteurs
        majeurs de l'or lui échappent entièrement : le marché de gré à gré de Londres, où se traite
        l'essentiel du volume mondial et qui ne publie pas de positions ; les <b>achats de banques
        centrales</b>, déclarés au FMI avec plusieurs mois de retard ; et les <b>flux des ETF
        adossés au physique</b>, publiés quotidiennement par les émetteurs mais sans interface
        exploitable depuis un navigateur.</p>
        <p class="legend-note" style="margin-top:9px">Quand le cours de l'or décroche de ses moteurs
        habituels — taux réels, dollar — c'est très souvent l'un de ces trois canaux qui agit.
        L'absence de corrélation visible à l'écran est alors une information : elle indique que la
        cause est ailleurs, pas qu'il n'y en a pas.</p>
      </div>
    </div>`;

  Charts.timeSeries($('#gd-chart'), [
    { label: 'Net spéculatif', color: '#d9a441', data: netSeries, scale: 'left', type: 'area', width: 2 },
    ...(joined.length ? [{
      label: 'Or', color: '#8892a0',
      data: joined.map((p) => ({ ts: p.ts, value: p.price })),
      scale: 'right', width: 1.5, precision: 2, minMove: 0.01,
    }] : []),
  ], {
    id: 'gd-chart', height: 340, zeroLine: true, range: 0,
    onCrosshair: (info) => {
      const el = $('#gd-chart-hover');
      if (!el) return;
      if (!info) { el.textContent = 'survolez le graphique'; return; }
      el.innerHTML = info.values.filter((v) => v.value != null)
        .map((v) => `${escapeHtml(v.label)} <b>${fmtInt(v.value)}</b>`).join(' · ');
    },
  });
}

/* ═══════════════ Vue : court terme ═══════════════
   Le COT est hebdomadaire et différé — on ne peut pas en faire un flux
   temps réel. Cette vue exploite donc ce qui est réellement court terme
   dedans : le flux de la semaine, la vitesse de rotation, et surtout le
   comblement de l'angle mort entre l'arrêté et l'instant présent, où le
   prix, lui, est en direct. */

function renderShortTerm(host) {
  const { market, price, px } = marketCtx();
  const rows = state.rows;
  const cohorts = CFTC.cohortsFor(state.report);
  const specKey = state.report === 'legacy' ? 'noncomm' : 'money';
  const specDef = cohorts.find((c) => c.key === specKey);
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];

  const daily = Macro.priceSeries(state.metal, { full: false });
  const gap = Metrics.sinceCutoff(rows, daily.length ? daily : Macro.priceSeries(state.metal), px);
  const rel = CFTC.nextRelease(last.date);
  const netSeries = Metrics.series(rows, specKey, 'net');
  const vel = Metrics.velocity(netSeries);
  /* Deux fenêtres, deux questions différentes. Sur trois ans, la
     sensibilité est structurelle : combien de contrats la cohorte ajoute
     par point de prix, en moyenne de cycle. Sur un an, elle dit si elle
     se comporte encore ainsi *en ce moment*. L'écart entre les deux est
     lui-même une information. */
  const beta = state.joined.length ? Metrics.priceBeta(state.joined, 156) : null;
  const betaNow = state.joined.length ? Metrics.priceBeta(state.joined, 52) : null;

  /* L'extrapolation n'est affichée que si la relation de fond tient un
     minimum. Un β sans r² correct n'est pas une estimation, c'est un
     chiffre décoratif. */
  const drift = (beta && gap && beta.r2 >= 0.10)
    ? beta.beta * gap.changePct : null;
  const broken = beta && betaNow && beta.r2 >= 0.10 && betaNow.r2 < beta.r2 / 2;

  const hd = `<div class="grid-4">
    ${statCard({
    label: 'Arrêté du rapport',
    value: fmtDateShort(last.date),
    cls: 'stat-v sm',
    sub: gap ? `il y a <b>${gap.days} jour${gap.days > 1 ? 's' : ''}</b>` : '—',
  })}
    ${statCard({
    label: 'Prochaine publication',
    value: (() => {
      const h = Math.max(0, Math.floor(rel.msLeft / 3600000));
      return h >= 24 ? `${Math.floor(h / 24)} j ${h % 24} h` : `${h} h`;
    })(),
    cls: 'stat-v sm',
    sub: `vendredi ~20 h 30 · arrêté au ${fmtDateShort(rel.asOf)}`,
  })}
    ${gap ? statCard({
    label: `Prix depuis l'arrêté`,
    value: fmtSignedPct(gap.changePct),
    cls: signClass(gap.changePct),
    sub: `${fmtNum(gap.cutoffPrice, 2)} $ → <b>${fmtNum(gap.price, 2)} $</b>`
      + (gap.rangePct != null ? ` · amplitude ${fmtPct(gap.rangePct)}` : ''),
  }) : ''}
    ${statCard({
    label: `Flux hebdo — ${specDef.short.toLowerCase()}`,
    value: fmtSigned(last.cohorts[specKey].dNet),
    cls: signClass(last.cohorts[specKey].dNet),
    sub: prev && prev.cohorts[specKey].net
      ? `${fmtSignedPct((last.cohorts[specKey].dNet / Math.abs(prev.cohorts[specKey].net)) * 100, 1)} de la position`
      : '—',
  })}
  </div>`;

  /* ── flux de la semaine, par cohorte ── */
  const maxFlow = Math.max(...cohorts.map((c) => Math.abs(last.cohorts[c.key].dNet))) || 1;
  const flows = cohorts
    .map((c) => ({ c, s: last.cohorts[c.key], p: prev ? prev.cohorts[c.key] : null }))
    .sort((a, b) => Math.abs(b.s.dNet) - Math.abs(a.s.dNet))
    .map(({ c, s, p }) => {
      const w = (Math.abs(s.dNet) / maxFlow) * 50;
      const left = s.dNet >= 0 ? 50 : 50 - w;
      const rel2 = p && Math.abs(p.net) > 0 ? (s.dNet / Math.abs(p.net)) * 100 : null;
      return `<tr class="clickable" data-cohort="${c.key}" title="${escapeHtml(c.desc)} — cliquer pour le détail">
        <td><span class="co-name"><span class="co-dot" style="background:${c.color}"></span>${escapeHtml(c.short)}</span></td>
        <td class="n ${signClass(s.dLong)}">${fmtSigned(s.dLong)}</td>
        <td class="n ${signClass(-s.dShort)}">${fmtSigned(s.dShort)}</td>
        <td class="n ${signClass(s.dNet)}"><b>${fmtSigned(s.dNet)}</b></td>
        <td class="n ${signClass(rel2)}">${rel2 == null ? '—' : fmtSignedPct(rel2, 1)}</td>
        <td class="n">${last.oi ? fmtPct((s.dNet / last.oi) * 100, 2) : '—'}</td>
        <td style="width:130px"><div class="contrib-bar wide" style="width:120px">
          <i style="left:${left}%;width:${w}%;background:${s.dNet >= 0 ? 'var(--up)' : 'var(--dn)'}"></i>
          <i class="contrib-zero"></i>
        </div></td>
      </tr>`;
    }).join('');

  /* ── vitesse de rotation ── */
  const velRows = [1, 2, 4, 8, 13].map((h) => {
    const v = vel[h];
    return `<tr>
      <td>${h} semaine${h > 1 ? 's' : ''}</td>
      <td class="n ${signClass(v && v.delta)}">${v ? fmtSigned(v.delta) : '—'}</td>
      <td class="n">${v && v.share != null ? fmtSignedPct(v.share, 0) : '—'}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    ${hd}

    <div class="panel">
      <div class="panel-hd">Flux de la semaine
        <span class="hd-sub">arrêté du ${fmtDate(last.date)}${prev ? ` contre ${fmtDate(prev.date)}` : ''}</span></div>
      <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Cohorte</th><th>Δ longs</th><th>Δ courts</th><th>Δ net</th>
          <th title="Variation rapportée à la position nette de la semaine précédente">% position</th>
          <th title="Variation rapportée à l'open interest total">% OI</th><th></th>
        </tr></thead>
        <tbody>${flows}</tbody>
      </table></div></div>
      <div class="note">Trié par ampleur du mouvement. La colonne <b>Δ courts</b> est colorée
        à l'envers : une baisse des positions courtes est un rachat, donc un flux acheteur.</div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-hd">Vitesse de rotation — ${escapeHtml(specDef.short.toLowerCase())}
          <span class="hd-sub">horizons courts</span></div>
        <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Horizon</th><th>Δ net</th>
            <th title="Part de l'amplitude parcourue sur 52 semaines">% amplitude 1 an</th></tr></thead>
          <tbody>${velRows}</tbody>
        </table></div></div>
        <div class="note">La colonne de droite ramène chaque mouvement à l'amplitude annuelle :
          c'est ce qui distingue un ajustement de routine d'une vraie rotation.</div>
      </div>

      <div class="panel">
        <div class="panel-hd">L'angle mort<span class="hd-sub">ce que le rapport ne voit pas encore</span></div>
        <div class="panel-bd">
          ${gap ? `
            <p class="legend-note" style="margin-bottom:12px">
              Le dernier arrêté date du <b>${fmtDate(gap.cutoffDate)}</b>, soit
              <b>${gap.days} jour${gap.days > 1 ? 's' : ''}</b>. Depuis, le prix est passé de
              ${fmtNum(gap.cutoffPrice, 2)} $ à <b>${fmtNum(gap.price, 2)} $</b>
              (${fmtSignedPct(gap.changePct)}), avec une amplitude de ${fmtPct(gap.rangePct)}.
              Le positionnement a bougé pendant ce temps, sans qu'aucune donnée ne le montre.
            </p>
            <table class="tbl"><tbody>
              <tr><td style="color:var(--muted)">Sensibilité de fond (3 ans)</td>
                  <td class="n">${beta ? `${fmtSigned(Math.round(beta.beta))} contrats / point de %` : '—'}</td></tr>
              <tr><td style="color:var(--muted)">Qualité de cette relation (r²)</td>
                  <td class="n">${beta ? `${fmtNum(beta.r2, 2)} sur ${beta.n} sem.` : '—'}</td></tr>
              <tr><td style="color:var(--muted)">Régime actuel (1 an, r²)</td>
                  <td class="n ${betaNow && beta && betaNow.r2 < beta.r2 / 2 ? 'dn' : ''}">
                    ${betaNow ? `${fmtNum(betaNow.r2, 2)} sur ${betaNow.n} sem.` : '—'}</td></tr>
              ${drift != null ? `
                <tr><td style="color:var(--muted)">Dérive indicative</td>
                    <td class="n ${signClass(drift)}"><b>${fmtSigned(Math.round(drift))}</b> contrats</td></tr>
                <tr><td style="color:var(--muted)">Net implicite</td>
                    <td class="n"><b>${fmtSigned(Math.round(last.cohorts[specKey].net + drift))}</b>
                    <span class="dim">contre ${fmtSigned(last.cohorts[specKey].net)} publié</span></td></tr>` : ''}
            </tbody></table>
            ${drift == null ? `<p class="legend-note" style="margin-top:11px">
              <b>Aucune extrapolation affichée.</b> La relation entre variation de prix et
              variation de position est trop lâche${beta ? ` (r² = ${fmtNum(beta.r2, 2)})` : ''}
              pour qu'un chiffre en soit tiré. C'est un refus délibéré, pas une donnée manquante.</p>` : ''}
          ` : '<p class="legend-note">Historique de prix indisponible pour ce marché.</p>'}
        </div>
        <div class="note">
          ${broken ? `<b>La relation habituelle s'est rompue.</b> Sur trois ans la cohorte suit le prix
            (r² = ${fmtNum(beta.r2, 2)}), mais sur un an le lien a quasiment disparu
            (r² = ${fmtNum(betaNow.r2, 2)}) : elle se positionne actuellement sur autre chose que
            le mouvement de prix. L'extrapolation ci-dessus est donc à prendre avec des pincettes
            supplémentaires. ` : ''}
          ${drift != null ? `<b>C'est une extrapolation, pas une donnée.</b> Elle suppose que la cohorte
            réagit au prix comme en moyenne sur trois ans — hypothèse qui casse précisément lors des
            retournements, c'est-à-dire quand on aimerait le plus s'y fier. Ordre de grandeur, jamais
            un chiffre publié.`
    : `Un r² faible n'est pas un défaut de mesure : il dit que le positionnement de cette cohorte
            ne se déduit pas du prix en ce moment. C'est une information en soi.`}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-hd">Prix quotidien et arrêtés récents
        <span class="hd-sub">les repères marquent les dates d'arrêté du COT</span></div>
      <div class="panel-bd flush">${chartFrame('st-price', {
      height: 300, ranges: CHART_RANGES_DAILY, active: 126,
    })}</div>
      <div class="note">Entre deux repères, le positionnement est invisible. C'est la limite
        structurelle du COT, et la raison d'être de cette vue.</div>
    </div>`;

  /* prix quotidien complet + marqueurs d'arrêté ; la fenêtre initiale
     est de six mois, réglable par la barre d'échelles */
  const cut = daily.length ? daily[0].ts : 0;
  const recent = daily;
  if (recent.length) {
    const inst = Charts.timeSeries($('#st-price'), [{
      label: `${market.label} (fixing quotidien)`, color: '#d9a441',
      data: recent.map((p) => ({ ts: p.ts, value: p.close })),
      scale: 'left', type: 'area', precision: 2, minMove: 0.01,
    }], { id: 'st-price', height: 300, range: 126 });

    if (inst && inst.handles[0]) {
      const marks = rows.filter((r) => r.ts >= cut).map((r) => ({
        time: r.ts, position: 'belowBar', color: '#4b535e', shape: 'arrowUp',
        text: fmtDateShort(r.date).slice(0, 5),
      }));
      try {
        const LWC = window.LightweightCharts;
        if (LWC.createSeriesMarkers) LWC.createSeriesMarkers(inst.handles[0].handle, marks);
        else if (inst.handles[0].handle.setMarkers) inst.handles[0].handle.setMarkers(marks);
      } catch { /* marqueurs indisponibles : le graphique reste lisible sans */ }
    }
  } else {
    $('#st-price').innerHTML = '<div class="news-empty">Aucun fixing quotidien pour ce marché.</div>';
  }
}

/* ═══════════════ Vue : flux d'ordres ═══════════════
   La seule vue du poste où l'on descend sous la semaine. Elle ne
   porte pas sur le COMEX mais sur l'or tokenisé, seul support de l'or
   dont le carnet et les transactions soient publics et interrogeables
   depuis un navigateur. Le suivi du spot est étroit ; ce n'est pas
   pour autant le même marché, et l'écran le rappelle. */

async function renderTape(host) {
  host.innerHTML = `<div class="panel"><div class="panel-bd">
    <span class="dim">Connexion au carnet…</span></div></div>`;

  const ok = await Tape.probe().catch(() => false);
  if (state.view !== 'tape') return;
  if (!ok) {
    host.innerHTML = `<div class="panel"><div class="panel-bd">
      <p class="legend-note">Aucun instrument d'or tokenisé ne répond actuellement.
      Cette vue dépend de l'API publique OKX ; le reste du poste n'est pas concerné.</p>
    </div></div>`;
    return;
  }

  const bar = TAPE_BARS.find((b) => b.key === state.tapeBar) || TAPE_BARS[2];
  let candles = [], trades = [], book = null, tick = null;
  try {
    [candles, trades, book, tick] = await Promise.all([
      Tape.candles(bar.key, state.tapeBars || 300),
      Tape.trades(500).catch(() => []),
      Tape.book(25).catch(() => null),
      Tape.ticker().catch(() => null),
    ]);
  } catch (e) {
    host.innerHTML = `<div class="panel"><div class="panel-bd">
      <span class="dn">Chargement impossible : ${escapeHtml(e.message)}</span></div></div>`;
    return;
  }
  if (state.view !== 'tape') return;

  const flow = Tape.flow(trades);
  const bs = Tape.bookStats(book);
  const lastBar = candles[candles.length - 1];
  const anat = Tape.barAnatomy(lastBar);
  const vol = Tape.realizedVol(candles, bar.ms);
  const profile = Tape.volumeProfile(candles.slice(-160));
  const spotGold = Macro.priceOf('GOLD');

  const barBtns = TAPE_BARS.map((b) =>
    `<button data-bar="${b.key}"${b.key === bar.key ? ' class="on"' : ''}>${escapeHtml(b.key)}</button>`).join('');

  host.innerHTML = `
    <div class="grid-4">
      ${statCard({
    label: `${Tape.instrument.label} — dernier`,
    value: tick ? fmtNum(tick.last, 2) + ' $' : '—',
    cls: tick && tick.changePct != null ? signClass(tick.changePct) : '',
    sub: tick && tick.changePct != null
      ? `${fmtSignedPct(tick.changePct, 2)} sur 24 h · haut ${fmtNum(tick.high24h, 2)} / bas ${fmtNum(tick.low24h, 2)}` : '—',
  })}
      ${statCard({
    label: 'Écart au spot',
    value: (tick && spotGold) ? fmtSignedPct(((tick.last - spotGold.price) / spotGold.price) * 100, 2) : '—',
    cls: 'stat-v sm',
    sub: spotGold ? `spot ${fmtNum(spotGold.price, 2)} $ · ${escapeHtml(spotGold.source)}` : '—',
  })}
      ${statCard({
    label: `Delta du flux — ${flow ? flow.n : 0} transactions`,
    value: flow ? fmtSignedPct(flow.deltaPct, 1) : '—',
    cls: flow ? signClass(flow.delta) : '',
    sub: flow
      ? `${fmtNum(flow.buyVol, 2)} achetés au marché contre ${fmtNum(flow.sellVol, 2)} vendus`
      : '—',
  })}
      ${statCard({
    label: `Volatilité réalisée (${escapeHtml(bar.label)})`,
    value: vol == null ? '—' : fmtPct(vol, 1),
    cls: 'stat-v sm',
    sub: 'annualisée sur la fenêtre affichée',
  })}
    </div>

    <div class="panel">
      <div class="panel-hd">
        <span>${escapeHtml(Tape.instrument.name)} — ${escapeHtml(bar.label)}
          <span class="hd-sub" id="tp-hover" style="margin-left:9px">survolez une bougie</span></span>
        <span class="seg" id="tape-bars">${barBtns}</span>
      </div>
      <div class="panel-bd flush"><div class="chart-box" id="tp-chart"></div></div>
      <div class="note"><b>Or tokenisé, pas le COMEX.</b> ${escapeHtml(Tape.instrument.name)} est adossé à
        de l'or physique en coffre et se négocie en continu ; son suivi du spot est étroit mais imparfait.
        C'est le seul support de l'or dont le carnet et les transactions soient publics — les contrats
        à terme du COMEX ne diffusent rien de tel.</div>
    </div>

    <div class="grid-3">
      <div class="panel">
        <div class="panel-hd">Anatomie de la dernière bougie</div>
        <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl"><tbody>
          ${anat ? `
          <tr><td style="color:var(--muted)">Sens</td><td class="n ${anat.direction === 'up' ? 'up' : anat.direction === 'down' ? 'dn' : ''}">
            ${anat.direction === 'up' ? 'haussière' : anat.direction === 'down' ? 'baissière' : 'plate'}</td></tr>
          <tr><td style="color:var(--muted)">Amplitude</td><td class="n">${fmtNum(anat.range, 2)} $</td></tr>
          <tr><td style="color:var(--muted)">Corps</td><td class="n">${fmtPct(anat.bodyPct, 0)} de l'amplitude</td></tr>
          <tr><td style="color:var(--muted)">Mèche haute</td><td class="n">${fmtNum(anat.upperWick, 2)} $</td></tr>
          <tr><td style="color:var(--muted)">Mèche basse</td><td class="n">${fmtNum(anat.lowerWick, 2)} $</td></tr>
          <tr><td style="color:var(--muted)">Clôture dans l'amplitude</td><td class="n">${fmtPct(anat.closePos, 0)}</td></tr>
          <tr><td style="color:var(--muted)">Volume</td><td class="n">${fmtNum(lastBar.volume, 2)}</td></tr>` : ''}
        </tbody></table></div></div>
        <div class="note">Un corps étroit entre deux longues mèches dit qu'aucun camp n'a pris
          le dessus, quel que soit le sens final de la bougie.</div>
      </div>

      <div class="panel">
        <div class="panel-hd">Ce qu'il y a dans le flux
          <span class="hd-sub">${flow ? `${new Date(flow.from).toLocaleTimeString('fr-FR')} → ${new Date(flow.to).toLocaleTimeString('fr-FR')}` : ''}</span></div>
        <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl"><tbody>
          ${flow ? `
          <tr><td style="color:var(--muted)">Delta (achats − ventes au marché)</td>
              <td class="n ${signClass(flow.delta)}"><b>${fmtSigned(Math.round(flow.delta * 100) / 100)}</b></td></tr>
          <tr><td style="color:var(--muted)">Déséquilibre</td>
              <td class="n ${signClass(flow.deltaPct)}">${fmtSignedPct(flow.deltaPct, 1)}</td></tr>
          <tr><td style="color:var(--muted)">Montant échangé</td><td class="n">${fmtUsd(flow.turnover)}</td></tr>
          <tr><td style="color:var(--muted)">Taille médiane</td><td class="n">${fmtNum(flow.median, 3)}</td></tr>
          <tr><td style="color:var(--muted)">Seuil « gros ordre » (90ᵉ centile)</td><td class="n">${fmtNum(flow.p90, 3)}</td></tr>
          <tr><td style="color:var(--muted)">Gros ordres</td><td class="n">${flow.bigCount}</td></tr>
          <tr><td style="color:var(--muted)">Delta des gros ordres</td>
              <td class="n ${signClass(flow.bigDelta)}">${fmtSigned(Math.round(flow.bigDelta * 100) / 100)}</td></tr>` : ''}
        </tbody></table></div></div>
        <div class="note">${flow && flow.bigVsAll != null && Math.abs(flow.bigVsAll) > 25
    ? `<b>Les gros ordres divergent du flux général</b> de ${fmtSignedPct(flow.bigVsAll, 0)} :
       le flux dominant et les grosses mains ne vont pas dans le même sens.`
    : 'Le côté « agresseur » de chaque transaction est public : on sait qui a traversé le spread, pas seulement combien a été échangé.'}</div>
      </div>

      <div class="panel">
        <div class="panel-hd">Carnet d'ordres<span class="hd-sub">profondeur autour du milieu</span></div>
        <div class="panel-bd flush"><div class="tbl-wrap"><table class="tbl"><tbody>
          ${bs ? `
          <tr><td style="color:var(--muted)">Meilleure demande / offre</td>
              <td class="n">${fmtNum(bs.bid, 2)} / ${fmtNum(bs.ask, 2)}</td></tr>
          <tr><td style="color:var(--muted)">Écart</td>
              <td class="n">${fmtNum(bs.spread, 2)} $ · ${fmtNum(bs.spreadBps, 1)} pb</td></tr>
          ${[[0.0005, '±0,05 %'], [0.001, '±0,1 %'], [0.0025, '±0,25 %']].map(([k, lb]) => {
      const d = bs.depths[k];
      return `<tr><td style="color:var(--muted)">Déséquilibre ${lb}</td>
                <td class="n ${signClass(d.imbalance)}">${fmtSignedPct(d.imbalance, 0)}</td></tr>`;
    }).join('')}
          <tr><td style="color:var(--muted)">Total demande / offre</td>
              <td class="n">${fmtNum(bs.bidTotal, 2)} / ${fmtNum(bs.askTotal, 2)}</td></tr>` : ''}
        </tbody></table></div></div>
        <div class="note">Un déséquilibre positif signale plus de volume à l'achat qu'à la vente
          dans la zone considérée — une pression, pas une garantie : un carnet se retire en une seconde.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-hd">Profil de volume
        <span class="hd-sub">où les échanges se sont concentrés · ${profile ? '160 dernières bougies' : ''}</span></div>
      <div class="panel-bd">${profileHtml(profile)}</div>
      <div class="note">Le <b>point de contrôle</b> est le niveau de prix qui a vu passer le plus de volume.
        Les zones épaisses ont été acceptées par le marché, les zones fines traversées rapidement —
        ce sont souvent celles qui se reparcourent vite.</div>
    </div>

    <div class="panel">
      <div class="panel-hd">Ce que cette vue ne peut pas montrer</div>
      <div class="panel-bd">
        <p class="legend-note"><b>Les liquidations sur l'or n'existent pas en accès public.</b>
        Elles sont publiées sur les contrats perpétuels crypto, où un moteur de liquidation centralisé
        les diffuse. Ni le COMEX ni le marché de gré à gré de Londres ne publient quoi que ce soit
        d'équivalent : il n'y a pas de flux à afficher, et j'ai préféré ne rien mettre plutôt
        qu'un chiffre inventé.</p>
        <p class="legend-note" style="margin-top:9px"><b>Les stops et objectifs des intervenants
        ne sont transmis à personne.</b> Un ordre stop reste chez le courtier ou dans le moteur
        d'appariement jusqu'à son déclenchement ; aucune bourse ne diffuse les niveaux en attente.
        Ce qui s'en approche le plus est la profondeur du carnet ci-dessus, qui montre les ordres
        à cours limité effectivement visibles.</p>
      </div>
    </div>`;

  Charts.candles($('#tp-chart'), candles, {
    height: 420, precision: 2,
    intraday: bar.ms < 86400000,
    onCrosshair: (info) => {
      const el = $('#tp-hover');
      if (!el) return;
      if (!info || !info.bar) { el.textContent = 'survolez une bougie'; return; }
      const b = info.bar;
      el.innerHTML = `O <b>${fmtNum(b.open, 2)}</b> H <b>${fmtNum(b.high, 2)}</b>
        B <b>${fmtNum(b.low, 2)}</b> C <b>${fmtNum(b.close, 2)}</b>`;
    },
  });

  $$('#tape-bars button').forEach((b) => {
    b.onclick = () => { state.tapeBar = b.dataset.bar; render(); };
  });
}

/* profil de volume en barres horizontales : un graphique complet
   serait disproportionné pour vingt-quatre paliers */
function profileHtml(p) {
  if (!p) return '<div class="news-empty">Profil indisponible.</div>';
  return `<div class="vprofile">${[...p.bins].reverse().map((b) => {
    const isPoc = b === p.poc;
    return `<div class="vp-row${isPoc ? ' poc' : ''}" title="${fmtNum(b.low, 2)} – ${fmtNum(b.high, 2)} $">
      <span class="vp-px">${fmtNum((b.low + b.high) / 2, 2)}</span>
      <span class="vp-bar"><i style="width:${((b.volume / p.maxVol) * 100).toFixed(1)}%"></i></span>
      <span class="vp-v">${fmtNum(b.volume, 1)}</span>
    </div>`;
  }).join('')}</div>
  <div class="legend-note" style="margin-top:9px">Point de contrôle :
    <b>${fmtNum((p.poc.low + p.poc.high) / 2, 2)} $</b> · amplitude ${fmtNum(p.low, 2)} – ${fmtNum(p.high, 2)} $</div>`;
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
    return `<tr class="clickable" data-cohort="${c.key}" title="${escapeHtml(c.desc)} — cliquer pour le détail">
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
  const r0 = initialRange(rows.length);

  host.innerHTML = `
    <div class="panel">
      <div class="panel-hd">Positions nettes — toutes les cohortes
        <span class="hd-sub">${rows.length} arrêtés depuis ${fmtDate(rows[0].date)}</span></div>
      <div class="chart-legend" id="hs-legend"></div>
      <div class="panel-bd flush">${chartFrame('hs-nets', {
      height: 400, active: r0, hover: 'glissez le curseur pour lire les valeurs',
    })}</div>
      <div class="note">La somme des nets de toutes les cohortes est toujours nulle :
        chaque contrat long a un contrat court en face. Ce graphique montre donc un <b>transfert de risque</b>
        entre catégories d'opérateurs, pas une création de position nette.</div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-hd">Open interest<span class="hd-sub">nombre total de contrats ouverts</span></div>
        <div class="panel-bd flush">${chartFrame('hs-oi', { height: 200, active: r0 })}</div>
      </div>
      <div class="panel">
        <div class="panel-hd">Concentration des 4 premiers<span class="hd-sub">% du net, par côté</span></div>
        <div class="panel-bd flush">${chartFrame('hs-conc', { height: 200, active: r0 })}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-hd">COT index du positionnement spéculatif
        <span class="hd-sub">0 = plancher de la fenêtre · 100 = sommet</span></div>
      <div class="panel-bd flush">${chartFrame('hs-idx', { height: 220, active: r0 })}</div>
      <div class="note">Borné entre 0 et 100, l'index reste lisible quand l'open interest change d'échelle
        au fil des années — contrairement au net brut.</div>
    </div>`;

  const series = cohorts.map((c) => ({
    label: c.short, color: c.color,
    data: Metrics.series(rows, c.key, 'net'),
    scale: 'left', width: 1.5,
  }));
  const priceRows = state.joined.length
    ? state.joined.map((p) => ({ ts: p.ts, value: p.price })) : [];
  if (priceRows.length) {
    series.push({ label: 'Prix', color: '#8892a0', data: priceRows, scale: 'right', width: 1, dashed: true, precision: 2, minMove: 0.01 });
  }

  $('#hs-legend').innerHTML = series.map((s) =>
    `<span class="cl-item"><i class="cl-swatch" style="background:${s.color}"></i>${escapeHtml(s.label)}</span>`).join('');

  Charts.timeSeries($('#hs-nets'), series, {
    id: 'hs-nets', height: 400, zeroLine: true, range: r0,
    onCrosshair: (info) => {
      const el = $('#hs-nets-hover');
      if (!el) return;
      if (!info) { el.textContent = 'glissez le curseur pour lire les valeurs'; return; }
      el.innerHTML = info.values.filter((v) => v.value != null)
        .map((v) => `<span style="color:${v.color}">${escapeHtml(v.label)}</span> <b>${fmtInt(v.value)}</b>`).join(' · ');
    },
  });

  Charts.timeSeries($('#hs-oi'),
    [{ label: 'OI', color: '#6f8fb0', data: Metrics.seriesOf(rows, (r) => r.oi), scale: 'left', type: 'area' }],
    { id: 'hs-oi', height: 200, range: r0 });

  Charts.timeSeries($('#hs-conc'), [
    { label: 'Longs', color: '#2ebd85', data: Metrics.seriesOf(rows, (r) => r.conc.net4Long), scale: 'left', precision: 1, minMove: 0.1 },
    { label: 'Courts', color: '#f6465d', data: Metrics.seriesOf(rows, (r) => r.conc.net4Short), scale: 'left', precision: 1, minMove: 0.1 },
  ], { id: 'hs-conc', height: 200, range: r0 });

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
    [{ label: 'COT index 52 sem.', color: '#d9a441', data: idxSeries, scale: 'left', type: 'area', precision: 0 }],
    { id: 'hs-idx', height: 220, range: r0 });
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
    return `<tr class="clickable" data-cohort="${c.key}" title="${escapeHtml(c.desc)} — cliquer pour le détail">
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
        <div class="panel-bd flush">${chartFrame('rt-chart', {
      height: 340, active: initialRange(spread.series.length),
    })}</div>
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

    const tail = spread.series;
    Charts.timeSeries($('#rt-chart'), [
      { label: 'Or', color: '#d9a441', data: tail.map((p) => ({ ts: p.ts, value: p.gold })), scale: 'left', precision: 0 },
      { label: 'Argent', color: '#9fb0c0', data: tail.map((p) => ({ ts: p.ts, value: p.silver })), scale: 'left', precision: 0 },
      { label: 'Écart', color: '#8e7ab8', data: tail.map((p) => ({ ts: p.ts, value: p.value })), scale: 'right', width: 1.5, precision: 0 },
    ], { id: 'rt-chart', height: 340, range: initialRange(tail.length) });
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
    return `<tr class="clickable" data-macro="${escapeHtml(s.id)}" title="${escapeHtml(s.desc || '')} — cliquer pour le détail">
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

const CAT_LABEL = {
  metaux: 'Or & Argent', 'banques-centrales': 'Banques centrales',
  recherche: 'Recherche', macro: 'Macro & taux',
  geopolitique: 'Géopolitique', mines: 'Mines & physique',
};

function newsListHtml(items, { showCat = false } = {}) {
  if (!items.length) {
    return `<div class="news-empty">Aucune dépêche dans cette catégorie.<br>
      Le fil est rafraîchi deux fois par jour par le workflow « instantanés de marché ».</div>`;
  }
  return `<div class="news-list">${items.map((n) => `
    <div class="news-item">
      <a class="news-t" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)}</a>
      ${n.summary ? `<div class="news-s">${escapeHtml(n.summary)}</div>` : ''}
      <div class="news-m">
        <span class="news-src">${escapeHtml(n.source)}</span>
        <span>${n.published ? relTime(n.published) : ''}</span>
        ${showCat && n.category ? `<span class="news-tag cat-${escapeHtml(n.category)}">${escapeHtml(CAT_LABEL[n.category] || n.category)}</span>` : ''}
        ${(n.tags || []).slice(0, 3).map((t) => `<span class="news-tag">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>`).join('')}</div>`;
}

/* ═══════════════ Vue : actualité ═══════════════
   Le fil est francophone et rangé par catégorie. Deux lectures : « À la
   une » croise les six catégories dans l'ordre chronologique, et chaque
   onglet isole une catégorie. Les catégories viennent du collecteur,
   décomptes compris — l'écran ne réinvente aucun classement. */

function renderNews(host) {
  const cats = Macro.newsCategories();
  const total = Macro.news ? Macro.news.items.length : 0;
  const sel = state.newsCat || 'all';
  const items = Macro.newsItems({ category: sel, limit: 80 });
  const cur = cats.find((c) => c.key === sel);

  const tabs = [
    `<button class="nb${sel === 'all' ? ' on' : ''}" data-cat="all">À la une
       <i>${total}</i></button>`,
    ...cats.map((c) => `<button class="nb${sel === c.key ? ' on' : ''}" data-cat="${c.key}">
       ${escapeHtml(c.label)}<i>${c.count}</i></button>`),
  ].join('');

  /* aperçu par catégorie, visible seulement sur « À la une » */
  const digest = sel !== 'all' ? '' : `
    <div class="grid-2">${Macro.newsByCategory(4).map((c) => `
      <div class="panel">
        <div class="panel-hd">${escapeHtml(c.label)}
          <span class="hd-sub">${c.count} dépêche${c.count > 1 ? 's' : ''}</span></div>
        <div class="panel-bd flush">${newsListHtml(c.items)}</div>
        <div class="note">${escapeHtml(c.desc || '')}</div>
      </div>`).join('')}</div>`;

  host.innerHTML = `
    <div class="panel">
      <div class="panel-hd">
        <span>Fil d'actualité — presse francophone<span class="hd-sub" style="margin-left:9px">
          ${Macro.news ? `${total} dépêches retenues · ${relTime(Macro.news.generated)}` : 'indisponible'}</span></span>
      </div>
      <div class="news-tabs" id="news-cats">${tabs}</div>
      ${cur ? `<div class="news-desc">${escapeHtml(cur.desc)}</div>` : ''}
      <div class="panel-bd flush">${newsListHtml(items, { showCat: sel === 'all' })}</div>
      <div class="note">Sources : Google Actualités en français restreint à la presse
        économique francophone (Les Échos, Boursorama, Zonebourse, La Tribune, Le Figaro,
        L'Écho, Le Temps…) et les dépêches de fr.investing.com. Le tri par catégorie et le
        score de pertinence sont des heuristiques de mots-clés, volontairement simples :
        l'interprétation revient à l'agent, panneau de droite.</div>
    </div>
    ${digest}`;

  $$('#news-cats button').forEach((b) => {
    b.onclick = () => { state.newsCat = b.dataset.cat; render(); };
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
  /* échelles de temps des graphiques — délégué, les boutons naissent
     et meurent avec chaque rendu */
  wireChartRanges($('#main'));
  wireChartRanges($('#drawer-bd'));

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
  const showAgent = (on) => {
    $('#agent-dock').classList.toggle('collapsed', !on);
    $('#agent-reopen').classList.toggle('hidden', on);
  };
  $('#agent-collapse').onclick = () => showAgent(false);
  $('#agent-reopen').onclick = () => showAgent(true);

  /* Sur téléphone l'agent s'affiche en plein écran : il démarre replié,
     sinon il masquerait le poste dès l'ouverture de la page. */
  if (window.matchMedia('(max-width: 900px)').matches) {
    showAgent(false);
    $('#agent-reopen').textContent = 'AGENT IA';
  }

  /* tiroir détaillé — délégation : les vues sont redessinées à chaque
     changement d'état, donc on écoute au niveau du conteneur plutôt que
     de recâbler des poignées à chaque rendu */
  $('#main').addEventListener('click', (e) => {
    const co = e.target.closest('[data-cohort]');
    if (co) { openCohortDrawer(co.dataset.cohort); return; }
    const mc = e.target.closest('[data-macro]');
    if (mc) openMacroDrawer(mc.dataset.macro);
  });
  $('#drawer-x').onclick = closeDrawer;
  $('#drawer-overlay').onclick = (e) => { if (e.target.id === 'drawer-overlay') closeDrawer(); };

  /* modal */
  $('#modal-x').onclick = closeModal;
  $('#modal-overlay').onclick = (e) => { if (e.target.id === 'modal-overlay') closeModal(); };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#drawer-overlay').classList.contains('hidden')) closeDrawer();
    else if (!$('#modal-overlay').classList.contains('hidden')) closeModal();
  });
}

document.addEventListener('DOMContentLoaded', boot);
