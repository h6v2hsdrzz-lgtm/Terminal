/* ════════════════════════════════════════════════════════════
   ai.js — Panneau IA :
   1) Analyse technique automatique (moteur TA local, hors-ligne)
   2) Chat Claude (API Anthropic appelée directement depuis le
      navigateur — la clé reste dans le localStorage, rien ne
      transite par un serveur tiers).
   ════════════════════════════════════════════════════════════ */
'use strict';

const AI_MODEL = 'claude-sonnet-5';
const AI_KEY_STORE = 'xtb-term-ai-key';
const AI_MAX_HISTORY = 8;

const AI_SYSTEM = `Tu es l'analyste IA intégré d'un terminal de trading connecté à un compte CFD XTB.
Tu reçois en contexte un instantané JSON : instrument sélectionné, prix, indicateurs techniques,
positions ouvertes et état du compte. Réponds en français, de manière concise et structurée
(listes courtes, chiffres précis), adaptée à un écran de terminal. Termine par une ligne de
rappel que ceci est une analyse informative et non un conseil en investissement personnalisé.`;

const AIPanel = {
  history: [],   // {role, content} pour l'API
  busy: false,

  get key() { try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch { return ''; } },
  set key(v) { try { v ? localStorage.setItem(AI_KEY_STORE, v) : localStorage.removeItem(AI_KEY_STORE); } catch {} },

  /* contexte marché transmis au modèle */
  buildContext() {
    const sym = state.selected;
    const info = sym ? state.symbols.get(sym) : null;
    const report = state.chart && state.chart.candles.length
      ? TA.report(state.chart.candles, state.chart.digits) : null;
    return {
      horodatage: new Date().toISOString(),
      mode: state.mode,
      instrument: info ? {
        symbole: sym, description: info.description, bid: info.bid, ask: info.ask,
        variation_jour_pct: info.prevClose ? +((info.bid - info.prevClose) / info.prevClose * 100).toFixed(2) : null,
        periode_graphique: periodName(state.period),
      } : null,
      analyse_technique: report ? {
        verdict: report.verdict, score: report.score,
        indicateurs: report.items.map((i) => `${i.label}=${i.value} (${i.note})`),
        niveaux: report.levels ? {
          resistance2: report.fmt(report.levels.r2), resistance1: report.fmt(report.levels.r1),
          pivot: report.fmt(report.levels.pivot),
          support1: report.fmt(report.levels.s1), support2: report.fmt(report.levels.s2),
        } : null,
      } : null,
      positions: [...state.positions.values()].map((t) => ({
        symbole: t.symbol, sens: t.cmd === XAPI_CMD.BUY ? 'ACHAT' : 'VENTE',
        volume: t.volume, prix_ouverture: t.open_price, pl: t.profit,
      })),
      compte: {
        balance: state.account.balance, equity: state.account.equity,
        marge: state.account.margin, devise: state.account.currency,
      },
    };
  },

  async ask(question) {
    if (!this.key) throw new Error('Aucune clé API — tapez KEY <GO> pour configurer');
    if (this.busy) throw new Error('Requête IA déjà en cours');
    this.busy = true;
    try {
      this.history.push({ role: 'user', content: `<contexte_marche>${JSON.stringify(this.buildContext())}</contexte_marche>\n\n${question}` });
      while (this.history.length > AI_MAX_HISTORY) this.history.shift();
      if (this.history[0].role !== 'user') this.history.shift();

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: AI_MODEL, max_tokens: 900, system: AI_SYSTEM, messages: this.history,
        }),
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { msg = (await res.json()).error.message || msg; } catch {}
        this.history.pop();
        throw new Error(msg);
      }
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      this.history.push({ role: 'assistant', content: text });
      return text;
    } finally {
      this.busy = false;
    }
  },

  reset() { this.history = []; },
};

/* ─────────── rendu du rapport TA en HTML ─────────── */

function renderTAReport(symbol, report) {
  if (!report) return '<div class="news-empty">Pas assez de données pour analyser (min. 35 bougies).</div>';
  const col = report.score >= 15 ? 'var(--up)' : report.score <= -15 ? 'var(--dn)' : 'var(--yellow)';
  const pct = Math.abs(report.score);
  const sig = (s) => s > 0 ? '<span class="up">▲</span>' : s < 0 ? '<span class="dn">▼</span>' : '<span class="dim">■</span>';
  const lv = report.levels;
  return `
  <div class="ta-head">
    <span class="ta-sym">${escHtml(symbol)}</span>
    <span class="ta-verdict" style="color:${col}">${report.verdict}</span>
  </div>
  <div class="ta-gauge"><div class="ta-gauge-fill" style="width:${pct}%;background:${col}"></div></div>
  <div class="ta-score dim">score composite ${report.score > 0 ? '+' : ''}${report.score} / ±100 — ${periodName(state.period)}</div>
  <table class="ta-table">
    ${report.items.map((i) => `<tr><td>${sig(i.signal)}</td><td>${i.label}</td><td>${i.value}</td><td class="dim">${i.note}</td></tr>`).join('')}
  </table>
  ${lv ? `<div class="ta-levels">
    <span>R2 <b>${report.fmt(lv.r2)}</b></span><span>R1 <b>${report.fmt(lv.r1)}</b></span>
    <span>PIV <b>${report.fmt(lv.pivot)}</b></span>
    <span>S1 <b>${report.fmt(lv.s1)}</b></span><span>S2 <b>${report.fmt(lv.s2)}</b></span>
  </div>` : ''}
  <div class="ta-disclaimer">Analyse locale automatique — informative, pas un conseil d'investissement.</div>`;
}
