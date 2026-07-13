/* ════════════════════════════════════════════════════════════
   ai.js — Analyste IA :
   1) Rapport d'analyse technique local (fonctionne hors-ligne)
   2) Chat Claude — l'API Anthropic est appelée directement
      depuis le navigateur ; la clé reste en localStorage.
   ════════════════════════════════════════════════════════════ */
'use strict';

const AI_MODEL = 'claude-sonnet-5';
const AI_KEY_STORE = 'terminal-ai-key';
const AI_MAX_HISTORY = 8;

const AI_SYSTEM = `Tu es l'analyste intégré d'un terminal de trading multi-courtiers (crypto via OKX, CFD via XTB).
À chaque message tu reçois un instantané JSON du marché : instrument sélectionné, prix, statistiques 24h,
funding/open interest le cas échéant, indicateurs techniques, carnet d'ordres, positions et compte.
Réponds en français, de façon concise et structurée pour un écran de terminal : titres courts (###),
listes à puces, chiffres précis avec leurs unités. Distingue toujours faits (données fournies) et
interprétation. Termine par une ligne : "Analyse informative — pas un conseil en investissement."`;

const AIPanel = {
  history: [],
  busy: false,

  get key() { try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch { return ''; } },
  set key(v) { try { v ? localStorage.setItem(AI_KEY_STORE, v) : localStorage.removeItem(AI_KEY_STORE); } catch {} },

  buildContext() {
    const sym = state.selected;
    const info = sym ? state.symbols.get(sym) : null;
    const report = state.chart && state.chart.candles.length
      ? TA.report(state.chart.candles, state.chart.digits) : null;
    const atrArr = state.chart && state.chart.candles.length >= 15 ? TA.atr(state.chart.candles) : null;
    const book = state.lastBook && state.lastBook.symbol === sym ? state.lastBook : null;
    return {
      horodatage: new Date().toISOString(),
      courtier: state.provider ? state.provider.label : null,
      mode_trading: state.account && state.account.mode ? state.account.mode : 'paper',
      instrument: info ? {
        symbole: sym, description: info.description,
        bid: info.bid, ask: info.ask,
        variation_24h_pct: info.open24h ? +(((info.last || info.bid) - info.open24h) / info.open24h * 100).toFixed(2) : null,
        haut_24h: info.high24h, bas_24h: info.low24h,
        volume_24h_quote: info.volCcy24h,
        unite_de_temps: tfName(state.tf),
      } : null,
      statistiques: state.lastStats || null,
      analyse_technique: report ? {
        verdict: report.verdict, score: report.score,
        indicateurs: report.items.map((i) => `${i.label}=${i.value} (${i.note})`),
        atr14: atrArr ? atrArr[atrArr.length - 1] : null,
        niveaux: report.levels ? {
          r2: report.fmt(report.levels.r2), r1: report.fmt(report.levels.r1),
          pivot: report.fmt(report.levels.pivot),
          s1: report.fmt(report.levels.s1), s2: report.fmt(report.levels.s2),
        } : null,
      } : null,
      carnet: book ? {
        meilleurs_bids: book.bids.slice(0, 3), meilleurs_asks: book.asks.slice(0, 3),
      } : null,
      positions: state.account ? state.account.getPositions().map((p) => ({
        symbole: p.symbol, sens: p.side === 'buy' ? 'ACHAT' : 'VENTE',
        qty: p.qty, entree: p.entry, sl: p.sl || null, tp: p.tp || null, pl: +(p.pl || 0).toFixed(2),
      })) : [],
      compte: state.account ? state.account.getSummary() : null,
    };
  },

  async ask(question) {
    if (!this.key) throw new Error('Aucune clé API — bouton ⚙ ou commande KEY');
    if (this.busy) throw new Error('Requête IA déjà en cours');
    this.busy = true;
    try {
      this.history.push({
        role: 'user',
        content: `<contexte_marche>${JSON.stringify(this.buildContext())}</contexte_marche>\n\n${question}`,
      });
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
        body: JSON.stringify({ model: AI_MODEL, max_tokens: 1000, system: AI_SYSTEM, messages: this.history }),
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

/* rendu allégé de la réponse : échappe tout, puis gras / titres / listes */
function renderAiText(text) {
  let h = escHtml(text);
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const lines = h.split('\n');
  let out = '', inList = false;
  for (const l of lines) {
    const m = l.match(/^\s*[-•]\s+(.*)$/);
    if (m) {
      if (!inList) { out += '<ul>'; inList = true; }
      out += `<li>${m[1]}</li>`;
    } else {
      if (inList) { out += '</ul>'; inList = false; }
      if (l.startsWith('<h4>')) out += l;
      else if (l.trim()) out += `<p>${l}</p>`;
    }
  }
  if (inList) out += '</ul>';
  return out;
}

/* rapport TA en HTML */
function renderTAReport(symbol, report) {
  if (!report) return '<div class="news-empty">Pas assez de données pour analyser (min. 35 bougies).</div>';
  const col = report.score >= 15 ? 'var(--up)' : report.score <= -15 ? 'var(--dn)' : 'var(--accent)';
  const sig = (s) => s > 0 ? '<span class="up">▲</span>' : s < 0 ? '<span class="dn">▼</span>' : '<span class="dim">■</span>';
  const lv = report.levels;
  return `
  <div class="ta-head">
    <span class="ta-sym">${escHtml(symbol)}</span>
    <span class="ta-verdict" style="color:${col}">${report.verdict}</span>
  </div>
  <div class="ta-gauge"><div class="ta-gauge-fill" style="width:${Math.abs(report.score)}%;background:${col}"></div></div>
  <div class="ta-score">score ${report.score > 0 ? '+' : ''}${report.score} / ±100 · ${tfName(state.tf)}</div>
  <table class="ta-table">
    ${report.items.map((i) => `<tr><td>${sig(i.signal)}</td><td>${i.label}</td><td class="num">${i.value}</td><td class="dim">${i.note}</td></tr>`).join('')}
  </table>
  ${lv ? `<div class="ta-levels">
    <span>R2 <b>${report.fmt(lv.r2)}</b></span><span>R1 <b>${report.fmt(lv.r1)}</b></span>
    <span>Pivot <b>${report.fmt(lv.pivot)}</b></span>
    <span>S1 <b>${report.fmt(lv.s1)}</b></span><span>S2 <b>${report.fmt(lv.s2)}</b></span>
  </div>` : ''}
  <div class="ta-disclaimer">Analyse locale automatique — informative, pas un conseil d'investissement.</div>`;
}
