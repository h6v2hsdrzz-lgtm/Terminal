/* ════════════════════════════════════════════════════════════
   cftc.js — source de vérité : engagements des opérateurs (COT)
   publiés chaque vendredi 15h30 ET par la CFTC, arrêtés au mardi.

   Deux rapports couvrent les métaux :
     • Disaggregated (depuis 2006) — sépare les commerciaux en
       Producteurs/Négociants et Swap Dealers (les banques), et les
       spéculateurs en Managed Money (hedge funds, CTA) et Autres
       reportables. C'est le rapport de référence de ce poste.
     • Legacy (depuis 1986) — deux blocs seulement (non-commerciaux /
       commerciaux) mais 20 ans d'historique en plus, indispensable
       pour situer un extrême dans le temps long.

   Chaque rapport existe en « futures seuls » et « futures + options »
   (delta-ajusté). L'API Socrata publique de la CFTC autorise le CORS
   (Access-Control-Allow-Origin: *) : le navigateur l'interroge en
   direct, aucun backend, aucune clé.
   ════════════════════════════════════════════════════════════ */
'use strict';

const CFTC_HOST = 'https://publicreporting.cftc.gov/resource';

/* jeux de données Socrata — [rapport][base] */
const CFTC_DATASETS = {
  disagg: { futures: '72hh-3qpy', combined: 'kh3c-gbw2' },
  legacy: { futures: '6dca-aqww', combined: 'jun7-fc8e' },
};

/* ── Marchés suivis ─────────────────────────────────────────
   `size` = taille d'un contrat dans l'unité cotée : il convertit
   les positions (en contrats) en onces puis en dollars notionnels. */
const CFTC_MARKETS = {
  GOLD: {
    code: '088691', label: 'Or', ticker: 'GOLD', unit: 'oz t',
    size: 100, exchange: 'COMEX', spot: 'XAU', primary: true,
    desc: 'Gold — 100 oz troy — Commodity Exchange Inc.',
  },
  SILVER: {
    code: '084691', label: 'Argent', ticker: 'SILVER', unit: 'oz t',
    size: 5000, exchange: 'COMEX', spot: 'XAG', primary: true,
    desc: 'Silver — 5 000 oz troy — Commodity Exchange Inc.',
  },
  MICROGOLD: {
    code: '088695', label: 'Micro Or', ticker: 'MGC', unit: 'oz t',
    size: 10, exchange: 'COMEX', spot: 'XAU',
    desc: 'Micro Gold — 10 oz troy — COMEX',
  },
  MICROSILVER: {
    code: '084694', label: 'Micro Argent', ticker: 'SIL', unit: 'oz t',
    size: 1000, exchange: 'COMEX', spot: 'XAG',
    desc: 'Micro Silver — 1 000 oz troy — COMEX',
  },
  PLATINUM: {
    code: '076651', label: 'Platine', ticker: 'PLAT', unit: 'oz t',
    size: 50, exchange: 'NYMEX', spot: null,
    desc: 'Platinum — 50 oz troy — NYMEX',
  },
  PALLADIUM: {
    code: '075651', label: 'Palladium', ticker: 'PALL', unit: 'oz t',
    size: 100, exchange: 'NYMEX', spot: null,
    desc: 'Palladium — 100 oz troy — NYMEX',
  },
  COPPER: {
    code: '085692', label: 'Cuivre', ticker: 'COPPER', unit: 'lb',
    size: 25000, exchange: 'COMEX', spot: null,
    desc: 'Copper Grade #1 — 25 000 lb — COMEX',
  },
};

/* ── Cohortes ───────────────────────────────────────────────
   L'ordre est celui de lecture d'un COT : couverture physique →
   banques → hedge funds → autres gros → petits porteurs.
   `side` indique le rôle de marché, utilisé pour l'interprétation. */
