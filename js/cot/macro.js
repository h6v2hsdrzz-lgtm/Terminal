/* ════════════════════════════════════════════════════════════
   macro.js — contexte macro et prix.

   Deux temporalités cohabitent ici :
     • le temps réel — le spot XAU/XAG, rafraîchi en continu depuis une
       API publique autorisant le CORS ;
     • le temps différé — les séries FRED et les fixings LBMA, déposés
       dans data/*.json par scripts/refresh_data.py (ces sources ne
       renvoient pas d'en-tête CORS : le navigateur ne peut pas les lire
       directement, un instantané statique règle le problème sans
       backend ni proxy tiers).

   Le module en tire un « régime macro » : une lecture bornée à ±100 de
   ce que l'environnement de taux, de dollar et de risque fait à l'or.
   ════════════════════════════════════════════════════════════ */
'use strict';

const SPOT_ENDPOINTS = {
  XAU: 'https://api.gold-api.com/price/XAU',
  XAG: 'https://api.gold-api.com/price/XAG',
};

/* Repli : l'or tokenisé coté sur OKX (Tether Gold, Paxos Gold) suit le
   spot de près et son API publique est très disponible. Sert de filet
   quand la source principale ne répond pas — jamais de source unique. */
const SPOT_FALLBACK = {
  XAU: ['XAUT-USDT', 'PAXG-USDT'],
};

/* ── Régime macro ───────────────────────────────────────────
   Chaque moteur est jugé sur sa variation récente, pas sur son niveau :
   ce qui meut l'or, c'est la direction des taux réels et du dollar, pas
   leur valeur absolue. `sign` donne le sens favorable à l'or, `window`
   la fenêtre de mesure en jours calendaires, `weight` l'importance. */
const MACRO_DRIVERS = [
  { id: 'DFII10', sign: -1, weight: 30, window: 21, scale: 0.35,
    why: 'Taux réel 10 ans — le coût d\'opportunité de détenir un métal qui ne verse rien.' },
  { id: 'DTWEXBGS', sign: -1, weight: 22, window: 21, scale: 2.0,
    why: 'Dollar large — l\'or est coté en dollars, un billet vert fort le comprime.' },
  { id: 'DGS2', sign: -1, weight: 12, window: 21, scale: 0.35,
    why: '2 ans — le segment qui incorpore les anticipations de taux directeurs.' },
  { id: 'T10YIE', sign: 1, weight: 12, window: 21, scale: 0.20,
    why: 'Point mort d\'inflation — la protection recherchée dans le métal.' },
  { id: 'BAMLH0A0HYM2', sign: 1, weight: 10, window: 21, scale: 0.45,
    why: 'Spread high yield — son écartement signale une fuite vers la qualité.' },
  { id: 'T10Y2Y', sign: 1, weight: 8, window: 42, scale: 0.30,
    why: 'Pente de la courbe — la repentification accompagne les cycles d\'assouplissement.' },
  { id: 'VIXCLS', sign: 1, weight: 6, window: 21, scale: 6.0,
    why: 'VIX — le stress actions alimente la demande de refuge.' },
];

