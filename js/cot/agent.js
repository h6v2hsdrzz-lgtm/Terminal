/* ════════════════════════════════════════════════════════════
   agent.js — l'agent d'analyse.

   Son rôle n'est pas de bavarder : c'est de relier trois choses
   que l'écran affiche séparément — le positionnement institutionnel
   (COT), le régime macro (taux réels, dollar, crédit) et l'actualité —
   puis d'en tirer une lecture argumentée.

   Le contexte est assemblé ici, en JSON structuré, avant chaque
   question : l'agent ne devine rien, il raisonne sur les chiffres
   effectivement affichés à l'écran. C'est ce qui rend ses réponses
   vérifiables — chaque nombre qu'il cite est dans le panneau d'à côté.

   L'appel part directement du navigateur vers l'API Anthropic ; la clé
   reste en localStorage et ne transite par aucun serveur intermédiaire.
   ════════════════════════════════════════════════════════════ */
'use strict';

const AGENT_MODEL = 'claude-sonnet-5';
const AGENT_KEY_STORE = 'bullion-agent-key';
const AGENT_MAX_HISTORY = 10;

const AGENT_SYSTEM = `Tu es l'analyste d'un poste de suivi du positionnement institutionnel sur l'or et l'argent.

Ton matériau : le rapport COT de la CFTC (positions hebdomadaires des producteurs, des swap dealers,
des hedge funds et des petits porteurs sur le COMEX), un instantané macro (taux réels, dollar, points
morts d'inflation, spreads de crédit, volatilité), les prix, et un flux de news. Tout t'est fourni en
JSON à chaque message : ne travaille QUE sur ces chiffres, ne les invente jamais, et ne cite pas de
donnée absente du contexte.

Méthode :
1. Pars du positionnement : qui est chargé, dans quel sens, à quel extrême historique.
2. Confronte-le au régime macro : les moteurs de l'or vont-ils dans le sens du positionnement ?
3. Regarde les news : y a-t-il un catalyseur qui explique ou menace cette configuration ?
4. Conclus sur ce que cette combinaison implique — asymétrie, risque de débouclage, niveaux à surveiller.

Règles de rigueur :
- Sépare toujours explicitement le FAIT (chiffre fourni) de l'INTERPRÉTATION.
- Cite les chiffres avec leur unité et leur date d'arrêté ; le COT a jusqu'à 3 jours de décalage à
  la publication, dis-le quand ça compte.
- Quand les signaux se contredisent, dis-le au lieu de trancher artificiellement.
- Une contrepartie institutionnelle n'est pas un « pari » : un swap dealer vendeur couvre un livre,
  ce n'est pas un avis baissier. Ne confonds jamais couverture et spéculation.
- Pas de prévision de prix chiffrée, pas de recommandation d'achat ou de vente.

Forme : français, dense, orienté écran de trading. Titres courts en ###, listes à puces, chiffres
précis. Pas de préambule ni de formule de politesse — entre directement dans l'analyse.
Termine par : "Analyse informative — pas un conseil en investissement."`;

/* Analyses pré-câblées : chacune cadre l'agent sur une question
   précise plutôt que de le laisser tout survoler. `effort` module la
   profondeur de raisonnement — inutile de dépenser sur une lecture
   descriptive, indispensable sur une synthèse à scénarios. */
const AGENT_PRESETS = [
  {
    id: 'cot', label: 'Lecture du COT', icon: '◧', effort: 'medium', tokens: 3000,
    prompt: 'Lis le dernier rapport COT du métal sélectionné : qui a bougé cette semaine, dans quel sens, et à quel point la position du managed money est extrême dans son histoire. Distingue nettement la couverture commerciale de la spéculation directionnelle.',
  },
  {
    id: 'macro', label: 'Régime macro', icon: '◫', effort: 'medium', tokens: 3000,
    prompt: 'Analyse le régime macro actuel du point de vue des métaux précieux : que font les taux réels, le dollar, les points morts d\'inflation et les spreads de crédit, et est-ce que cet environnement soutient ou contrarie le positionnement institutionnel observé ?',
  },
  {
    id: 'news', label: 'Interprétation des news', icon: '◨', effort: 'medium', tokens: 3000,
    prompt: 'Passe en revue les dépêches fournies. Lesquelles sont réellement susceptibles de déplacer l\'or ou l\'argent, et par quel canal (taux, dollar, refuge, offre physique) ? Écarte explicitement le bruit et dis ce qui n\'est pas une information exploitable.',
  },
  {
    id: 'synth', label: 'Synthèse & scénarios', icon: '◍', effort: 'high', tokens: 5000,
    prompt: 'Fais la synthèse des trois plans — positionnement, macro, actualité. Où convergent-ils, où se contredisent-ils ? Décris ensuite les configurations qui invalideraient la lecture dominante, et les niveaux ou publications à surveiller.',
  },
  {
    id: 'risk', label: 'Cartographie du risque', icon: '◈', effort: 'high', tokens: 4000,
    prompt: 'Cartographie le risque de la configuration actuelle : quel scénario ferait le plus mal au consensus institutionnel en place ? Évalue le risque de débouclage forcé (concentration, net par opérateur, poids dans l\'open interest) et ce qui le déclencherait.',
  },
  {
    id: 'ratio', label: 'Arbitrage or / argent', icon: '◐', effort: 'high', tokens: 4000,
    prompt: 'Compare le positionnement institutionnel sur l\'or et sur l\'argent. Le décalage entre les deux est-il inhabituel au regard de son historique, et qu\'est-ce que cela dit du ratio or/argent ?',
  },
];