const COHORTS_DISAGG = [
  {
    key: 'prod', label: 'Producteurs / Négociants', short: 'Producteurs',
    side: 'hedge', color: '#6f8fb0',
    desc: 'Mines, raffineurs, industriels, bijoutiers. Couvrent une production ou un stock physique : structurellement vendeurs, leur position dit peu du sentiment mais beaucoup de l\'offre couverte.',
  },
  {
    key: 'swap', label: 'Swap dealers (banques)', short: 'Banques',
    side: 'hedge', color: '#c98f4a',
    desc: 'Banques d\'affaires et bullion banks (JPMorgan, HSBC, Goldman…). Font le marché face aux indices et aux clients OTC, puis couvrent sur le COMEX. Leur short massif est le miroir mécanique du long des indices et des hedge funds.',
  },
  {
    key: 'money', label: 'Managed money (hedge funds)', short: 'Hedge funds',
    side: 'spec', color: '#d9a441',
    desc: 'Hedge funds, CTA, fonds systématiques enregistrés (CPO/CTA). La cohorte spéculative la plus suivie : directionnelle, momentum, elle marque les extrêmes de sentiment et les points de retournement.',
  },
  {
    key: 'other', label: 'Autres reportables', short: 'Autres gros',
    side: 'spec', color: '#8e7ab8',
    desc: 'Grosses positions déclarables hors catégories ci-dessus : family offices, trésoreries d\'entreprise, gros indépendants. Souvent plus lentes et plus patientes que le managed money.',
  },
  {
    key: 'nonrept', label: 'Non déclarants (petits porteurs)', short: 'Petits porteurs',
    side: 'retail', color: '#5d6b7a',
    desc: 'Toutes les positions sous le seuil de déclaration. Le « public » : historiquement le plus souvent du mauvais côté aux extrêmes.',
  },
];

const COHORTS_LEGACY = [
  {
    key: 'noncomm', label: 'Non-commerciaux (spéculateurs)', short: 'Spéculateurs',
    side: 'spec', color: '#d9a441',
    desc: 'Tous les spéculateurs déclarables agrégés : hedge funds, CTA, autres gros. Équivalent historique du managed money, disponible depuis 1986.',
  },
  {
    key: 'comm', label: 'Commerciaux (couverture)', short: 'Commerciaux',
    side: 'hedge', color: '#6f8fb0',
    desc: 'Producteurs, négociants et banques agrégés. Contrepartie mécanique des spéculateurs : leur net est presque l\'image inversée du net non-commercial.',
  },
  {
    key: 'nonrept', label: 'Non déclarants (petits porteurs)', short: 'Petits porteurs',
    side: 'retail', color: '#5d6b7a',
    desc: 'Positions sous le seuil de déclaration.',
  },
];

/* ── Correspondance colonnes Socrata ────────────────────────
   Les noms de champs de la CFTC comportent des irrégularités
   historiques (double tiret bas dans `swap__positions_short_all`,
   faute de frappe dans `noncomm_postions_spread_all`) : la table
   ci-dessous les fige une fois pour toutes. */
const FIELDS_DISAGG = {
  prod: {
    long: 'prod_merc_positions_long', short: 'prod_merc_positions_short', spread: null,
    dLong: 'change_in_prod_merc_long', dShort: 'change_in_prod_merc_short', dSpread: null,
    pLong: 'pct_of_oi_prod_merc_long', pShort: 'pct_of_oi_prod_merc_short', pSpread: null,
    tLong: 'traders_prod_merc_long_all', tShort: 'traders_prod_merc_short_all',
  },
  swap: {
    long: 'swap_positions_long_all', short: 'swap__positions_short_all', spread: 'swap__positions_spread_all',
    dLong: 'change_in_swap_long_all', dShort: 'change_in_swap_short_all', dSpread: 'change_in_swap_spread_all',
    pLong: 'pct_of_oi_swap_long_all', pShort: 'pct_of_oi_swap_short_all', pSpread: 'pct_of_oi_swap_spread_all',
    tLong: 'traders_swap_long_all', tShort: 'traders_swap_short_all',
  },
  money: {
    long: 'm_money_positions_long_all', short: 'm_money_positions_short_all', spread: 'm_money_positions_spread',
    dLong: 'change_in_m_money_long_all', dShort: 'change_in_m_money_short_all', dSpread: 'change_in_m_money_spread',
    pLong: 'pct_of_oi_m_money_long_all', pShort: 'pct_of_oi_m_money_short_all', pSpread: 'pct_of_oi_m_money_spread',
    tLong: 'traders_m_money_long_all', tShort: 'traders_m_money_short_all',
  },
  other: {
    long: 'other_rept_positions_long', short: 'other_rept_positions_short', spread: 'other_rept_positions_spread',
    dLong: 'change_in_other_rept_long', dShort: 'change_in_other_rept_short', dSpread: 'change_in_other_rept_spread',
    pLong: 'pct_of_oi_other_rept_long', pShort: 'pct_of_oi_other_rept_short', pSpread: 'pct_of_oi_other_rept_spread',
    tLong: 'traders_other_rept_long_all', tShort: 'traders_other_rept_short',
  },
  nonrept: {
    long: 'nonrept_positions_long_all', short: 'nonrept_positions_short_all', spread: null,
    dLong: 'change_in_nonrept_long_all', dShort: 'change_in_nonrept_short_all', dSpread: null,
    pLong: 'pct_of_oi_nonrept_long_all', pShort: 'pct_of_oi_nonrept_short_all', pSpread: null,
    tLong: null, tShort: null,
  },
};

