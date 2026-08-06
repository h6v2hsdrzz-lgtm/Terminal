/* ════════════════════════════════════════════════════════════
   analysis.js — Poste d'analyse du compte OKX.
   Synchronise l'historique (API privée + imports CSV), calcule
   les statistiques (analytics.js) et rend les sept vues :
   Vue d'ensemble · Performance · Trades · Répartition ·
   Comportement · Compte · Coach IA.

   Règles graphiques appliquées (voir docs/) :
     • polarité gain/perte = paire divergente + gris neutre au centre,
       jamais la couleur seule → signe, sens de la barre et valeur
       chiffrée accompagnent systématiquement la teinte
     • une seule ligne de filtres, au-dessus de tout ce qu'elle porte
     • marques fines, grille pleine d'un cran au-dessus du fond
     • chaque graphique a son équivalent tabulaire
   ════════════════════════════════════════════════════════════ */
'use strict';

const VIZ = {
  pos: '#4ade9f',        // gain — séparation CVD validée face à neg (ΔE 18.9 deutan)
  neg: '#e2394f',        // perte
  posSoft: 'rgba(74,222,159,.16)',
  negSoft: 'rgba(226,57,79,.16)',
  neutral: '#2a323d',    // milieu neutre de l'échelle divergente
  grid: '#161b22',
  axis: '#79828e',
};

