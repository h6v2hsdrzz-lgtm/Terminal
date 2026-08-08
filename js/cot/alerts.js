/* ════════════════════════════════════════════════════════════
   alerts.js — seuils de surveillance.

   Le COT tombe une fois par semaine, le vendredi à 15h30 heure de New
   York. Entre deux publications il n'y a rien à surveiller ; le reste
   du temps, ce qu'on veut savoir tient en une phrase : « préviens-moi
   si les hedge funds repassent sous tel index, si le net bascule, si
   la concentration dépasse tel seuil ».

   Tout est évalué dans le navigateur sur les données déjà chargées, et
   les règles vivent en localStorage. Il n'y a ni serveur ni
   notification push : une alerte ici est un marqueur qui s'allume à
   l'ouverture du poste, pas un message qui réveille la nuit. C'est une
   limite assumée d'un site statique, et l'écran le dit plutôt que de
   laisser croire à une surveillance continue.
   ════════════════════════════════════════════════════════════ */
'use strict';

const ALERT_STORE = 'bullion-alerts-v1';

/* Champs surveillables. `get` reçoit les statistiques déjà calculées
   d'une cohorte pour un marché : aucune alerte ne peut donc porter sur
   un chiffre que l'écran n'affiche pas lui-même. */
const ALERT_FIELDS = [
  { key: 'index156', label: 'COT index 3 ans', unit: '', get: (s) => s.index[156] },
  { key: 'index52', label: 'COT index 1 an', unit: '', get: (s) => s.index[52] },
  { key: 'z260', label: 'Z-score 5 ans', unit: 'σ', get: (s) => s.z[260] },
  { key: 'pctHist', label: 'Percentile historique', unit: '%', get: (s) => s.pct[0] },
  { key: 'net', label: 'Net (contrats)', unit: '', get: (s) => s.net },
  { key: 'dNet', label: 'Variation hebdomadaire du net', unit: '', get: (s) => s.dNet },
  { key: 'pctOi', label: '% de l\'open interest', unit: '%', get: (s) => s.pctOi },
  { key: 'bias', label: 'Biais long / court', unit: '%', get: (s) => s.bias },
];

const ALERT_OPS = [
  { key: 'gt', label: 'dépasse', test: (v, t) => v > t },
  { key: 'lt', label: 'passe sous', test: (v, t) => v < t },
];

const Alerts = {
  rules: [],

  load() {
    try {
      const raw = localStorage.getItem(ALERT_STORE);
      this.rules = raw ? JSON.parse(raw) : [];
    } catch { this.rules = []; }
    if (!Array.isArray(this.rules)) this.rules = [];
    return this.rules;
  },

  save() {
    try { localStorage.setItem(ALERT_STORE, JSON.stringify(this.rules)); } catch {}
  },

  add(rule) {
    this.rules.push({ ...rule, id: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}` });
    this.save();
  },

  remove(id) {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.save();
  },

  fields: ALERT_FIELDS,
  ops: ALERT_OPS,

  /* Évaluation. `seriesByMarket` est le cache du comparateur quand il
     existe — sinon on n'évalue que le marché affiché, pour ne pas
     déclencher sept requêtes réseau à chaque rendu. */
  evaluate(seriesByMarket, report, priceOf) {
    const out = [];
    for (const r of this.rules) {
      const rows = seriesByMarket[r.market];
      const market = CFTC.markets[r.market];
      if (!rows || !rows.length || !market) {
        out.push({ rule: r, state: 'inconnu', value: null });
        continue;
      }
      const px = priceOf ? priceOf(r.market) : null;
      const s = Metrics.cohortStats(rows, r.cohort, market, px ? px.price : null);
      const field = ALERT_FIELDS.find((f) => f.key === r.field);
      const op = ALERT_OPS.find((o) => o.key === r.op);
      if (!s || !field || !op) { out.push({ rule: r, state: 'inconnu', value: null }); continue; }
      const v = field.get(s);
      if (v == null) { out.push({ rule: r, state: 'inconnu', value: null }); continue; }
      out.push({
        rule: r, value: v, field, op, market,
        date: rows[rows.length - 1].date,
        state: op.test(v, r.threshold) ? 'declenchee' : 'calme',
        /* distance au seuil : dit si on en est loin ou à un cheveu */
        gap: v - r.threshold,
      });
    }
    return out;
  },

  describe(rule) {
    const f = ALERT_FIELDS.find((x) => x.key === rule.field);
    const o = ALERT_OPS.find((x) => x.key === rule.op);
    const m = CFTC.markets[rule.market];
    const c = (CFTC.cohortsFor(rule.report || 'disagg') || []).find((x) => x.key === rule.cohort);
    return `${m ? m.label : rule.market} · ${c ? c.short : rule.cohort} — `
      + `${f ? f.label : rule.field} ${o ? o.label : rule.op} ${rule.threshold}`;
  },
};

/* ── Export CSV ───────────────────────────────────────────────
   Un poste dont on ne peut pas sortir les chiffres oblige à les
   recopier à la main. Les tableaux sont lus depuis le DOM plutôt que
   reconstruits : ce qui est exporté est exactement ce qui est affiché,
   sans risque de divergence entre les deux chemins. */
function tableToCsv(table) {
  const rows = [...table.querySelectorAll('tr')];
  return rows.map((tr) => [...tr.querySelectorAll('th,td')]
    .map((cell) => {
      /* certaines cellules ne contiennent qu'une barre ou une jauge :
         `data-csv` leur donne la valeur écrite qui leur manque, sinon
         l'export produit une colonne vide là où l'écran montre quelque
         chose */
      const txt = (cell.dataset.csv || cell.textContent).replace(/\s+/g, ' ').trim();
      return /[";\n]/.test(txt) ? `"${txt.replace(/"/g, '""')}"` : txt;
    })
    /* point-virgule : c'est le séparateur qu'attend un tableur
       configuré en français, où la virgule est le séparateur décimal */
    .join(';')).join('\n');
}

function downloadCsv(filename, csv) {
  /* BOM UTF-8 : sans lui, Excel affiche « Ã‰tats-Unis » */
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