const FIELDS_LEGACY = {
  noncomm: {
    long: 'noncomm_positions_long_all', short: 'noncomm_positions_short_all', spread: 'noncomm_postions_spread_all',
    dLong: 'change_in_noncomm_long_all', dShort: 'change_in_noncomm_short_all', dSpread: 'change_in_noncomm_spead_all',
    pLong: 'pct_of_oi_noncomm_long_all', pShort: 'pct_of_oi_noncomm_short_all', pSpread: 'pct_of_oi_noncomm_spread',
    tLong: 'traders_noncomm_long_all', tShort: 'traders_noncomm_short_all',
  },
  comm: {
    long: 'comm_positions_long_all', short: 'comm_positions_short_all', spread: null,
    dLong: 'change_in_comm_long_all', dShort: 'change_in_comm_short_all', dSpread: null,
    pLong: 'pct_of_oi_comm_long_all', pShort: 'pct_of_oi_comm_short_all', pSpread: null,
    tLong: 'traders_comm_long_all', tShort: 'traders_comm_short_all',
  },
  nonrept: {
    long: 'nonrept_positions_long_all', short: 'nonrept_positions_short_all', spread: null,
    dLong: 'change_in_nonrept_long_all', dShort: 'change_in_nonrept_short_all', dSpread: null,
    pLong: 'pct_of_oi_nonrept_long_all', pShort: 'pct_of_oi_nonrept_short_all', pSpread: null,
    tLong: null, tShort: null,
  },
};

/* champs de concentration — identiques dans les deux rapports */
const FIELDS_CONC = {
  net4Long: 'conc_net_le_4_tdr_long_all', net4Short: 'conc_net_le_4_tdr_short_all',
  net8Long: 'conc_net_le_8_tdr_long_all', net8Short: 'conc_net_le_8_tdr_short_all',
  gross4Long: 'conc_gross_le_4_tdr_long', gross4Short: 'conc_gross_le_4_tdr_short',
  gross8Long: 'conc_gross_le_8_tdr_long', gross8Short: 'conc_gross_le_8_tdr_short',
};

function cohortsFor(report) {
  return report === 'legacy' ? COHORTS_LEGACY : COHORTS_DISAGG;
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/* une ligne Socrata brute → ligne normalisée exploitable */
function normalizeRow(raw, report) {
  const map = report === 'legacy' ? FIELDS_LEGACY : FIELDS_DISAGG;
  const cohorts = {};

  for (const [key, f] of Object.entries(map)) {
    const long = num(raw[f.long]);
    const short = num(raw[f.short]);
    const spread = f.spread ? num(raw[f.spread]) : 0;
    const tLong = f.tLong ? num(raw[f.tLong]) : 0;
    const tShort = f.tShort ? num(raw[f.tShort]) : 0;
    cohorts[key] = {
      long, short, spread,
      net: long - short,
      gross: long + short,
      dLong: num(raw[f.dLong]),
      dShort: num(raw[f.dShort]),
      dNet: num(raw[f.dLong]) - num(raw[f.dShort]),
      dSpread: f.dSpread ? num(raw[f.dSpread]) : 0,
      pctLong: num(raw[f.pLong]),
      pctShort: num(raw[f.pShort]),
      pctSpread: f.pSpread ? num(raw[f.pSpread]) : 0,
      tradersLong: tLong,
      tradersShort: tShort,
      /* biais long/short de la cohorte, borné à ±100 — plus lisible
         qu'un net brut pour comparer deux métaux de taille différente */
      bias: long + short > 0 ? ((long - short) / (long + short)) * 100 : 0,
    };
  }

  const conc = {};
  for (const [k, f] of Object.entries(FIELDS_CONC)) conc[k] = num(raw[f]);

  const iso = String(raw.report_date_as_yyyy_mm_dd || '').slice(0, 10);
  return {
    date: iso,
    ts: Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000),
    oi: num(raw.open_interest_all),
    dOi: num(raw.change_in_open_interest_all),
    traders: num(raw.traders_tot_all),
    cohorts,
    conc,
  };
}