const Analysis = {
  open: false,
  client: null,
  liveAccount: null,
  provider: null,
  trades: [],
  filtered: [],
  stats: null,
  meta: { lastSync: 0, uid: '', unmatched: null, openLots: [], sources: {} },
  balances: [],
  transfers: { deposits: [], withdrawals: [] },
  filters: { period: 'all', instType: 'all', symbol: 'all', side: 'all', result: 'all' },
  pane: 'over',
  charts: {},
  sortKey: 'closeTime',
  sortDir: -1,
  busy: false,

  /* ═══════════ cycle de vie ═══════════ */

  async attach(client, provider, liveAccount) {
    this.client = client;
    this.provider = provider;
    this.liveAccount = liveAccount;
    const saved = await Store.get('okx-trades-' + (this.meta.uid || 'default'), null);
    if (saved && saved.trades) {
      this.trades = saved.trades;
      this.meta.lastSync = saved.lastSync || 0;
      this.meta.sources = saved.sources || {};
    }
    this.recompute();
  },

  show(pane) {
    this.open = true;
    $('terminal').classList.add('an-mode');
    $('analysis').classList.remove('hidden');
    $('btn-analysis').classList.add('on');
    if (pane) this.pane = pane;
    this.selectPane(this.pane);
    if (!this.trades.length && this.client && !this.meta.lastSync) this.sync();
  },

  hide() {
    this.open = false;
    $('analysis').classList.add('hidden');
    $('terminal').classList.remove('an-mode');
    $('btn-analysis').classList.remove('on');
  },

  toggle() { this.open ? this.hide() : this.show(); },

  /* ═══════════ synchronisation ═══════════ */

  progress(msg, pct) {
    const el = $('an-progress');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `<div class="anp-bar"><i style="width:${Math.max(2, Math.min(100, pct || 0))}%"></i></div>
      <span>${escHtml(msg)}</span>`;
  },
  progressDone(msg, cls) {
    const el = $('an-progress');
    if (!el) return;
    if (msg) { el.innerHTML = `<span class="${cls || ''}">${escHtml(msg)}</span>`; setTimeout(() => el.classList.add('hidden'), 6000); }
    else el.classList.add('hidden');
  },

  async sync({ full = false } = {}) {
    if (!this.client) { toast('Analyse', 'Connectez-vous avec une clé API OKX pour synchroniser.'); return; }
    if (this.busy) return;
    this.busy = true;
    $('an-sync').disabled = true;
    const since = full ? 0 : this.meta.lastSync;
    const collected = [];
    const errors = [];
    const instruments = this.provider ? this.provider.instruments : new Map();

    try {
      this.progress('Vérification de la clé API…', 3);
      const cfg = await this.client.verify();
      this.meta.uid = cfg.uid || 'default';
      this.meta.acct = cfg;

      /* 1. positions clôturées (dérivés & marge) — endpoint le plus bridé */
      this.progress('Positions clôturées (OKX limite à 1 page / 10 s)…', 10);
      try {
        const rows = await this.client.positionsHistory({
          since,
          onProgress: ({ count, page }) => this.progress(`Positions clôturées — ${count} trades (page ${page})…`, 10 + Math.min(35, page * 4)),
        });
        collected.push(...Trades.fromPositionsHistory(rows, instruments));
        this.meta.sources.positions = rows.length;
      } catch (e) { errors.push('Positions : ' + e.message); }

      /* 2. exécutions spot → reconstruction FIFO.
         Pas de synchro incrémentale ici : l'appariement FIFO doit repartir
         du premier achat, sinon les ventes récentes n'ont plus de lot en face. */
      this.progress('Exécutions spot…', 50);
      try {
        const allFills = await this.client.fills({
          instType: 'SPOT', since: 0,
          onProgress: ({ count }) => this.progress(`Exécutions spot — ${count}…`, 55),
        });
        const spot = Trades.fromSpotFills(allFills, instruments);
        collected.push(...spot);
        this.meta.unmatched = spot.unmatched;
        this.meta.openLots = spot.openLots || [];
        this.meta.sources.fills = allFills.length;
      } catch (e) { errors.push('Spot : ' + e.message); }

      /* 3. exécutions marge (appariées comme le spot si absentes des positions) */
      this.progress('Exécutions marge…', 65);
      try {
        const m = await this.client.fills({ instType: 'MARGIN', since: 0 });
        if (m.length) {
          const mt = Trades.fromSpotFills(m, instruments).map((t) => ({ ...t, instType: 'MARGIN' }));
          collected.push(...mt);
          this.meta.sources.marginFills = m.length;
        }
      } catch { /* compte sans marge : normal */ }

      /* 4. mouvements de fonds — indispensables pour lire la courbe de capital */
      this.progress('Dépôts et retraits…', 80);
      try {
        const [dep, wit] = await Promise.all([
          this.client.deposits({ since: 0 }).catch(() => []),
          this.client.withdrawals({ since: 0 }).catch(() => []),
        ]);
        this.transfers = {
          deposits: dep.map((d) => ({ ts: +d.ts, ccy: d.ccy, amt: +d.amt, state: d.state })),
          withdrawals: wit.map((d) => ({ ts: +d.ts, ccy: d.ccy, amt: +d.amt, state: d.state })),
        };
      } catch {}

      /* 5. soldes */
      this.progress('Soldes du compte…', 92);
      if (this.liveAccount) { await this.liveAccount.refresh().catch(() => {}); this.balances = this.liveAccount.balances; }

      this.trades = Trades.merge(this.trades, collected);
      this.meta.lastSync = Date.now();
      await this.persist();
      this.recompute();
      this.render();

      const msg = `${this.trades.length} trades — dernière synchro ${new Date().toLocaleTimeString('fr-FR')}`;
      this.progressDone(errors.length ? `${msg} · ${errors.join(' · ')}` : msg, errors.length ? 'warn' : 'ok');
    } catch (e) {
      this.progressDone('Échec : ' + e.message, 'err');
    } finally {
      this.busy = false;
      $('an-sync').disabled = false;
    }
  },

  async persist() {
    await Store.set('okx-trades-' + (this.meta.uid || 'default'), {
      trades: this.trades, lastSync: this.meta.lastSync, sources: this.meta.sources,
    });
  },

  /* ═══════════ filtres & calcul ═══════════ */

  recompute() {
    const f = this.filters;
    const now = Date.now();
    const spans = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
    let list = this.trades;
    if (spans[f.period]) {
      const from = now - spans[f.period] * 86400000;
      list = list.filter((t) => t.closeTime >= from);
    } else if (f.period === 'ytd') {
      const jan = new Date(new Date().getFullYear(), 0, 1).getTime();
      list = list.filter((t) => t.closeTime >= jan);
    }
    if (f.instType !== 'all') list = list.filter((t) => t.instType === f.instType);
    if (f.symbol !== 'all') list = list.filter((t) => t.instId === f.symbol);
    if (f.side !== 'all') list = list.filter((t) => t.side === f.side);
    if (f.result === 'win') list = list.filter((t) => t.net > 0);
    if (f.result === 'loss') list = list.filter((t) => t.net < 0);

    this.filtered = list;
    // capital de référence : équité réelle du compte moins le résultat cumulé
    let base = 0;
    if (this.liveAccount && this.liveAccount.summary.equity > 0) {
      base = this.liveAccount.summary.equity - Analytics.sum(list.map((t) => t.net));
    }
    this.stats = Analytics.compute(list, { initialEquity: base > 0 ? base : 0 });
  },

  setFilter(k, v) {
    this.filters[k] = v;
    this.recompute();
    this.render();
  },

  /* ═══════════ rendu ═══════════ */

  selectPane(name) {
    this.pane = name;
    document.querySelectorAll('#an-nav .an-tab').forEach((b) => b.classList.toggle('on', b.dataset.an === name));
    this.render();
  },

  render() {
    this.renderFilters();
    const s = this.stats;
    const body = $('an-body');
    if (!this.trades.length) { body.innerHTML = this.emptyState(); this.bindEmpty(); return; }

    const R = {
      over: () => this.paneOverview(s),
      perf: () => this.panePerf(s),
      trades: () => this.paneTrades(s),
      split: () => this.paneSplit(s),
      behav: () => this.paneBehaviour(s),
      acct: () => this.paneAccount(s),
      coach: () => this.paneCoach(s),
    };
    body.innerHTML = (R[this.pane] || R.over)();
    this.bindPane();
  },

  emptyState() {
    const hasKey = !!this.client;
    return `<div class="an-empty">
      <h2>Aucun trade chargé</h2>
      <p>${hasKey
        ? 'Lancez une synchronisation pour récupérer votre historique OKX (positions clôturées, exécutions spot, dépôts et retraits).'
        : 'Connectez-vous avec une clé API OKX en lecture seule, ou importez un export CSV OKX.'}</p>
      <div class="an-empty-btns">
        ${hasKey ? '<button id="ane-sync" class="an-primary">Synchroniser maintenant</button>' : ''}
        <button id="ane-import">Importer un CSV OKX</button>
      </div>
      <div class="an-note">
        L'API OKX ne sert que <b>3 mois</b> d'historique. Pour analyser au-delà, exportez
        « Historique des positions » ou « Historique des ordres » depuis okx.com et importez le
        fichier ici : les deux sources sont fusionnées et dédoublonnées.
      </div>
    </div>`;
  },

  bindEmpty() {
    const s = $('ane-sync'); if (s) s.onclick = () => this.sync({ full: true });
    const i = $('ane-import'); if (i) i.onclick = () => this.pickCsv();
  },

  renderFilters() {
    const f = this.filters;
    const symbols = [...new Set(this.trades.map((t) => t.instId))].sort();
    const types = [...new Set(this.trades.map((t) => t.instType))].sort();
    const btn = (k, v, label) => `<button class="anf-btn${f[k] === v ? ' on' : ''}" data-f="${k}" data-v="${v}">${label}</button>`;
    $('an-filters').innerHTML = `
      <div class="anf-group" role="group" aria-label="Période">
        ${btn('period', '7d', '7 j')}${btn('period', '30d', '30 j')}${btn('period', '90d', '90 j')}
        ${btn('period', 'ytd', 'Année')}${btn('period', 'all', 'Tout')}
      </div>
      <div class="anf-group">
        ${btn('side', 'all', 'Tous sens')}${btn('side', 'long', 'Achat')}${btn('side', 'short', 'Vente')}
      </div>
      <div class="anf-group">
        ${btn('result', 'all', 'Tous')}${btn('result', 'win', 'Gagnants')}${btn('result', 'loss', 'Perdants')}
      </div>
      <select class="anf-sel" data-f="instType">
        <option value="all">Tous produits</option>
        ${types.map((t) => `<option value="${escHtml(t)}"${f.instType === t ? ' selected' : ''}>${escHtml(t)}</option>`).join('')}
      </select>
      <select class="anf-sel" data-f="symbol">
        <option value="all">Tous instruments (${symbols.length})</option>
        ${symbols.map((t) => `<option value="${escHtml(t)}"${f.symbol === t ? ' selected' : ''}>${escHtml(t)}</option>`).join('')}
      </select>
      <span class="anf-count">${this.filtered.length} / ${this.trades.length} trades</span>`;

    $('an-filters').querySelectorAll('.anf-btn').forEach((b) => {
      b.onclick = () => this.setFilter(b.dataset.f, b.dataset.v);
    });
    $('an-filters').querySelectorAll('.anf-sel').forEach((sel) => {
      sel.onchange = () => this.setFilter(sel.dataset.f, sel.value);
    });
  },

  /* ═══════════ briques de rendu ═══════════ */

  tile(label, value, opts = {}) {
    const cls = opts.tone === 'auto' ? (opts.raw >= 0 ? 'pos' : 'neg') : (opts.tone || '');
    const arrow = opts.tone === 'auto' ? (opts.raw >= 0 ? '▲ ' : '▼ ') : '';
    return `<div class="an-tile${opts.hero ? ' hero' : ''}">
      <label>${escHtml(label)}</label>
      <span class="ant-val ${cls}">${arrow}${value}</span>
      ${opts.sub ? `<em class="ant-sub">${opts.sub}</em>` : ''}
    </div>`;
  },

  /* barre divergente : le sens (gauche/droite) porte le signe, la valeur est écrite */
  divBar(value, max, label) {
    const w = max > 0 ? Math.min(50, Math.abs(value) / max * 50) : 0;
    const pos = value >= 0;
    return `<div class="dbar" title="${escHtml(label || '')}">
      <div class="dbar-track">
        <i class="${pos ? 'dbar-pos' : 'dbar-neg'}" style="${pos ? 'left:50%' : `right:50%`};width:${w}%"></i>
        <b class="dbar-zero"></b>
      </div>
    </div>`;
  },

  money(v, d = 2) {
    if (v == null || !isFinite(v)) return '—';
    const s = Math.abs(v) >= 10000 ? fmtNum(v, 0) : fmtNum(v, d);
    return (v > 0 ? '+' : '') + s;
  },
  pct(v, d = 1) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(d) + '%';
  },
  ratio(v, d = 2) {
    if (v === Infinity) return '∞';
    if (v == null || !isFinite(v)) return '—';
    return v.toFixed(d);
  },
  date(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return `${pd(d.getDate())}/${pd(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${pd(d.getHours())}:${pd(d.getMinutes())}`;
  },

  /* tableau générique de répartition, avec barre divergente intégrée */
  breakdown(rows, title, opts = {}) {
    if (!rows.length) return '';
    const max = Math.max(...rows.map((r) => Math.abs(r.net)), 1);
    const body = rows.map((r) => `
      <tr data-drill="${escHtml(opts.drill || '')}" data-key="${escHtml(String(r.key))}">
        <td class="sym">${escHtml(r.label)}</td>
        <td class="num">${r.n}</td>
        <td class="num">${r.winRate.toFixed(0)}%</td>
        <td class="num">${this.ratio(r.profitFactor)}</td>
        <td class="num">${this.money(r.expectancy)}</td>
        <td class="dbar-cell">${this.divBar(r.net, max)}</td>
        <td class="num ${r.net >= 0 ? 'pos' : 'neg'}">${this.money(r.net)}</td>
      </tr>`).join('');
    /* toujours pleine largeur : à 370 px la dernière colonne se ferait tronquer */
    return `<div class="an-card wide">
      <div class="an-card-hd">${escHtml(title)}${opts.hint ? `<em>${escHtml(opts.hint)}</em>` : ''}</div>
      <div class="an-scroll-x">
        <table class="an-table breakdown">
          <thead><tr>
            <th>${escHtml(opts.col || 'Catégorie')}</th><th class="num">Trades</th><th class="num">Réussite</th>
            <th class="num">PF</th><th class="num">Espérance</th><th>P/L net</th><th class="num">Total</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  },

  /* ═══════════ vue 1 — vue d'ensemble ═══════════ */

  paneOverview(s) {
    const c = s.core;
    const per = s.period.from
      ? `${this.date(s.period.from)} → ${this.date(s.period.to)} · ${Math.round(s.spanDays)} jours`
      : '';

    const insights = s.behaviour.slice(0, 3).map((b) => `
      <li class="ins ${b.severity}">
        <b>${escHtml(b.title)}</b>
        <span>${escHtml(b.detail)}</span>
      </li>`).join('');

    return `
    <div class="an-hero-row">
      <div class="an-hero">
        <label>Résultat net cumulé — frais et financement inclus</label>
        <div class="an-hero-val ${c.net >= 0 ? 'pos' : 'neg'}">${c.net >= 0 ? '▲' : '▼'} ${this.money(c.net)} <em>USDT</em></div>
        <div class="an-hero-sub">${escHtml(per)}</div>
      </div>
      <div class="an-tiles">
        ${this.tile('Trades', String(c.n), { sub: `${c.wins} gagnants · ${c.losses} perdants` })}
        ${this.tile('Taux de réussite', c.winRate.toFixed(1) + '%', { sub: `payoff ${this.ratio(c.payoff)}×` })}
        ${this.tile('Profit factor', this.ratio(c.profitFactor), { tone: c.profitFactor >= 1 ? 'pos' : 'neg', sub: 'gains bruts / pertes brutes' })}
        ${this.tile('Espérance / trade', this.money(c.expectancy), { tone: 'auto', raw: c.expectancy, sub: `${this.ratio(s.expectancyR)} R` })}
        ${this.tile('Drawdown max', '−' + fmtNum(s.equity.maxDD, 0), { tone: 'neg', sub: s.equity.maxDDPct ? s.equity.maxDDPct.toFixed(1) + '% du capital' : '' })}
        ${this.tile('Frais payés', '−' + fmtNum(c.fees, 0), { tone: 'neg', sub: c.funding ? `financement ${this.money(c.funding, 0)}` : '' })}
      </div>
    </div>

    <div class="an-grid">
      <div class="an-card wide">
        <div class="an-card-hd">Courbe de capital
          <em>résultat cumulé net · <span id="eq-read"></span></em>
        </div>
        <div id="an-eq-chart" class="an-chart"></div>
      </div>

      <div class="an-card wide">
        <div class="an-card-hd">Drawdown <em>écart au plus haut, en % du capital</em></div>
        <div id="an-dd-chart" class="an-chart short"></div>
      </div>

      <div class="an-card wide">
        <div class="an-card-hd">Calendrier des résultats <em>P/L net par jour</em></div>
        ${this.calendar(s)}
      </div>

      <div class="an-card">
        <div class="an-card-hd">Points saillants</div>
        <ul class="ins-list">${insights || '<li class="ins ok"><b>Pas encore assez de trades</b><span>Les signaux comportementaux apparaissent à partir d\'une dizaine de trades.</span></li>'}</ul>
      </div>

      ${this.breakdown(s.bySymbol.slice(0, 12), 'Résultat par instrument', { col: 'Instrument', drill: 'symbol', hint: 'cliquez une ligne pour filtrer' })}
    </div>`;
  },

  /* calendrier mensuel — valeur chiffrée dans chaque case : jamais la couleur seule */
  calendar(s) {
    const byMonth = new Map();
    for (const d of s.daily) {
      const k = d.key.slice(0, 7);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(d);
    }
    const months = [...byMonth.keys()].sort().slice(-6);
    if (!months.length) return '<div class="an-note">Aucune journée à afficher.</div>';
    const maxAbs = Math.max(...s.daily.map((d) => Math.abs(d.net)), 1);
    const MN = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

    const blocks = months.map((mk) => {
      const days = byMonth.get(mk);
      const [y, m] = mk.split('-').map(Number);
      const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lundi = 0
      const total = Analytics.sum(days.map((d) => d.net));
      const cells = [];
      for (let i = 0; i < firstDow; i++) cells.push('<i class="cal-pad"></i>');
      for (const d of days) {
        const day = new Date(d.t).getDate();
        const intensity = Math.min(1, Math.abs(d.net) / maxAbs);
        const bg = d.n === 0 ? 'transparent'
          : d.net >= 0 ? `rgba(74,222,159,${(0.12 + intensity * 0.62).toFixed(3)})`
            : `rgba(226,57,79,${(0.12 + intensity * 0.62).toFixed(3)})`;
        const label = d.n ? `${day} ${MN[m - 1]} : ${this.money(d.net)} sur ${d.n} trade(s)` : `${day} ${MN[m - 1]} : aucun trade`;
        cells.push(`<i class="cal-day${d.n ? '' : ' empty'}" style="background:${bg}" title="${escHtml(label)}">
          <u>${day}</u>${d.n ? `<b>${Math.abs(d.net) >= 1000 ? (d.net / 1000).toFixed(1) + 'k' : d.net.toFixed(0)}</b>` : ''}</i>`);
      }
      return `<div class="cal-month">
        <div class="cal-hd"><span>${MN[m - 1]} ${y}</span><b class="${total >= 0 ? 'pos' : 'neg'}">${this.money(total, 0)}</b></div>
        <div class="cal-dow"><i>L</i><i>M</i><i>M</i><i>J</i><i>V</i><i>S</i><i>D</i></div>
        <div class="cal-grid">${cells.join('')}</div>
      </div>`;
    }).join('');
    return `<div class="cal-wrap">${blocks}</div>`;
  },

  /* ═══════════ vue 2 — performance ═══════════ */

  panePerf(s) {
    const c = s.core, r = s.risk, e = s.equity;
    const row = (label, value, cls, note) =>
      `<tr><td>${escHtml(label)}</td><td class="num ${cls || ''}">${value}</td><td class="muted">${note || ''}</td></tr>`;

    const dist = this.histogram(s);

    return `
    <div class="an-grid">
      <div class="an-card">
        <div class="an-card-hd">Résultat</div>
        <table class="an-table metrics">
          ${row('P/L net', this.money(c.net), c.net >= 0 ? 'pos' : 'neg', 'frais et financement déduits')}
          ${row('P/L brut', this.money(c.net + c.fees - c.funding), '', 'avant frais')}
          ${row('Frais totaux', '−' + fmtNum(c.fees), 'neg', `${(c.fees / (Math.abs(c.net) + c.fees) * 100 || 0).toFixed(1)}% du résultat brut`)}
          ${row('Financement (funding)', this.money(c.funding), c.funding >= 0 ? 'pos' : 'neg', 'perpétuels')}
          ${row('Volume traité', fmtCompact(c.volume) + ' $', '', 'somme des notionnels')}
          ${row('Rendement sur capital', this.pct(s.totalReturnPct), s.totalReturnPct >= 0 ? 'pos' : 'neg', `base ${fmtNum(s.initialEquity, 0)} USDT`)}
        </table>
      </div>

      <div class="an-card">
        <div class="an-card-hd">Qualité du système</div>
        <table class="an-table metrics">
          ${row('Taux de réussite', c.winRate.toFixed(1) + '%', '', `${c.wins} / ${c.n}`)}
          ${row('Profit factor', this.ratio(c.profitFactor), c.profitFactor >= 1 ? 'pos' : 'neg', '> 1,5 = solide')}
          ${row('Payoff (gain/perte moyen)', this.ratio(c.payoff), '', `${this.money(c.avgWin)} vs −${fmtNum(c.avgLoss)}`)}
          ${row('Espérance par trade', this.money(c.expectancy), c.expectancy >= 0 ? 'pos' : 'neg', `${this.ratio(s.expectancyR)} R`)}
          ${row('SQN', this.ratio(s.sqn), s.sqn >= 2 ? 'pos' : '', '2–3 bon · > 3 excellent')}
          ${row('Kelly', s.kelly.toFixed(1) + '%', '', 'fraction théorique optimale — ne pas suivre en l\'état')}
          ${row('Écart-type par trade', fmtNum(s.stdev), '', 'dispersion des résultats')}
        </table>
      </div>

      <div class="an-card">
        <div class="an-card-hd">Risque</div>
        <table class="an-table metrics">
          ${row('Drawdown max', '−' + fmtNum(e.maxDD), 'neg', e.maxDDPct.toFixed(1) + '% du capital')}
          ${row('Drawdown actuel', e.currentDD > 0 ? '−' + fmtNum(e.currentDD) : '0', e.currentDD > 0 ? 'neg' : 'pos', e.currentDD > 0 ? e.currentDDPct.toFixed(1) + '%' : 'au plus haut')}
          ${row('Durée max sous l\'eau', Analytics.fmtDur(e.maxDDDur), '', 'temps pour revenir au plus haut')}
          ${row('Recovery factor', this.ratio(s.recovery), s.recovery >= 2 ? 'pos' : '', 'net / drawdown max')}
          ${row('Ulcer index', this.ratio(e.ulcer), '', 'profondeur × durée des baisses')}
          ${row('Sharpe (annualisé)', this.ratio(r.sharpe), r.sharpe >= 1 ? 'pos' : '', 'P/L quotidiens, 365 j')}
          ${row('Sortino (annualisé)', this.ratio(r.sortino), r.sortino >= 1.5 ? 'pos' : '', 'ne pénalise que la volatilité baissière')}
          ${row('Calmar', this.ratio(r.calmar), r.calmar >= 1 ? 'pos' : '', 'rendement annualisé / drawdown max')}
          ${row('Volatilité annualisée', r.annualVol.toFixed(1) + '%', '', '')}
        </table>
      </div>

      <div class="an-card">
        <div class="an-card-hd">Extrêmes et séries</div>
        <table class="an-table metrics">
          ${row('Meilleur trade', this.money(c.best), 'pos', '')}
          ${row('Pire trade', this.money(c.worst), 'neg', '')}
          ${row('Médiane', this.money(s.median), s.median >= 0 ? 'pos' : 'neg', '50% des trades en dessous')}
          ${row('5e percentile', this.money(s.p05), 'neg', '1 trade sur 20 est pire')}
          ${row('95e percentile', this.money(s.p95), 'pos', '1 trade sur 20 est meilleur')}
          ${row('Série de gains max', String(s.streaks.maxWin), 'pos', this.money(s.streaks.bestRun) + ' cumulés')}
          ${row('Série de pertes max', String(s.streaks.maxLoss), 'neg', this.money(s.streaks.worstRun) + ' cumulés')}
          ${row('Série en cours', (s.streaks.current > 0 ? '+' : '') + s.streaks.current, s.streaks.current >= 0 ? 'pos' : 'neg', s.streaks.current >= 0 ? 'gains consécutifs' : 'pertes consécutives')}
          ${row('Durée moyenne', Analytics.fmtDur(c.avgDuration), '', '')}
          ${row('Jours actifs', `${r.tradingDays} / ${r.days}`, '', 'jours avec au moins un trade')}
        </table>
      </div>

      <div class="an-card wide">
        <div class="an-card-hd">Distribution des résultats <em>nombre de trades par tranche de P/L net</em></div>
        ${dist}
      </div>

      ${this.breakdown(s.byMonth.map((m) => ({ ...m, label: m.key })), 'Résultat par mois', { col: 'Mois', wide: true })}
    </div>`;
  },

  histogram(s) {
    const nets = s.trades.map((t) => t.net);
    if (nets.length < 4) return '<div class="an-note">Trop peu de trades pour une distribution.</div>';
    const lo = Math.min(...nets), hi = Math.max(...nets);
    const bins = 17;
    const step = (hi - lo) / bins || 1;
    const counts = new Array(bins).fill(0);
    for (const n of nets) counts[Math.min(bins - 1, Math.max(0, Math.floor((n - lo) / step)))]++;
    const maxC = Math.max(...counts, 1);
    const cols = counts.map((cnt, i) => {
      const from = lo + i * step, to = from + step;
      const mid = (from + to) / 2;
      const h = cnt / maxC * 100;
      // étiquette seulement là où la barre est assez haute pour la contenir
      const lbl = h >= 45 ? `<u>${cnt}</u>` : '';
      return `<i class="${mid >= 0 ? 'hg-pos' : 'hg-neg'}" style="height:${h}%"
        title="${cnt} trade(s) entre ${fmtNum(from, 0)} et ${fmtNum(to, 0)}">${lbl}</i>`;
    }).join('');
    return `<div class="hg">
      <div class="hg-bars">${cols}</div>
      <div class="hg-axis"><span>${fmtNum(lo, 0)}</span><span class="hg-zero">0</span><span>${fmtNum(hi, 0)}</span></div>
    </div>`;
  },

  /* ═══════════ vue 3 — trades ═══════════ */

  paneTrades(s) {
    const dir = this.sortDir, key = this.sortKey;
    const list = [...s.trades].sort((a, b) => {
      const va = a[key], vb = b[key];
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * ((va || 0) - (vb || 0));
    });
    const th = (k, label, cls) =>
      `<th class="${cls || ''} sortable${key === k ? ' sorted' : ''}" data-sort="${k}">${label}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

    const rows = list.slice(0, 500).map((t) => `
      <tr data-key="${escHtml(t.key)}">
        <td class="muted">${this.date(t.closeTime)}</td>
        <td class="sym">${escHtml(t.instId)}</td>
        <td><span class="tag ${t.side}">${t.side === 'long' ? 'Achat' : 'Vente'}</span></td>
        <td class="num">${t.lever > 1 ? t.lever + '×' : '—'}</td>
        <td class="num">${fmtNum(t.qty, t.qty < 1 ? 6 : 3)}</td>
        <td class="num">${fmtNum(t.openPx, t.openPx < 10 ? 5 : 2)}</td>
        <td class="num">${fmtNum(t.closePx, t.closePx < 10 ? 5 : 2)}</td>
        <td class="num muted">${fmtCompact(t.notional)}</td>
        <td class="num muted">${Analytics.fmtDur(t.durationMs)}</td>
        <td class="num muted">−${fmtNum(t.fee, 2)}</td>
        <td class="num ${t.retMargin >= 0 ? 'pos' : 'neg'}">${this.pct(t.retMargin)}</td>
        <td class="num strong ${t.net >= 0 ? 'pos' : 'neg'}">${this.money(t.net)}</td>
        <td>${t.liquidated ? '<span class="tag liq">Liquidé</span>' : `<span class="muted small">${escHtml(t.closeType)}</span>`}</td>
        <td><button class="an-mini" data-chart="${escHtml(t.key)}" title="Afficher ce trade sur le graphique">Graphique</button></td>
      </tr>`).join('');

    return `<div class="an-card wide flush">
      <div class="an-card-hd">Journal des trades
        <em>${s.trades.length} trades${s.trades.length > 500 ? ' — 500 plus récents affichés' : ''} · cliquez une colonne pour trier</em>
        <button id="an-export-csv" class="an-mini right">Exporter en CSV</button>
      </div>
      <div class="an-scroll">
        <table class="an-table trades">
          <thead><tr>
            ${th('closeTime', 'Clôturé')}${th('instId', 'Instrument')}
            <th>Sens</th>${th('lever', 'Levier', 'num')}<th class="num">Qté</th>
            <th class="num">Entrée</th><th class="num">Sortie</th>${th('notional', 'Notionnel', 'num')}
            ${th('durationMs', 'Durée', 'num')}${th('fee', 'Frais', 'num')}
            ${th('retMargin', 'Rendement', 'num')}${th('net', 'P/L net', 'num')}
            <th>Clôture</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  },

  /* ═══════════ vue 4 — répartition ═══════════ */

  paneSplit(s) {
    return `<div class="an-grid">
      ${this.breakdown(s.bySymbol, 'Par instrument', { col: 'Instrument', drill: 'symbol', wide: true, hint: 'cliquez pour filtrer' })}
      ${this.breakdown(s.bySide, 'Par sens', { col: 'Sens' })}
      ${this.breakdown(s.byType, 'Par produit', { col: 'Produit' })}
      ${this.breakdown(s.byHour, 'Par heure d\'entrée', { col: 'Heure locale', wide: true, hint: 'heure de votre machine' })}
      ${this.breakdown(s.byWeekday, 'Par jour de la semaine', { col: 'Jour' })}
      ${this.breakdown(s.byDuration, 'Par durée de détention', { col: 'Durée' })}
      ${this.breakdown(s.byLeverage, 'Par levier', { col: 'Levier' })}
      ${this.breakdown(s.bySize, 'Par taille de position', { col: 'Quartile de notionnel' })}
    </div>`;
  },

  /* ═══════════ vue 5 — comportement ═══════════ */

  paneBehaviour(s) {
    if (!s.behaviour.length) return '<div class="an-note">Pas encore assez de trades pour dégager des tendances comportementales.</div>';
    const cards = s.behaviour.map((b) => {
      const cmp = b.compare != null
        ? `<div class="ins-cmp">Espérance sur ce sous-ensemble : <b class="${b.stat.expectancy >= 0 ? 'pos' : 'neg'}">${this.money(b.stat.expectancy)}</b>
           contre <b>${this.money(s.core.expectancy)}</b> en moyenne
           <span class="${b.compare >= 0 ? 'pos' : 'neg'}">(${this.money(b.compare)} par trade)</span></div>`
        : '';
      const st = b.stat ? `<div class="ins-stats">
          <span>${b.stat.n} trades</span><span>${b.stat.winRate.toFixed(0)}% réussite</span>
          <span class="${b.stat.net >= 0 ? 'pos' : 'neg'}">${this.money(b.stat.net)} au total</span>
        </div>` : '';
      return `<div class="an-card ins-card ${b.severity}">
        <div class="ins-hd"><span class="ins-dot"></span>${escHtml(b.title)}</div>
        <p>${escHtml(b.detail)}</p>${st}${cmp}
      </div>`;
    }).join('');
    return `<div class="an-note lead">Chaque constat compare un sous-ensemble de vos trades au reste de votre activité.
      Un écart d'espérance négatif signale une habitude qui coûte de l'argent.</div>
      <div class="an-grid behav">${cards}</div>`;
  },

  /* ═══════════ vue 6 — compte ═══════════ */

  paneAccount(s) {
    const acc = this.liveAccount;
    const sum = acc ? acc.summary : null;
    const positions = acc ? acc.getPositions() : [];
    const cfg = this.meta.acct || {};

    const posRows = positions.map((p) => `
      <tr>
        <td class="sym">${escHtml(p.symbol)}</td>
        <td><span class="tag ${p.side === 'buy' ? 'long' : 'short'}">${p.side === 'buy' ? 'Achat' : 'Vente'}</span></td>
        <td class="num">${p.lever ? p.lever + '×' : '—'}</td>
        <td class="num">${fmtNum(p.qty, p.qty < 1 ? 6 : 3)}</td>
        <td class="num">${fmtNum(p.entry, p.entry < 10 ? 5 : 2)}</td>
        <td class="num">${fmtNum(p.mark, p.mark < 10 ? 5 : 2)}</td>
        <td class="num ${p.liqPx ? 'neg' : 'muted'}">${p.liqPx ? fmtNum(p.liqPx, p.liqPx < 10 ? 5 : 2) : '—'}</td>
        <td class="num muted">${fmtNum(p.margin, 2)}</td>
        <td class="num muted">${this.money(p.funding, 2)}</td>
        <td class="num strong ${p.pl >= 0 ? 'pos' : 'neg'}">${this.money(p.pl)}</td>
        <td class="num ${p.plPct >= 0 ? 'pos' : 'neg'}">${p.plPct != null ? this.pct(p.plPct) : '—'}</td>
      </tr>`).join('');

    const balRows = (acc ? acc.balances : []).slice(0, 20).map((b) => `
      <tr>
        <td class="sym">${escHtml(b.ccy)}</td>
        <td class="num">${fmtNum(b.eq, b.eq < 1 ? 6 : 4)}</td>
        <td class="num muted">${fmtNum(b.avail, b.avail < 1 ? 6 : 4)}</td>
        <td class="num muted">${b.frozen ? fmtNum(b.frozen, 4) : '—'}</td>
        <td class="num ${b.upl >= 0 ? 'pos' : 'neg'}">${b.upl ? this.money(b.upl) : '—'}</td>
        <td class="num">${fmtNum(b.eqUsd, 2)} $</td>
      </tr>`).join('');

    const dep = Analytics.sum(this.transfers.deposits.map((d) => d.amt));
    const wit = Analytics.sum(this.transfers.withdrawals.map((d) => d.amt));

    return `<div class="an-grid">
      <div class="an-card wide">
        <div class="an-card-hd">Compte OKX ${cfg.uid ? `<em>UID ${escHtml(String(cfg.uid))} · ${escHtml(cfg.perm || '')}</em>` : ''}</div>
        <div class="an-tiles inline">
          ${this.tile('Équité totale', sum ? fmtNum(sum.equity, 2) + ' $' : '—')}
          ${this.tile('Solde (hors latent)', sum ? fmtNum(sum.balance, 2) + ' $' : '—')}
          ${this.tile('P/L latent', sum ? this.money(sum.openPl) : '—', { tone: 'auto', raw: sum ? sum.openPl : 0 })}
          ${this.tile('Positions ouvertes', String(positions.length))}
          ${this.tile('Dépôts cumulés', dep ? fmtNum(dep, 0) : '—', { sub: 'toutes devises confondues' })}
          ${this.tile('Retraits cumulés', wit ? fmtNum(wit, 0) : '—', { sub: 'toutes devises confondues' })}
        </div>
      </div>

      <div class="an-card wide">
        <div class="an-card-hd">Positions ouvertes <em>rafraîchies toutes les 15 s</em></div>
        ${positions.length ? `<table class="an-table">
          <thead><tr><th>Instrument</th><th>Sens</th><th class="num">Levier</th><th class="num">Qté</th>
            <th class="num">Entrée</th><th class="num">Marque</th><th class="num">Liquidation</th>
            <th class="num">Marge</th><th class="num">Funding</th><th class="num">P/L latent</th><th class="num">%</th></tr></thead>
          <tbody>${posRows}</tbody></table>` : '<div class="an-note">Aucune position ouverte.</div>'}
      </div>

      <div class="an-card wide">
        <div class="an-card-hd">Soldes par devise</div>
        ${balRows ? `<table class="an-table">
          <thead><tr><th>Devise</th><th class="num">Équité</th><th class="num">Disponible</th>
          <th class="num">Bloqué</th><th class="num">Latent</th><th class="num">Valeur</th></tr></thead>
          <tbody>${balRows}</tbody></table>` : '<div class="an-note">Aucun solde chargé.</div>'}
      </div>

      <div class="an-card wide">
        <div class="an-card-hd">Données chargées</div>
        <table class="an-table metrics">
          <tr><td>Trades en archive</td><td class="num">${this.trades.length}</td><td class="muted">API + imports CSV, dédoublonnés</td></tr>
          <tr><td>Dernière synchronisation</td><td class="num">${this.meta.lastSync ? this.date(this.meta.lastSync) : '—'}</td><td class="muted"></td></tr>
          <tr><td>Positions clôturées (API)</td><td class="num">${this.meta.sources.positions || 0}</td><td class="muted">dérivés & marge, 3 mois glissants</td></tr>
          <tr><td>Exécutions spot (API)</td><td class="num">${this.meta.sources.fills || 0}</td><td class="muted">appariées en FIFO</td></tr>
          ${this.meta.unmatched && this.meta.unmatched.count ? `<tr><td class="warn">Ventes non appariées</td><td class="num warn">${this.meta.unmatched.count}</td><td class="muted">achats antérieurs à la fenêtre API — importez un CSV pour les retrouver</td></tr>` : ''}
          ${(this.meta.openLots || []).length ? `<tr><td>Positions spot encore ouvertes</td><td class="num">${this.meta.openLots.length}</td><td class="muted">${escHtml(this.meta.openLots.map((l) => l.instId).join(', '))}</td></tr>` : ''}
        </table>
        <div class="an-card-btns">
          <button id="an-full-sync">Resynchroniser tout</button>
          <button id="an-import-2">Importer un CSV</button>
          <button id="an-export-json">Exporter l'archive (JSON)</button>
          <button id="an-wipe" class="danger">Effacer l'archive locale</button>
        </div>
      </div>
    </div>`;
  },

  /* ═══════════ vue 7 — coach IA ═══════════ */

  paneCoach(s) {
    return `<div class="an-grid">
      <div class="an-card wide">
        <div class="an-card-hd">Bilan automatique <em>calculé localement, sans clé API</em></div>
        ${this.localReport(s)}
      </div>
      <div class="an-card wide">
        <div class="an-card-hd">Analyse par l'IA <em>envoie un résumé chiffré de vos statistiques à l'API Anthropic</em></div>
        <div class="an-note">Aucune clé privée OKX n'est transmise : seules les statistiques agrégées et
          les 40 derniers trades (instrument, sens, taille, résultat) composent le message.</div>
        <div id="an-coach-presets">
          <button data-q="coach">Bilan de coaching complet</button>
          <button data-q="risk">Audit de gestion du risque</button>
          <button data-q="edge">Où est mon avantage ?</button>
          <button data-q="fix">3 corrections prioritaires</button>
        </div>
        <div id="an-coach-out"></div>
      </div>
    </div>`;
  },

  localReport(s) {
    const c = s.core;
    const out = [];
    const verdict = (cond, good, bad) => (cond ? { t: 'ok', s: good } : { t: 'bad', s: bad });
    out.push(verdict(c.profitFactor >= 1.3,
      `Profit factor de ${this.ratio(c.profitFactor)} : le système gagne plus qu'il ne perd.`,
      `Profit factor de ${this.ratio(c.profitFactor)} : les pertes brutes absorbent l'essentiel des gains.`));
    out.push(verdict(c.expectancy > 0,
      `Espérance positive de ${this.money(c.expectancy)} par trade — répétable.`,
      `Espérance négative de ${this.money(c.expectancy)} par trade : chaque trade coûte en moyenne de l'argent.`));
    out.push(verdict(s.equity.maxDDPct < 25,
      `Drawdown maximal contenu à ${s.equity.maxDDPct.toFixed(1)}%.`,
      `Drawdown maximal de ${s.equity.maxDDPct.toFixed(1)}% : au-delà de 25%, la remontée devient très difficile.`));
    out.push(verdict(c.payoff >= 1 || c.winRate >= 55,
      `Équilibre réussite / payoff cohérent (${c.winRate.toFixed(0)}% à ${this.ratio(c.payoff)}×).`,
      `${c.winRate.toFixed(0)}% de réussite pour un payoff de ${this.ratio(c.payoff)}× : il faut soit gagner plus souvent, soit laisser courir davantage.`));
    const drag = c.fees / (Math.abs(c.grossWin) + Math.abs(c.grossLoss) || 1) * 100;
    out.push(verdict(drag < 10,
      `Frais maîtrisés (${drag.toFixed(1)}% du flux brut).`,
      `Les frais représentent ${drag.toFixed(1)}% du flux brut — réduisez la fréquence ou privilégiez les ordres limites (maker).`));
    out.push(verdict(s.risk.sharpe >= 1,
      `Sharpe de ${this.ratio(s.risk.sharpe)} : rendement régulier au regard du risque pris.`,
      `Sharpe de ${this.ratio(s.risk.sharpe)} : les résultats sont irréguliers au regard du risque pris.`));

    const li = out.map((o) => `<li class="ins ${o.t === 'ok' ? 'ok' : 'bad'}"><span>${escHtml(o.s)}</span></li>`).join('');
    return `<ul class="ins-list verdicts">${li}</ul>`;
  },

  coachPrompt(kind) {
    const s = this.stats, c = s.core;
    const top = s.bySymbol.slice(0, 8).map((x) => `${x.label}: ${x.n} trades, ${x.winRate.toFixed(0)}% réussite, net ${x.net.toFixed(0)}`).join(' | ');
    const hours = s.byHour.map((x) => `${x.label}=${x.net.toFixed(0)}`).join(' ');
    const recent = s.trades.slice(-40).map((t) =>
      `${new Date(t.closeTime).toISOString().slice(0, 16)} ${t.instId} ${t.side} x${t.lever} notionnel ${t.notional.toFixed(0)} net ${t.net.toFixed(2)} durée ${(t.durationMs / 60000).toFixed(0)}min`).join('\n');
    const flags = s.behaviour.map((b) => `- ${b.title} : ${b.detail}`).join('\n');

    const ctx = `STATISTIQUES DE TRADING (compte OKX réel, devise USDT)
Période : ${this.date(s.period.from)} → ${this.date(s.period.to)} (${Math.round(s.spanDays)} jours)
Trades : ${c.n} (${c.wins} gagnants / ${c.losses} perdants), réussite ${c.winRate.toFixed(1)}%
P/L net : ${c.net.toFixed(2)} | brut ${(c.net + c.fees).toFixed(2)} | frais ${c.fees.toFixed(2)} | funding ${c.funding.toFixed(2)}
Profit factor ${this.ratio(c.profitFactor)} | payoff ${this.ratio(c.payoff)} | espérance ${c.expectancy.toFixed(2)} (${this.ratio(s.expectancyR)} R)
Gain moyen ${c.avgWin.toFixed(2)} | perte moyenne ${c.avgLoss.toFixed(2)} | meilleur ${c.best.toFixed(2)} | pire ${c.worst.toFixed(2)}
Drawdown max ${s.equity.maxDD.toFixed(2)} (${s.equity.maxDDPct.toFixed(1)}%) | recovery ${this.ratio(s.recovery)} | ulcer ${this.ratio(s.equity.ulcer)}
Sharpe ${this.ratio(s.risk.sharpe)} | Sortino ${this.ratio(s.risk.sortino)} | Calmar ${this.ratio(s.risk.calmar)} | SQN ${this.ratio(s.sqn)}
Séries : ${s.streaks.maxWin} gains d'affilée max, ${s.streaks.maxLoss} pertes d'affilée max, série actuelle ${s.streaks.current}
Durée moyenne ${Analytics.fmtDur(c.avgDuration)} | volume traité ${c.volume.toFixed(0)}
Par instrument : ${top}
P/L par heure d'entrée (locale) : ${hours}
Signaux comportementaux détectés :
${flags || '(aucun)'}

40 DERNIERS TRADES :
${recent}`;

    const asks = {
      coach: 'Tu es un coach de trading exigeant et factuel. À partir de ces statistiques réelles, produis un bilan structuré : 1) ce qui fonctionne, chiffres à l\'appui ; 2) les trois fuites principales qui coûtent le plus d\'argent, quantifiées ; 3) un plan d\'action concret et vérifiable pour les 30 prochains jours. Sois direct, cite les chiffres, n\'invente rien qui ne soit dans les données.',
      risk: 'Audite la gestion du risque de ce compte : taille de position, levier, drawdown, exposition, régularité. Identifie ce qui pourrait provoquer une perte majeure et chiffre le risque de ruine implicite. Termine par des règles de risque précises adaptées à ces statistiques.',
      edge: 'Détermine où se situe l\'avantage statistique réel de ce trader : quels instruments, quels sens, quelles durées, quelles heures. Distingue ce qui est significatif de ce qui relève du bruit compte tenu du nombre de trades. Conclus sur ce qu\'il faudrait faire davantage et ce qu\'il faudrait arrêter.',
      fix: 'Donne exactement trois corrections prioritaires, classées par gain espéré en euros. Pour chacune : le constat chiffré, la règle à appliquer, et l\'indicateur qui permettra de vérifier dans 30 jours que la correction fonctionne. Rien d\'autre.',
    };
    return `${asks[kind] || asks.coach}\n\n${ctx}`;
  },

  async askCoach(kind) {
    const out = $('an-coach-out');
    if (!AIPanel.key) {
      out.innerHTML = '<div class="ai-msg err">Aucune clé API Anthropic configurée. Utilisez la commande <code>KEY</code> ou le bouton ⚙ de l\'onglet IA du terminal.</div>';
      return;
    }
    out.innerHTML = '<div class="ai-msg wait">Analyse de vos statistiques…</div>';
    try {
      const answer = await AIPanel.askRaw(this.coachPrompt(kind));
      out.innerHTML = `<div class="ai-msg bot">${renderAiText(answer)}</div>`;
    } catch (e) {
      out.innerHTML = `<div class="ai-msg err">${escHtml(e.message)}</div>`;
    }
  },

  /* ═══════════ graphiques ═══════════ */

  drawCharts(s) {
    const LWC = LightweightCharts;
    const host = $('an-eq-chart');
    if (!host || !s.equity.points.length) return;

    const base = {
      layout: { background: { color: '#10141a' }, textColor: VIZ.axis, fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif', attributionLogo: false },
      grid: { vertLines: { color: VIZ.grid, style: 0 }, horzLines: { color: VIZ.grid, style: 0 } },
      crosshair: { mode: LWC.CrosshairMode.Normal, vertLine: { color: '#3a4450', labelBackgroundColor: '#2a323d' }, horzLine: { color: '#3a4450', labelBackgroundColor: '#2a323d' } },
      rightPriceScale: { borderColor: '#1f252e' },
      timeScale: { borderColor: '#1f252e', timeVisible: true, secondsVisible: false },
      localization: { locale: 'fr-FR' },
      autoSize: true,
    };

    /* courbe de capital — série divergente autour de 0, gain au-dessus / perte en dessous */
    host.innerHTML = '';
    const eq = LWC.createChart(host, base);
    const eqS = eq.addSeries(LWC.BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: VIZ.pos, topFillColor1: 'rgba(74,222,159,.20)', topFillColor2: 'rgba(74,222,159,.02)',
      bottomLineColor: VIZ.neg, bottomFillColor1: 'rgba(226,57,79,.02)', bottomFillColor2: 'rgba(226,57,79,.20)',
      lineWidth: 2, priceLineVisible: false,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });
    // un point par jour : la courbe suit le temps réel, pas le numéro de trade
    const daily = [];
    let cum = 0;
    for (const d of s.daily) { cum += d.net; daily.push({ time: Math.floor(d.t / 1000), value: +cum.toFixed(2) }); }
    eqS.setData(daily);
    eq.timeScale().fitContent();

    const read = $('eq-read');
    // valeur finale affichée d'emblée : la lecture ne dépend pas du survol
    if (read && daily.length) {
      const last = daily[daily.length - 1];
      read.innerHTML = `final <b class="${last.value >= 0 ? 'pos' : 'neg'}">${this.money(last.value, 0)}</b>`;
    }
    eq.subscribeCrosshairMove((p) => {
      if (!read) return;
      if (!p || !p.time || !p.seriesData || !p.seriesData.get(eqS)) {
        const lastPt = daily[daily.length - 1];
        read.innerHTML = lastPt ? `final <b class="${lastPt.value >= 0 ? 'pos' : 'neg'}">${this.money(lastPt.value, 0)}</b>` : '';
        return;
      }
      const v = p.seriesData.get(eqS).value;
      const dt = new Date(p.time * 1000);
      const day = s.daily.find((d) => Math.floor(d.t / 1000) === p.time);
      read.innerHTML = `${pd(dt.getDate())}/${pd(dt.getMonth() + 1)}/${dt.getFullYear()} · cumulé <b class="${v >= 0 ? 'pos' : 'neg'}">${this.money(v, 0)}</b>`
        + (day && day.n ? ` · ${day.n} trade(s) <b class="${day.net >= 0 ? 'pos' : 'neg'}">${this.money(day.net, 0)}</b>` : ' · aucun trade');
    });
    this.charts.eq = eq;

    /* drawdown — série unique, toujours négative */
    const ddHost = $('an-dd-chart');
    if (ddHost) {
      ddHost.innerHTML = '';
      const dd = LWC.createChart(ddHost, { ...base, rightPriceScale: { borderColor: '#1f252e' } });
      const ddS = dd.addSeries(LWC.AreaSeries, {
        lineColor: VIZ.neg, topColor: 'rgba(226,57,79,.05)', bottomColor: 'rgba(226,57,79,.35)',
        lineWidth: 2, priceLineVisible: false, invertFilledArea: true,
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      });
      let peak = 0, cu = 0;
      const ddData = [];
      for (const d of s.daily) {
        cu += d.net;
        if (cu > peak) peak = cu;
        const denom = s.initialEquity + peak;
        ddData.push({ time: Math.floor(d.t / 1000), value: denom > 0 ? -((peak - cu) / denom * 100) : 0 });
      }
      ddS.setData(ddData);
      dd.timeScale().fitContent();
      this.charts.dd = dd;

      // synchronise les deux échelles de temps : même fenêtre, une seule lecture
      const link = (a, b) => a.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (r) { try { b.timeScale().setVisibleLogicalRange(r); } catch {} }
      });
      link(eq, dd); link(dd, eq);
    }
  },

  disposeCharts() {
    for (const k of Object.keys(this.charts)) {
      try { this.charts[k].remove(); } catch {}
      delete this.charts[k];
    }
  },

  /* ═══════════ interactions ═══════════ */

  bindPane() {
    const s = this.stats;
    this.disposeCharts();
    if (this.pane === 'over') setTimeout(() => this.drawCharts(s), 0);

    // tri du journal
    document.querySelectorAll('#an-body th.sortable').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.sort;
        if (this.sortKey === k) this.sortDir *= -1; else { this.sortKey = k; this.sortDir = -1; }
        this.render();
      };
    });

    // « voir sur le graphique »
    document.querySelectorAll('#an-body [data-chart]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); this.showOnChart(b.dataset.chart); };
    });

    // exploration : cliquer une ligne de répartition filtre la vue
    document.querySelectorAll('#an-body tr[data-drill="symbol"]').forEach((tr) => {
      tr.style.cursor = 'pointer';
      tr.onclick = () => this.setFilter('symbol', tr.dataset.key);
    });

    const csv = $('an-export-csv'); if (csv) csv.onclick = () => this.exportCsv();
    const fs = $('an-full-sync'); if (fs) fs.onclick = () => this.sync({ full: true });
    const i2 = $('an-import-2'); if (i2) i2.onclick = () => this.pickCsv();
    const ej = $('an-export-json'); if (ej) ej.onclick = () => this.exportJson();
    const wp = $('an-wipe'); if (wp) wp.onclick = () => this.wipe();

    document.querySelectorAll('#an-coach-presets button').forEach((b) => {
      b.onclick = () => this.askCoach(b.dataset.q);
    });
  },

  /* bascule vers le terminal, charge l'instrument et trace le trade */
  async showOnChart(key) {
    const t = this.trades.find((x) => x.key === key);
    if (!t) return;
    this.hide();
    // unité de temps adaptée à la durée du trade : ~40 bougies de contexte
    const mins = Math.max(1, t.durationMs / 60000);
    const tf = [1, 5, 15, 30, 60, 240, 1440, 10080].find((x) => mins / x <= 40) || 10080;
    setStatus(`Chargement de ${t.instId}…`);
    const ok = await selectSymbol(t.instId, tf);
    if (ok === false) { setStatus(`${t.instId} : instrument introuvable (délisté ?)`, 'err'); return; }
    // remonte l'historique jusqu'à couvrir l'entrée du trade
    for (let i = 0; i < 12; i++) {
      const c = state.charts[state.activeIdx];
      if (!c || !c.chart.candles.length) break;
      if (c.chart.candles[0].t <= t.openTime - tf * 60000) break;
      const older = await state.provider.getCandlesBefore(c.symbol, c.tf, c.chart.candles[0].t).catch(() => []);
      if (!older || !older.length) break;
      c.chart.prependCandles(older);
    }
    this.overlayTrades(t.instId);
    const ch = state.chart;
    if (ch) { ch.focusTrade(t); }
    setStatus(`${t.instId} · trade du ${this.date(t.closeTime)} · net ${this.money(t.net)}`, t.net >= 0 ? 'ok' : 'err');
  },

  /* trace tous les trades de l'instrument sur la cellule active */
  overlayTrades(symbol) {
    const ch = state.chart;
    if (!ch || !state.showTrades) return 0;
    const list = this.trades.filter((t) => t.instId === (symbol || state.selected));
    return ch.setTrades(list);
  },

  /* ═══════════ import / export ═══════════ */

  pickCsv() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.csv,text/csv,text/plain';
    inp.multiple = true;
    inp.onchange = async () => {
      const files = [...inp.files];
      let added = 0, report = [];
      for (const f of files) {
        try {
          const text = await f.text();
          const res = Trades.fromCsv(text, this.provider ? this.provider.instruments : new Map());
          const before = this.trades.length;
          this.trades = Trades.merge(this.trades, res.trades);
          const gained = this.trades.length - before;
          added += gained;
          report.push(`${f.name} : ${res.trades.length} trades lus (${res.format === 'positions' ? 'positions' : 'exécutions FIFO'}), ${gained} nouveaux`);
        } catch (e) {
          report.push(`${f.name} : ${e.message}`);
        }
      }
      await this.persist();
      this.recompute();
      this.render();
      showModal('Import CSV', `<ul class="an-report">${report.map((r) => `<li>${escHtml(r)}</li>`).join('')}</ul>
        <div class="m-warn">${added} trade(s) ajouté(s) à l'archive locale.</div>`, [{ label: 'Fermer', cls: 'm-cancel' }]);
    };
    inp.click();
  },

  download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  exportCsv() {
    this.download(`okx-trades-${new Date().toISOString().slice(0, 10)}.csv`,
      Trades.toCsv(this.filtered), 'text/csv;charset=utf-8');
  },
  exportJson() {
    this.download(`okx-archive-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: Date.now(), uid: this.meta.uid, trades: this.trades }, null, 1),
      'application/json');
  },

  wipe() {
    showModal('Effacer l\'archive locale',
      `<p>Cette action supprime les <b>${this.trades.length} trades</b> conservés dans ce navigateur.
       Vos données OKX ne sont pas affectées : une nouvelle synchronisation les rechargera
       (dans la limite des 3 mois servis par l'API). Les imports CSV, eux, seront perdus.</p>`,
      [
        { label: 'Annuler', cls: 'm-cancel' },
        {
          label: 'Effacer', cls: 'm-confirm-sell',
          fn: async () => {
            this.trades = []; this.meta.lastSync = 0; this.meta.sources = {};
            await Store.del('okx-trades-' + (this.meta.uid || 'default'));
            this.recompute(); this.render();
          },
        },
      ]);
  },
};