const Macro = {
  data: null,       /* macro.json */
  prices: null,     /* prices.json */
  news: null,       /* news.json */
  spot: {},         /* { XAU: {price, at, source}, XAG: {…} } */

  /* ── Chargement ───────────────────────────────────────── */

  async loadSnapshots() {
    const grab = async (file) => {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${file} — HTTP ${res.status}`);
      return res.json();
    };
    const [macro, prices, news] = await Promise.allSettled([
      grab('data/macro.json'), grab('data/prices.json'), grab('data/news.json'),
    ]);
    this.data = macro.status === 'fulfilled' ? macro.value : null;
    this.prices = prices.status === 'fulfilled' ? prices.value : null;
    this.news = news.status === 'fulfilled' ? news.value : null;

    const missing = [];
    if (!this.data) missing.push('macro');
    if (!this.prices) missing.push('prix');
    if (!this.news) missing.push('news');
    return { missing };
  },

  /* spot temps réel — source principale, puis repli OKX */
  async fetchSpot(symbol) {
    try {
      const res = await fetch(SPOT_ENDPOINTS[symbol]);
      if (res.ok) {
        const j = await res.json();
        if (Number.isFinite(j.price) && j.price > 0) {
          const q = { price: j.price, at: j.updatedAt || new Date().toISOString(), source: 'gold-api' };
          this.spot[symbol] = q;
          return q;
        }
      }
    } catch { /* on tente le repli */ }

    for (const inst of SPOT_FALLBACK[symbol] || []) {
      try {
        const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${inst}`);
        if (!res.ok) continue;
        const j = await res.json();
        const px = parseFloat(((j.data || [])[0] || {}).last);
        if (Number.isFinite(px) && px > 0) {
          const q = { price: px, at: new Date().toISOString(), source: `OKX ${inst}` };
          this.spot[symbol] = q;
          return q;
        }
      } catch { /* symbole suivant */ }
    }
    return this.spot[symbol] || null;
  },

  async refreshSpot() {
    await Promise.all(['XAU', 'XAG'].map((s) => this.fetchSpot(s).catch(() => null)));
    return this.spot;
  },

  /* Prix de référence d'un métal : le spot s'il est disponible, sinon le
     dernier fixing LBMA. Toujours accompagné de sa provenance — un écran
     qui n'affiche pas d'où vient son prix ne vaut rien. */
  priceOf(metalKey) {
    const map = { GOLD: 'gold', MICROGOLD: 'gold', SILVER: 'silver', MICROSILVER: 'silver' };
    const spotSym = { GOLD: 'XAU', MICROGOLD: 'XAU', SILVER: 'XAG', MICROSILVER: 'XAG' }[metalKey];
    const live = spotSym ? this.spot[spotSym] : null;
    if (live) return { price: live.price, source: live.source, live: true, at: live.at };
    const m = this.prices && this.prices.metals[map[metalKey]];
    if (m) return { price: m.last, source: 'LBMA ' + m.lastDate, live: false, at: m.lastDate };
    return null;
  },

  /* série de prix { ts, close } pour l'alignement avec le COT */
  priceSeries(metalKey, { full = true } = {}) {
    const map = { GOLD: 'gold', MICROGOLD: 'gold', SILVER: 'silver', MICROSILVER: 'silver' };
    const m = this.prices && this.prices.metals[map[metalKey]];
    if (!m) return [];
    const rows = full ? m.weekly.concat(m.daily) : m.daily;
    const byDate = new Map();
    for (const [d, v] of rows) byDate.set(d, v);
    return [...byDate.entries()]
      .map(([d, v]) => ({ date: d, ts: Math.floor(Date.parse(d + 'T00:00:00Z') / 1000), close: v }))
      .sort((a, b) => a.ts - b.ts);
  },

  /* ── Lecture des séries ───────────────────────────────── */

  series(id) {
    return (this.data && this.data.series[id]) || null;
  },

  /* valeur la plus récente à `daysAgo` jours — on remonte jusqu'à trouver
     une observation, les séries FRED ayant des trous (jours fériés) */
  valueAgo(obs, daysAgo) {
    if (!obs || !obs.length) return null;
    const target = Date.parse(obs[obs.length - 1][0] + 'T00:00:00Z') - daysAgo * 86400000;
    let best = null;
    for (const [d, v] of obs) {
      if (Date.parse(d + 'T00:00:00Z') <= target) best = v; else break;
    }
    return best;
  },

  /* portrait d'une série : niveau, variations, position dans son range */
  snapshot(id) {
    const s = this.series(id);
    if (!s || !s.obs.length) return null;
    const obs = s.obs;
    const last = obs[obs.length - 1][1];
    const chg = (days) => {
      const before = this.valueAgo(obs, days);
      return before == null ? null : last - before;
    };
    const window = obs.filter(([d]) => Date.parse(d + 'T00:00:00Z')
      >= Date.parse(obs[obs.length - 1][0] + 'T00:00:00Z') - 365 * 86400000).map(([, v]) => v);
    const min = window.length ? Math.min(...window) : null;
    const max = window.length ? Math.max(...window) : null;
    return {
      id, label: s.label, unit: s.unit, desc: s.desc, sign: s.sign,
      last, date: s.lastDate,
      d1: chg(1), d5: chg(7), d21: chg(30), d63: chg(90), d252: chg(365),
      range1y: min != null && max != null ? { min, max, pct: max > min ? ((last - min) / (max - min)) * 100 : 50 } : null,
      obs,
    };
  },

  /* ── Régime ───────────────────────────────────────────── */

  /* Score borné à ±100 : positif = environnement macro porteur pour l'or.
     Chaque moteur est normalisé par une échelle propre (`scale`), qui
     correspond à un mouvement franc sur la fenêtre considérée — 35 pb de
     taux réel en un mois, 2 points d'indice dollar, etc. */
  regime() {
    if (!this.data) return null;
    const parts = [];
    for (const drv of MACRO_DRIVERS) {
      const s = this.series(drv.id);
      if (!s || !s.obs.length) continue;
      const last = s.obs[s.obs.length - 1][1];
      const before = this.valueAgo(s.obs, drv.window);
      if (before == null) continue;
      const delta = last - before;
      const value = Math.max(-1, Math.min(1, (delta / drv.scale) * drv.sign));
      parts.push({
        id: drv.id, label: s.label, why: drv.why, weight: drv.weight,
        value, delta, last, unit: s.unit, window: drv.window,
        detail: `${delta >= 0 ? '+' : ''}${delta.toFixed(s.unit === 'idx' ? 2 : 2)} sur ${drv.window} j`,
      });
    }
    if (!parts.length) return null;

    const wsum = parts.reduce((a, p) => a + p.weight, 0);
    const score = parts.reduce((a, p) => a + p.value * p.weight, 0) / wsum * 100;

    let verdict, tone;
    if (score >= 40) { verdict = 'Macro nettement porteuse pour les métaux'; tone = 'hot'; }
    else if (score >= 15) { verdict = 'Macro plutôt porteuse'; tone = 'warm'; }
    else if (score > -15) { verdict = 'Macro neutre'; tone = 'neutral'; }
    else if (score > -40) { verdict = 'Macro plutôt contraire'; tone = 'cool'; }
    else { verdict = 'Macro nettement contraire'; tone = 'cold'; }

    /* trié par contribution absolue : l'écran montre d'abord ce qui pèse */
    parts.sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight));
    return { score, verdict, tone, parts };
  },

  /* ── Corrélations ─────────────────────────────────────── */

  /* Corrélation glissante entre les variations hebdomadaires d'un métal
     et celles d'une série macro. Sur l'or, la corrélation aux taux réels
     est le chiffre qui dit si le marché suit encore son moteur habituel
     ou s'il s'en est affranchi. */
  correlation(metalKey, seriesId, weeks = 52) {
    const s = this.series(seriesId);
    const px = this.priceSeries(metalKey);
    if (!s || !px.length) return null;

    const macroByDate = new Map(s.obs.map(([d, v]) => [d, v]));
    const dates = [...macroByDate.keys()].sort();
    const at = (ts) => {
      /* dernière observation macro connue à cette date */
      let lo = 0, hi = dates.length - 1, best = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (Date.parse(dates[mid] + 'T00:00:00Z') <= ts) { best = dates[mid]; lo = mid + 1; }
        else hi = mid - 1;
      }
      return best ? macroByDate.get(best) : null;
    };

    const pairs = [];
    for (const p of px.slice(-weeks * 6)) {
      const m = at(p.ts);
      if (m != null) pairs.push({ ts: p.ts, price: p.close, macro: m });
    }
    /* on échantillonne une observation par semaine pour éviter que les
       jours dupliqués du snapshot ne gonflent artificiellement le n */
    const weekly = [];
    let lastWeek = null;
    for (const p of pairs) {
      const wk = Math.floor(p.ts / (7 * 86400));
      if (wk !== lastWeek) { weekly.push(p); lastWeek = wk; }
      else weekly[weekly.length - 1] = p;
    }
    const w = weekly.slice(-weeks);
    if (w.length < 12) return null;

    const dp = [], dm = [];
    for (let i = 1; i < w.length; i++) {
      dp.push((w[i].price - w[i - 1].price) / w[i - 1].price);
      dm.push(w[i].macro - w[i - 1].macro);
    }
    const mp = dp.reduce((a, b) => a + b, 0) / dp.length;
    const mm = dm.reduce((a, b) => a + b, 0) / dm.length;
    let cov = 0, vp = 0, vm = 0;
    for (let i = 0; i < dp.length; i++) {
      cov += (dp[i] - mp) * (dm[i] - mm);
      vp += (dp[i] - mp) ** 2;
      vm += (dm[i] - mm) ** 2;
    }
    if (!vp || !vm) return null;
    return { r: cov / Math.sqrt(vp * vm), n: dp.length, label: s.label };
  },

  /* ── News ─────────────────────────────────────────────── */

  newsItems({ scope = 'all', category = 'all', limit = 40 } = {}) {
    let items = (this.news && this.news.items) || [];
    if (scope !== 'all') items = items.filter((i) => i.scope === scope);
    if (category !== 'all') items = items.filter((i) => i.category === category);
    return items.slice(0, limit);
  },

  /* Catégories du fil, telles que déposées par le collecteur, avec le
     décompte réellement présent dans l'instantané. Une catégorie vide
     n'est pas masquée : son onglet à zéro dit que rien n'est tombé
     dessus, ce qui est une information. */
  newsCategories() {
    const cats = (this.news && this.news.categories) || [];
    const items = (this.news && this.news.items) || [];
    return cats.map((c) => ({
      ...c,
      count: items.filter((i) => i.category === c.key).length,
    }));
  },

  /* Les n dépêches les plus récentes d'une catégorie donnée. */
  newsByCategory(limit = 6) {
    return this.newsCategories().map((c) => ({
      ...c, items: this.newsItems({ category: c.key, limit }),
    }));
  },

  newsAge() {
    if (!this.news || !this.news.generated) return null;
    return Date.now() - Date.parse(this.news.generated);
  },
};