/* ── Cache local ────────────────────────────────────────────
   Le COT ne bouge qu'une fois par semaine : on garde la série
   complète en localStorage et on ne redemande qu'après expiration
   ou quand une nouvelle publication est attendue. */
const CFTC_CACHE_PREFIX = 'bullion-cot-v1:';
const CFTC_CACHE_TTL = 6 * 3600 * 1000;

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CFTC_CACHE_PREFIX + key);
    if (!raw) return null;
    const box = JSON.parse(raw);
    if (!box || Date.now() - box.at > CFTC_CACHE_TTL) return null;
    return box.rows;
  } catch { return null; }
}

function cacheSet(key, rows) {
  try {
    localStorage.setItem(CFTC_CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    /* quota dépassé : on purge nos entrées et on abandonne le cache */
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(CFTC_CACHE_PREFIX)) localStorage.removeItem(k);
      }
    } catch {}
  }
}

function cacheClear() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(CFTC_CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {}
}

/* ── Client ─────────────────────────────────────────────────*/
const CFTC = {
  markets: CFTC_MARKETS,
  cohortsFor,
  clearCache: cacheClear,

  /* série hebdomadaire complète d'un marché, du plus ancien au plus récent */
  async series(marketKey, { report = 'disagg', basis = 'futures', force = false } = {}) {
    const market = CFTC_MARKETS[marketKey];
    if (!market) throw new Error('Marché inconnu : ' + marketKey);
    const dataset = (CFTC_DATASETS[report] || {})[basis];
    if (!dataset) throw new Error(`Rapport indisponible : ${report}/${basis}`);

    const cacheKey = `${marketKey}:${report}:${basis}`;
    if (!force) {
      const hit = cacheGet(cacheKey);
      if (hit) return hit;
    }

    const url = `${CFTC_HOST}/${dataset}.json`
      + `?cftc_contract_market_code=${encodeURIComponent(market.code)}`
      + '&$order=report_date_as_yyyy_mm_dd ASC&$limit=5000';

    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`CFTC ${res.status} — ${report}/${basis}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || !raw.length) {
      throw new Error(`Aucune donnée CFTC pour ${market.label} (${report}/${basis})`);
    }

    /* Un même code contrat peut apparaître sous plusieurs libellés au fil
       des renommages d'échange : on déduplique par date en gardant la
       dernière ligne publiée. */
    const byDate = new Map();
    for (const r of raw) {
      const row = normalizeRow(r, report);
      if (row.ts) byDate.set(row.date, row);
    }
    const rows = [...byDate.values()].sort((a, b) => a.ts - b.ts);

    cacheSet(cacheKey, rows);
    return rows;
  },

  /* charge plusieurs marchés en parallèle ; un marché en échec ne fait
     pas tomber les autres (le desk reste utilisable en dégradé) */
  async multi(marketKeys, opts = {}) {
    const out = {};
    const errs = [];
    await Promise.all(marketKeys.map(async (k) => {
      try { out[k] = await this.series(k, opts); }
      catch (e) { errs.push(`${k}: ${e.message}`); }
    }));
    return { series: out, errors: errs };
  },

  /* ── Calendrier de publication ────────────────────────────
     Arrêté le mardi, publié le vendredi 15h30 ET (20h30 UTC en heure
     d'hiver, 19h30 en heure d'été). On raisonne en UTC avec un décalage
     simple : l'objectif est d'afficher un compte à rebours honnête,
     pas de gérer les décalages DST à la seconde près. */
  nextRelease(lastReportDate) {
    const now = new Date();
    const rel = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 19, 30, 0,
    ));
    /* prochain vendredi 19h30 UTC (≥ maintenant) */
    const shift = (5 - rel.getUTCDay() + 7) % 7;
    rel.setUTCDate(rel.getUTCDate() + shift);
    if (rel <= now) rel.setUTCDate(rel.getUTCDate() + 7);

    /* date d'arrêté attendue = mardi précédant cette publication */
    const asOf = new Date(rel);
    asOf.setUTCDate(asOf.getUTCDate() - 3);
    asOf.setUTCHours(0, 0, 0, 0);

    const last = lastReportDate ? Date.parse(lastReportDate + 'T00:00:00Z') : 0;
    return {
      at: rel,
      asOf: asOf.toISOString().slice(0, 10),
      msLeft: rel - now,
      /* vrai si la CFTC devrait déjà avoir publié un arrêté plus récent
         que celui qu'on affiche — signale une donnée en retard */
      stale: last > 0 && asOf.getTime() - last > 7 * 86400000,
    };
  },
};