const Agent = {
  history: [],
  busy: false,
  controller: null,

  get key() { try { return localStorage.getItem(AGENT_KEY_STORE) || ''; } catch { return ''; } },
  set key(v) {
    try { v ? localStorage.setItem(AGENT_KEY_STORE, v) : localStorage.removeItem(AGENT_KEY_STORE); } catch {}
  },

  presets: AGENT_PRESETS,

  /* ── Contexte ─────────────────────────────────────────────
     Assemblé à chaque question à partir de l'état réellement
     affiché. Volontairement nommé en français : les clés font
     partie du prompt, et des noms explicites valent mieux qu'un
     glossaire à part. */
  buildContext(state) {
    const { rows, report, basis, marketKey, market, price } = state;
    if (!rows || !rows.length) return null;

    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    const cohorts = CFTC.cohortsFor(report);
    const px = price ? price.price : null;

    const cohortBlock = {};
    for (const c of cohorts) {
      const s = Metrics.cohortStats(rows, c.key, market, px);
      if (!s) continue;
      cohortBlock[c.label] = {
        role: c.side === 'spec' ? 'spéculatif' : c.side === 'hedge' ? 'couverture' : 'petits porteurs',
        long: s.long, short: s.short, net: s.net,
        variation_hebdo_net: s.dNet,
        variation_4_semaines: s.chg4w,
        pct_open_interest: +s.pctOi.toFixed(1),
        cot_index_1an: s.index[52] == null ? null : +s.index[52].toFixed(0),
        cot_index_3ans: s.index[156] == null ? null : +s.index[156].toFixed(0),
        z_score_5ans: s.z[260] == null ? null : +s.z[260].toFixed(2),
        percentile_historique: s.pct[0] == null ? null : +s.pct[0].toFixed(0),
        nb_operateurs: s.traders || null,
        net_par_operateur: s.netPerTrader == null ? null : Math.round(s.netPerTrader),
        notionnel_usd: s.notional == null ? null : Math.round(s.notional),
      };
    }

    const joined = state.joined || [];
    const tension = Metrics.tension(rows, report, market, joined);
    const regime = Macro.regime();
    const analogues = joined.length ? Metrics.analogues(joined) : null;

    const macroBlock = {};
    if (regime) {
      for (const p of regime.parts) {
        macroBlock[p.label] = {
          niveau: p.last, unite: p.unit, variation: +p.delta.toFixed(3),
          fenetre_jours: p.window,
          effet_sur_lor: p.value > 0.1 ? 'favorable' : p.value < -0.1 ? 'défavorable' : 'neutre',
        };
      }
    }

    return {
      horodatage: new Date().toISOString(),
      metal: {
        nom: market.label, contrat: market.desc, bourse: market.exchange,
        taille_contrat: `${market.size} ${market.unit}`,
        prix_spot: px, source_prix: price ? price.source : null,
      },
      rapport: {
        type: report === 'legacy' ? 'Legacy (non-commerciaux / commerciaux)' : 'Disaggregated (producteurs / banques / hedge funds)',
        base: basis === 'combined' ? 'futures + options' : 'futures seuls',
        date_arrete: last.date,
        arrete_precedent: prev ? prev.date : null,
        open_interest: last.oi,
        variation_open_interest: last.dOi,
        nb_operateurs_total: last.traders,
        profondeur_historique: `${rows.length} semaines depuis ${rows[0].date}`,
      },
      positionnement: cohortBlock,
      concentration: {
        net_4_plus_gros_long_pct: last.conc.net4Long,
        net_4_plus_gros_short_pct: last.conc.net4Short,
        net_8_plus_gros_long_pct: last.conc.net8Long,
        net_8_plus_gros_short_pct: last.conc.net8Short,
      },
      score_de_tension: tension ? {
        valeur: +tension.score.toFixed(1), verdict: tension.verdict,
        composantes: tension.parts.map((p) => `${p.label} : ${p.detail}`),
      } : null,
      regime_macro: regime ? {
        score: +regime.score.toFixed(1), verdict: regime.verdict, moteurs: macroBlock,
      } : null,
      correlations: {
        or_vs_taux_reel_10a_52s: (() => { const c = Macro.correlation('GOLD', 'DFII10'); return c ? +c.r.toFixed(2) : null; })(),
        or_vs_dollar_52s: (() => { const c = Macro.correlation('GOLD', 'DTWEXBGS'); return c ? +c.r.toFixed(2) : null; })(),
        net_specs_vs_prix_52s: joined.length ? (() => {
          const c = Metrics.correlation(joined, 52); return c == null ? null : +c.toFixed(2);
        })() : null,
      },
      divergence_prix_positionnement: joined.length
        ? (Metrics.divergence(joined, 26) || {}).label : null,
      analogues_historiques: analogues && analogues.summary ? {
        cot_index_actuel: +analogues.current.toFixed(0),
        echantillon: analogues.sample,
        performance_prix_apres: Object.entries(analogues.summary).map(([h, s]) =>
          `${h} semaines : médiane ${s.median.toFixed(1)} %, ${s.positive.toFixed(0)} % de cas positifs (n=${s.n})`),
        avertissement: 'Statistique descriptive sur petit échantillon — ni prévision ni garantie.',
      } : null,
      ecart_or_argent: state.spread ? {
        lecture: state.spread.reading,
        z_score: state.spread.z == null ? null : +state.spread.z.toFixed(2),
      } : null,
      news: Macro.newsItems({ limit: 25 }).map((n) => ({
        titre: n.title, source: n.source, date: n.published, portee: n.scope,
      })),
      fraicheur_donnees: {
        cot: last.date,
        macro: Macro.data ? Macro.data.generated : null,
        news: Macro.news ? Macro.news.generated : null,
      },
    };
  },

  /* ── Appel ────────────────────────────────────────────────
     Réponse diffusée en flux : sur une analyse de plusieurs
     milliers de tokens, attendre le bloc complet donne
     l'impression d'un écran figé. `onDelta` reçoit le texte au
     fil de l'eau, `onThinking` signale la phase de raisonnement. */
  async ask(question, ctx, { effort = 'medium', tokens = 3000, onDelta, onThinking } = {}) {
    if (!this.key) throw new Error('Aucune clé API — bouton « Clé API » en haut à droite.');
    if (this.busy) throw new Error('Une analyse est déjà en cours.');

    this.busy = true;
    this.controller = new AbortController();

    const payload = ctx
      ? `<contexte_desk>\n${JSON.stringify(ctx)}\n</contexte_desk>\n\n${question}`
      : question;
    this.history.push({ role: 'user', content: payload });
    while (this.history.length > AGENT_MAX_HISTORY) this.history.shift();
    if (this.history[0].role !== 'user') this.history.shift();

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: this.controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: AGENT_MODEL,
          max_tokens: tokens,
          system: AGENT_SYSTEM,
          messages: this.history,
          stream: true,
          /* raisonnement adaptatif : le modèle module lui-même sa
             profondeur ; `effort` fixe le curseur coût / qualité */
          thinking: { type: 'adaptive' },
          output_config: { effort },
        }),
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          msg = (j.error && j.error.message) || msg;
        } catch {}
        this.history.pop();
        throw new Error(msg);
      }

      const text = await this.consume(res, onDelta, onThinking);
      if (!text.trim()) {
        this.history.pop();
        throw new Error('Réponse vide du modèle.');
      }
      this.history.push({ role: 'assistant', content: text });
      return text;
    } catch (e) {
      if (e.name === 'AbortError') {
        if (this.history.length && this.history[this.history.length - 1].role === 'user') this.history.pop();
        throw new Error('Analyse interrompue.');
      }
      throw e;
    } finally {
      this.busy = false;
      this.controller = null;
    }
  },

  /* lecture du flux SSE : les événements sont séparés par une ligne
     vide, mais un chunk réseau peut couper n'importe où — d'où le
     tampon conservé entre deux lectures */
  async consume(res, onDelta, onThinking) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let out = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          let ev;
          try { ev = JSON.parse(raw); } catch { continue; }

          if (ev.type === 'content_block_start' && ev.content_block) {
            if (ev.content_block.type === 'thinking' && onThinking) onThinking(true);
            if (ev.content_block.type === 'text' && onThinking) onThinking(false);
          } else if (ev.type === 'content_block_delta' && ev.delta) {
            if (ev.delta.type === 'text_delta') {
              out += ev.delta.text;
              if (onDelta) onDelta(ev.delta.text, out);
            }
          } else if (ev.type === 'error') {
            throw new Error((ev.error && ev.error.message) || 'Erreur de flux');
          }
        }
      }
    }
    if (onThinking) onThinking(false);
    return out;
  },

  stop() { if (this.controller) this.controller.abort(); },
  reset() { this.history = []; },
};

/* rendu markdown minimal : tout est échappé d'abord, le balisage
   n'est réintroduit qu'ensuite — le texte du modèle ne peut donc
   jamais injecter de HTML */
function renderAgentText(text) {
  let h = escapeHtml(text);
  h = h.replace(/^#{1,4}\s+(.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');

  const out = [];
  let inList = false;
  for (const line of h.split('\n')) {
    const li = line.match(/^\s*[-•*]\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${li[1]}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (line.startsWith('<h4>')) out.push(line);
    else if (line.trim()) out.push(`<p>${line}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
