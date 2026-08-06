/* ════════════════════════════════════════════════════════════
   analytics.js — Moteur de statistiques de trading (pur, sans DOM).
   Entrée : tableau de trades normalisés (voir trades.js).
   Sortie : un objet unique consommé par l'interface d'analyse.

   Conventions assumées et affichées telles quelles dans l'UI :
     • 1 R = perte moyenne (faute de stop-loss historisé par OKX)
     • Sharpe / Sortino / Calmar sur P/L quotidiens, annualisés en
       365 jours (le crypto ne ferme pas)
     • toutes les métriques sont NETTES (frais + financement inclus)
   ════════════════════════════════════════════════════════════ */
'use strict';

const Analytics = (() => {

  /* ─────────────── utilitaires statistiques ─────────────── */

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  function stdev(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
  }
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const dayKey = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const monthKey = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  /* bloc de stats réutilisable pour tout regroupement */
  function block(trades) {
    const n = trades.length;
    const nets = trades.map((t) => t.net);
    const wins = trades.filter((t) => t.net > 0);
    const losses = trades.filter((t) => t.net < 0);
    const gw = sum(wins.map((t) => t.net));
    const gl = Math.abs(sum(losses.map((t) => t.net)));
    const net = sum(nets);
    return {
      n, net,
      wins: wins.length, losses: losses.length,
      breakeven: n - wins.length - losses.length,
      winRate: n ? wins.length / n * 100 : 0,
      grossWin: gw, grossLoss: gl,
      profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
      avgWin: wins.length ? gw / wins.length : 0,
      avgLoss: losses.length ? gl / losses.length : 0,
      payoff: losses.length && wins.length ? (gw / wins.length) / (gl / losses.length) : 0,
      expectancy: n ? net / n : 0,
      avgRetMargin: mean(trades.map((t) => t.retMargin)),
      volume: sum(trades.map((t) => t.notional)),
      fees: sum(trades.map((t) => t.fee)),
      funding: sum(trades.map((t) => t.funding)),
      best: n ? Math.max(...nets) : 0,
      worst: n ? Math.min(...nets) : 0,
      avgDuration: mean(trades.map((t) => t.durationMs)),
    };
  }

  function groupBy(trades, keyFn, labelFn) {
    const m = new Map();
    for (const t of trades) {
      const k = keyFn(t);
      if (k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return [...m.entries()].map(([k, list]) => ({
      key: k,
      label: labelFn ? labelFn(k) : String(k),
      ...block(list),
      trades: list,
    }));
  }

  /* ─────────────── courbe de capital & drawdown ─────────────── */

  function equityCurve(trades, initialEquity) {
    const pts = [];
    let cum = 0, peak = 0, maxDD = 0, maxDDPct = 0;
    let peakTime = trades.length ? trades[0].closeTime : 0;
    let ddStart = peakTime, maxDDDur = 0, maxDDStart = 0, maxDDEnd = 0;
    const under = [];

    for (const t of trades) {
      cum += t.net;
      const eq = initialEquity + cum;
      if (cum > peak) { peak = cum; peakTime = t.closeTime; ddStart = t.closeTime; }
      const dd = peak - cum;                       // en devise
      const ddPct = initialEquity + peak > 0 ? dd / (initialEquity + peak) * 100 : 0;
      if (dd > maxDD) { maxDD = dd; maxDDStart = ddStart; maxDDEnd = t.closeTime; }
      if (ddPct > maxDDPct) maxDDPct = ddPct;
      if (dd > 0) maxDDDur = Math.max(maxDDDur, t.closeTime - ddStart);
      pts.push({ t: t.closeTime, cum, equity: eq, dd, ddPct });
      under.push({ t: t.closeTime, v: -ddPct });
    }
    const currentDD = pts.length ? peak - cum : 0;
    // Ulcer index : moyenne quadratique des drawdowns (pénalise durée + profondeur)
    const ulcer = pts.length ? Math.sqrt(mean(pts.map((p) => p.ddPct ** 2))) : 0;
    return {
      points: pts, under, maxDD, maxDDPct, maxDDDur, maxDDStart, maxDDEnd,
      currentDD, currentDDPct: initialEquity + peak > 0 ? currentDD / (initialEquity + peak) * 100 : 0,
      ulcer, finalCum: cum, peak,
    };
  }

  /* P/L agrégé par jour, avec les jours sans trade à 0 (pour Sharpe & calendrier) */
  function dailySeries(trades) {
    if (!trades.length) return [];
    const m = new Map();
    for (const t of trades) {
      const k = dayKey(t.closeTime);
      const e = m.get(k) || { key: k, t: 0, net: 0, n: 0, wins: 0, volume: 0, fees: 0 };
      e.net += t.net; e.n++; e.volume += t.notional; e.fees += t.fee;
      if (t.net > 0) e.wins++;
      m.set(k, e);
    }
    const first = new Date(trades[0].closeTime);
    const last = new Date(trades[trades.length - 1].closeTime);
    first.setHours(0, 0, 0, 0); last.setHours(0, 0, 0, 0);
    const out = [];
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      const k = dayKey(d.getTime());
      const e = m.get(k);
      out.push(e ? { ...e, t: new Date(d).getTime() } : { key: k, t: new Date(d).getTime(), net: 0, n: 0, wins: 0, volume: 0, fees: 0 });
    }
    return out;
  }

  /* ─────────────── métriques ajustées du risque ─────────────── */

  function riskAdjusted(daily, initialEquity, totalNet) {
    if (daily.length < 2) return { sharpe: 0, sortino: 0, calmar: 0, annualVol: 0, days: daily.length };
    // rendement quotidien rapporté au capital en début de journée
    const rets = [];
    let eq = initialEquity;
    for (const d of daily) {
      if (eq > 0) rets.push(d.net / eq);
      eq += d.net;
    }
    const m = mean(rets), sd = stdev(rets);
    const neg = rets.filter((r) => r < 0);
    const dd = neg.length ? Math.sqrt(sum(neg.map((r) => r * r)) / rets.length) : 0;
    const A = Math.sqrt(365);
    return {
      sharpe: sd > 0 ? m / sd * A : 0,
      sortino: dd > 0 ? m / dd * A : 0,
      annualVol: sd * A * 100,
      avgDailyRet: m * 100,
      days: daily.length,
      tradingDays: daily.filter((d) => d.n > 0).length,
    };
  }

  /* ─────────────── séries de gains / pertes ─────────────── */

  function streaks(trades) {
    let maxW = 0, maxL = 0, curW = 0, curL = 0, cur = 0;
    let bestRun = 0, worstRun = 0, run = 0;
    for (const t of trades) {
      if (t.net > 0) {
        curW++; curL = 0; maxW = Math.max(maxW, curW);
        run = run > 0 ? run + t.net : t.net;
        bestRun = Math.max(bestRun, run);
      } else if (t.net < 0) {
        curL++; curW = 0; maxL = Math.max(maxL, curL);
        run = run < 0 ? run + t.net : t.net;
        worstRun = Math.min(worstRun, run);
      }
      cur = t.net > 0 ? (cur >= 0 ? cur + 1 : 1) : (t.net < 0 ? (cur <= 0 ? cur - 1 : -1) : cur);
    }
    return { maxWin: maxW, maxLoss: maxL, current: cur, bestRun, worstRun };
  }

  /* ─────────────── lecture comportementale ─────────────── */

  /* gravité d'un sous-ensemble face au reste de l'activité.
     Un écart d'espérance minime ne mérite pas une alerte rouge : on exige
     un écart relatif significatif, et le rouge est réservé aux habitudes
     qui perdent réellement de l'argent. */
  function severityVs(b, core) {
    if (!b.n) return 'ok';
    const gap = b.expectancy - core.expectancy;
    const rel = Math.abs(core.expectancy) > 1e-9 ? gap / Math.abs(core.expectancy) : (gap < 0 ? -1 : 0);
    if (b.net < 0 && rel < -0.2) return 'bad';
    if (b.net < 0 || rel < -0.35) return 'warn';
    return 'ok';
  }

  function behaviour(trades, daily, core) {
    const out = [];
    const byOpen = [...trades].sort((a, b) => a.openTime - b.openTime);

    /* 1. trading de revanche : entrée < 30 min après une clôture perdante */
    const closes = [...trades].sort((a, b) => a.closeTime - b.closeTime);
    const revenge = [];
    for (const t of byOpen) {
      const prior = closes.filter((c) => c.closeTime <= t.openTime && c.closeTime > t.openTime - 30 * 60000);
      if (prior.some((c) => c.net < 0)) revenge.push(t);
    }
    if (revenge.length >= 3) {
      const b = block(revenge);
      out.push({
        id: 'revenge', severity: severityVs(b, core),
        title: 'Trades de revanche',
        detail: `${revenge.length} trades ouverts dans les 30 min suivant une perte (${(revenge.length / trades.length * 100).toFixed(0)}% du total).`,
        stat: b, compare: b.expectancy - core.expectancy,
      });
    }

    /* 2. tilt : après 2 pertes consécutives ou plus */
    const tilt = [];
    let consecutive = 0;
    for (const t of closes) {
      if (consecutive >= 2) tilt.push(t);
      consecutive = t.net < 0 ? consecutive + 1 : 0;
    }
    if (tilt.length >= 3) {
      const b = block(tilt);
      out.push({
        id: 'tilt', severity: severityVs(b, core),
        title: 'Trades après 2 pertes d\'affilée',
        detail: `${tilt.length} trades pris alors que la série était déjà négative.`,
        stat: b, compare: b.expectancy - core.expectancy,
      });
    }

    /* 3. surtrading : journées au volume de trades anormalement élevé */
    const active = daily.filter((d) => d.n > 0);
    if (active.length >= 5) {
      const counts = active.map((d) => d.n);
      const seuil = Math.max(mean(counts) + stdev(counts), mean(counts) * 1.5);
      const heavy = active.filter((d) => d.n >= seuil);
      if (heavy.length) {
        const heavyNet = sum(heavy.map((d) => d.net));
        const normalNet = sum(active.filter((d) => d.n < seuil).map((d) => d.net));
        out.push({
          id: 'overtrading', severity: heavyNet < 0 ? 'bad' : 'ok',
          title: 'Journées de surtrading',
          detail: `${heavy.length} journées à ${seuil.toFixed(0)}+ trades : ${heavyNet >= 0 ? '+' : ''}${heavyNet.toFixed(0)} contre ${normalNet >= 0 ? '+' : ''}${normalNet.toFixed(0)} les autres jours.`,
          value: heavyNet,
        });
      }
    }

    /* 4. couper ses gains / laisser courir ses pertes */
    const w = trades.filter((t) => t.net > 0 && t.durationMs > 0);
    const l = trades.filter((t) => t.net < 0 && t.durationMs > 0);
    if (w.length >= 3 && l.length >= 3) {
      const dw = mean(w.map((t) => t.durationMs)), dl = mean(l.map((t) => t.durationMs));
      const ratio = dw > 0 ? dl / dw : 0;
      out.push({
        id: 'duration', severity: ratio > 1.3 ? 'bad' : 'ok',
        title: ratio > 1.3 ? 'Pertes gardées plus longtemps que les gains' : 'Durées gains / pertes cohérentes',
        detail: `Gagnants tenus ${fmtDur(dw)} en moyenne, perdants ${fmtDur(dl)} (rapport ${ratio.toFixed(2)}×).`,
        value: ratio,
      });
    }

    /* 5. poids des frais */
    const grossAbs = Math.abs(core.grossWin) + Math.abs(core.grossLoss);
    if (core.fees > 0 && grossAbs > 0) {
      const drag = core.fees / grossAbs * 100;
      out.push({
        id: 'fees', severity: drag > 15 ? 'bad' : (drag > 7 ? 'warn' : 'ok'),
        title: 'Poids des frais',
        detail: `${core.fees.toFixed(0)} de frais, soit ${drag.toFixed(1)}% du flux brut. Sans frais le résultat serait de ${(core.net + core.fees).toFixed(0)}.`,
        value: drag,
      });
    }

    /* 6. liquidations */
    const liq = trades.filter((t) => t.liquidated);
    if (liq.length) {
      out.push({
        id: 'liq', severity: 'bad',
        title: 'Liquidations',
        detail: `${liq.length} position(s) liquidée(s) pour ${sum(liq.map((t) => t.net)).toFixed(0)}. Levier moyen sur ces trades : ${mean(liq.map((t) => t.lever)).toFixed(1)}×.`,
        value: liq.length,
      });
    }

    /* 7. régularité de la taille de position */
    if (trades.length >= 10) {
      const notionals = trades.map((t) => t.notional).filter((x) => x > 0);
      const cv = mean(notionals) > 0 ? stdev(notionals) / mean(notionals) : 0;
      const sorted = [...trades].sort((a, b) => b.notional - a.notional);
      const top = sorted.slice(0, Math.max(1, Math.round(trades.length * 0.1)));
      out.push({
        id: 'sizing', severity: cv > 1 ? 'bad' : (cv > 0.6 ? 'warn' : 'ok'),
        title: cv > 1 ? 'Tailles de position très irrégulières' : 'Régularité des tailles',
        detail: `Coefficient de variation ${cv.toFixed(2)}. Les 10% de trades les plus gros pèsent ${sum(top.map((t) => t.net)) >= 0 ? '+' : ''}${sum(top.map((t) => t.net)).toFixed(0)} sur un total de ${core.net.toFixed(0)}.`,
        value: cv,
      });
    }

    /* 8. concentration sur un instrument */
    const bySym = groupBy(trades, (t) => t.instId);
    if (bySym.length > 1) {
      const worst = [...bySym].sort((a, b) => a.net - b.net)[0];
      const best = [...bySym].sort((a, b) => b.net - a.net)[0];
      if (worst.net < 0 && Math.abs(worst.net) > Math.abs(core.net) * 0.3) {
        out.push({
          id: 'concentration', severity: 'warn',
          title: 'Instrument qui coûte le plus',
          detail: `${worst.label} : ${worst.net.toFixed(0)} sur ${worst.n} trades (${worst.winRate.toFixed(0)}% de réussite). Sans lui : ${(core.net - worst.net).toFixed(0)}.`,
          value: worst.net,
        });
      }
      if (best.net > 0) {
        out.push({
          id: 'edge', severity: 'ok',
          title: 'Meilleur instrument',
          detail: `${best.label} : +${best.net.toFixed(0)} sur ${best.n} trades (${best.winRate.toFixed(0)}% de réussite, PF ${best.profitFactor === Infinity ? '∞' : best.profitFactor.toFixed(2)}).`,
          value: best.net,
        });
      }
    }

    /* 9. trading nocturne */
    const night = trades.filter((t) => { const h = new Date(t.openTime).getHours(); return h >= 0 && h < 6; });
    if (night.length >= 3) {
      const b = block(night);
      out.push({
        id: 'night', severity: severityVs(b, core),
        title: 'Trading nocturne (00h–06h)',
        detail: `${night.length} trades, résultat ${b.net >= 0 ? '+' : ''}${b.net.toFixed(0)}, réussite ${b.winRate.toFixed(0)}%.`,
        stat: b, compare: b.expectancy - core.expectancy,
      });
    }

    const order = { bad: 0, warn: 1, ok: 2 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  function fmtDur(ms) {
    if (!ms || ms < 0) return '—';
    const m = ms / 60000;
    if (m < 60) return `${m.toFixed(0)} min`;
    const h = m / 60;
    if (h < 48) return `${h.toFixed(1)} h`;
    return `${(h / 24).toFixed(1)} j`;
  }

  /* ─────────────── buckets ─────────────── */

  const DUR_BUCKETS = [
    { max: 5 * 60000, label: '< 5 min' },
    { max: 30 * 60000, label: '5–30 min' },
    { max: 4 * 3600000, label: '30 min – 4 h' },
    { max: 24 * 3600000, label: '4–24 h' },
    { max: 7 * 86400000, label: '1–7 j' },
    { max: Infinity, label: '> 7 j' },
  ];
  const durBucket = (ms) => (DUR_BUCKETS.find((b) => ms < b.max) || DUR_BUCKETS[DUR_BUCKETS.length - 1]).label;

  const LEV_BUCKETS = [
    { max: 1.001, label: 'Sans levier' },
    { max: 3.001, label: '≤ 3×' },
    { max: 10.001, label: '3–10×' },
    { max: 25.001, label: '10–25×' },
    { max: Infinity, label: '> 25×' },
  ];
  const levBucket = (l) => (LEV_BUCKETS.find((b) => (l || 1) < b.max) || LEV_BUCKETS[LEV_BUCKETS.length - 1]).label;

  const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

  /* ─────────────── calcul principal ─────────────── */

  function compute(rawTrades, opts = {}) {
    const trades = [...(rawTrades || [])]
      .filter((t) => t && t.closeTime && isFinite(t.net))
      .sort((a, b) => a.closeTime - b.closeTime);

    const core = block(trades);
    const nets = trades.map((t) => t.net);
    const sd = stdev(nets);

    // capital de référence : fourni par le compte réel si disponible
    const initialEquity = opts.initialEquity > 0
      ? opts.initialEquity
      : Math.max(1000, Math.abs(core.net) * 3, quantile([...trades.map((t) => t.margin)].sort((a, b) => a - b), 0.9) * 20 || 1000);

    const eq = equityCurve(trades, initialEquity);
    const daily = dailySeries(trades);
    const risk = riskAdjusted(daily, initialEquity, core.net);
    const str = streaks(trades);

    // 1 R = perte moyenne (OKX n'historise pas le stop-loss d'origine)
    const R = core.avgLoss || 1;
    const rMultiples = trades.map((t) => t.net / R);
    const sortedNets = [...nets].sort((a, b) => a - b);

    const kellyW = core.winRate / 100;
    const kellyR = core.payoff;
    const kelly = kellyR > 0 ? (kellyW - (1 - kellyW) / kellyR) * 100 : 0;

    const period = trades.length
      ? { from: trades[0].closeTime, to: trades[trades.length - 1].closeTime }
      : { from: 0, to: 0 };
    const spanDays = Math.max(1, (period.to - period.from) / 86400000);

    const calmar = eq.maxDDPct > 0
      ? (core.net / initialEquity * 100) * (365 / spanDays) / eq.maxDDPct
      : 0;

    return {
      trades,
      core,
      period, spanDays, initialEquity,

      /* dispersion & qualité du système */
      stdev: sd,
      sqn: sd > 0 && trades.length ? Math.sqrt(trades.length) * core.expectancy / sd : 0,
      kelly,
      expectancyR: R ? core.expectancy / R : 0,
      R,
      rMultiples,
      median: quantile(sortedNets, 0.5),
      p05: quantile(sortedNets, 0.05),
      p95: quantile(sortedNets, 0.95),

      /* capital */
      equity: eq,
      daily,
      risk: { ...risk, calmar },
      recovery: eq.maxDD > 0 ? core.net / eq.maxDD : (core.net > 0 ? Infinity : 0),
      totalReturnPct: initialEquity > 0 ? core.net / initialEquity * 100 : 0,

      streaks: str,

      /* répartitions */
      bySymbol: groupBy(trades, (t) => t.instId).sort((a, b) => b.net - a.net),
      bySide: groupBy(trades, (t) => t.side, (k) => (k === 'long' ? 'Achat (long)' : 'Vente (short)')),
      byType: groupBy(trades, (t) => t.instType),
      byHour: groupBy(trades, (t) => new Date(t.openTime || t.closeTime).getHours(), (k) => `${String(k).padStart(2, '0')} h`)
        .sort((a, b) => a.key - b.key),
      byWeekday: groupBy(trades, (t) => new Date(t.openTime || t.closeTime).getDay(), (k) => WEEKDAYS[k])
        .sort((a, b) => ((a.key + 6) % 7) - ((b.key + 6) % 7)),
      byMonth: groupBy(trades, (t) => monthKey(t.closeTime)).sort((a, b) => a.key.localeCompare(b.key)),
      byDuration: groupBy(trades, (t) => durBucket(t.durationMs))
        .sort((a, b) => DUR_BUCKETS.findIndex((x) => x.label === a.key) - DUR_BUCKETS.findIndex((x) => x.label === b.key)),
      byLeverage: groupBy(trades, (t) => levBucket(t.lever))
        .sort((a, b) => LEV_BUCKETS.findIndex((x) => x.label === a.key) - LEV_BUCKETS.findIndex((x) => x.label === b.key)),
      bySize: (() => {
        const sortedN = [...trades].sort((a, b) => a.notional - b.notional);
        const q = Math.ceil(sortedN.length / 4) || 1;
        const names = ['Q1 — plus petites', 'Q2', 'Q3', 'Q4 — plus grosses'];
        return [0, 1, 2, 3].map((i) => {
          const list = sortedN.slice(i * q, (i + 1) * q);
          return list.length ? { key: names[i], label: names[i], ...block(list), trades: list } : null;
        }).filter(Boolean);
      })(),

      behaviour: behaviour(trades, daily, core),
      fmtDur,
    };
  }

  /* ─────────────── MAE / MFE (excursions) ───────────────
     Nécessite les bougies couvrant la vie du trade.
     MAE : pire excursion contre la position (« la chaleur prise »)
     MFE : meilleure excursion en sa faveur
     efficiency : part du mouvement favorable réellement capturée */
  function excursions(trade, candles) {
    const inWindow = candles.filter((c) => c.t >= trade.openTime - 1 && c.t <= trade.closeTime + 1);
    if (inWindow.length < 2) return null;
    const hi = Math.max(...inWindow.map((c) => c.h));
    const lo = Math.min(...inWindow.map((c) => c.l));
    const long = trade.side === 'long';
    const mfePx = long ? hi - trade.openPx : trade.openPx - lo;
    const maePx = long ? trade.openPx - lo : hi - trade.openPx;
    const move = long ? trade.closePx - trade.openPx : trade.openPx - trade.closePx;
    return {
      mfe: Math.max(0, mfePx) * trade.qty,
      mae: Math.max(0, maePx) * trade.qty,
      mfePct: trade.openPx ? Math.max(0, mfePx) / trade.openPx * 100 : 0,
      maePct: trade.openPx ? Math.max(0, maePx) / trade.openPx * 100 : 0,
      efficiency: mfePx > 0 ? Math.max(-1, Math.min(1, move / mfePx)) * 100 : 0,
      bars: inWindow.length,
    };
  }

  return { compute, block, groupBy, equityCurve, dailySeries, streaks, excursions, fmtDur, mean, stdev, quantile, sum };
})();
