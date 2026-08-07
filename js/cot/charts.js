/* ════════════════════════════════════════════════════════════
   charts.js — graphiques temporels du poste.

   Enveloppe fine autour de TradingView Lightweight Charts™ (v5,
   déjà vendorisé dans le dépôt). Le COT est hebdomadaire : pas de
   bougies, pas de volume — des courbes, une ligne de zéro, et la
   possibilité de superposer le prix sur une seconde échelle, parce
   que la question intéressante est toujours « le positionnement
   suit-il le prix, ou s'en est-il détaché ? ».
   ════════════════════════════════════════════════════════════ */
'use strict';

const CHART_THEME = {
  bg: 'transparent',
  text: '#79828e',
  grid: '#171c23',
  border: '#1f252e',
  crosshair: '#4b535e',
  price: '#cfd6de',
  zero: '#2a323d',
};

const Charts = {
  instances: [],

  /* détruit tous les graphiques d'un conteneur — appelé à chaque
     changement de vue pour éviter que des observers restent actifs
     sur des nœuds détachés */
  clear() {
    for (const inst of this.instances) {
      try { inst.ro.disconnect(); } catch {}
      try { inst.chart.remove(); } catch {}
    }
    this.instances = [];
  },

  /* ── Graphique multi-séries ───────────────────────────────
     series : [{ label, color, data:[{ts,value}], width, dashed,
                 scale:'left'|'right', type:'line'|'area'|'hist' }]
     Les séries `scale:'right'` (typiquement le prix) vivent sur une
     échelle indépendante : superposer des contrats et des dollars
     sur le même axe n'aurait aucun sens. */
  timeSeries(container, series, opts = {}) {
    if (!container || !series.length) return null;
    const LWC = window.LightweightCharts;
    if (!LWC) return null;

    container.innerHTML = '';
    const chart = LWC.createChart(container, {
      layout: {
        background: { color: CHART_THEME.bg },
        textColor: CHART_THEME.text,
        fontSize: 10,
        fontFamily: 'inherit',
        attributionLogo: false,
      },
      /* Locale figée : l'axe des dates doit être en français quel que
         soit le navigateur, et surtout la bibliothèque appelle
         `toLocaleString` avec la locale du système — une locale
         exotique (POSIX, C) lève alors une RangeError qui laisse le
         graphique vide. Fixer la valeur supprime les deux problèmes. */
      localization: {
        locale: 'fr-FR',
        dateFormat: 'dd/MM/yyyy',
      },
      grid: {
        vertLines: { color: CHART_THEME.grid },
        horzLines: { color: CHART_THEME.grid },
      },
      rightPriceScale: {
        visible: series.some((s) => s.scale === 'right'),
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      leftPriceScale: {
        visible: true,
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: false,
        secondsVisible: false,
        rightOffset: 4,
        fixLeftEdge: true,
      },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: CHART_THEME.crosshair, width: 1, style: 3, labelBackgroundColor: '#1f252e' },
        horzLine: { color: CHART_THEME.crosshair, width: 1, style: 3, labelBackgroundColor: '#1f252e' },
      },
      handleScale: { axisPressedMouseMove: { price: false } },
      autoSize: false,
      height: opts.height || 320,
      width: container.clientWidth || 600,
    });

    const handles = [];
    for (const s of series) {
      const scaleId = s.scale === 'right' ? 'right' : 'left';
      const common = {
        priceScaleId: scaleId,
        priceLineVisible: false,
        lastValueVisible: s.lastValue !== false,
        title: s.label || '',
        priceFormat: {
          type: 'price',
          precision: s.precision != null ? s.precision : 0,
          minMove: s.minMove != null ? s.minMove : 1,
        },
      };

      let h;
      if (s.type === 'hist') {
        h = chart.addSeries(LWC.HistogramSeries, { ...common, color: s.color }, 0);
      } else if (s.type === 'area') {
        h = chart.addSeries(LWC.AreaSeries, {
          ...common,
          lineColor: s.color,
          topColor: s.color + '44',
          bottomColor: s.color + '05',
          lineWidth: s.width || 2,
        }, 0);
      } else {
        h = chart.addSeries(LWC.LineSeries, {
          ...common,
          color: s.color,
          lineWidth: s.width || 2,
          lineStyle: s.dashed ? 2 : 0,
        }, 0);
      }

      h.setData(s.data.map((p) => ({ time: p.ts, value: p.value })));
      handles.push({ handle: h, spec: s });
    }

    /* ligne de zéro : sur un net, le passage du positif au négatif
       est l'événement le plus lisible du graphique */
    if (opts.zeroLine && handles.length) {
      handles[0].handle.createPriceLine({
        price: 0, color: CHART_THEME.zero, lineWidth: 1, lineStyle: 0,
        axisLabelVisible: false, title: '',
      });
    }

    chart.timeScale().fitContent();

    /* le conteneur est en flex/grid : sa largeur change au
       redimensionnement de la fenêtre et au changement de vue */
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w > 0) chart.applyOptions({ width: w, height: opts.height || 320 });
    });
    ro.observe(container);

    const inst = { chart, handles, ro };
    this.instances.push(inst);

    if (opts.onCrosshair) {
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData) { opts.onCrosshair(null); return; }
        const values = handles.map(({ handle, spec }) => {
          const d = param.seriesData.get(handle);
          return { label: spec.label, color: spec.color, value: d ? d.value : null };
        });
        opts.onCrosshair({ time: param.time, values });
      });
    }

    return inst;
  },

  /* ── Chandeliers + volume ─────────────────────────────────
     Pour le temps court, où l'on veut voir l'ouverture, les extrêmes
     et la clôture — pas seulement une ligne de clôture. Le volume
     occupe un panneau distinct plutôt que d'être écrasé au bas du
     graphique de prix. */
  candles(container, data, opts = {}) {
    if (!container || !data || !data.length) return null;
    const LWC = window.LightweightCharts;
    if (!LWC) return null;

    container.innerHTML = '';
    const chart = LWC.createChart(container, {
      layout: {
        background: { color: CHART_THEME.bg }, textColor: CHART_THEME.text,
        fontSize: 10, fontFamily: 'inherit', attributionLogo: false,
        panes: { separatorColor: CHART_THEME.border, separatorHoverColor: CHART_THEME.border },
      },
      localization: { locale: 'fr-FR' },
      grid: {
        vertLines: { color: CHART_THEME.grid },
        horzLines: { color: CHART_THEME.grid },
      },
      rightPriceScale: { borderColor: CHART_THEME.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: opts.intraday !== false,
        secondsVisible: false,
        rightOffset: 3,
      },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: CHART_THEME.crosshair, width: 1, style: 3, labelBackgroundColor: '#1f252e' },
        horzLine: { color: CHART_THEME.crosshair, width: 1, style: 3, labelBackgroundColor: '#1f252e' },
      },
      height: opts.height || 380,
      width: container.clientWidth || 600,
    });

    const digits = opts.precision != null ? opts.precision : 2;
    const price = chart.addSeries(LWC.CandlestickSeries, {
      upColor: '#2ebd85', downColor: '#f6465d',
      borderUpColor: '#2ebd85', borderDownColor: '#f6465d',
      wickUpColor: '#2ebd85', wickDownColor: '#f6465d',
      priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) },
    }, 0);
    price.setData(data.map((c) => ({
      time: c.ts, open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    let volume = null;
    if (opts.volume !== false) {
      volume = chart.addSeries(LWC.HistogramSeries, {
        priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
      }, 1);
      volume.setData(data.map((c) => ({
        time: c.ts, value: c.volume,
        color: c.close >= c.open ? 'rgba(46,189,133,.45)' : 'rgba(246,70,93,.45)',
      })));
      try { chart.panes()[1].setHeight(Math.round((opts.height || 380) * 0.22)); } catch {}
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w > 0) chart.applyOptions({ width: w, height: opts.height || 380 });
    });
    ro.observe(container);

    const inst = { chart, handles: [{ handle: price, spec: { label: 'prix' } }], ro };
    this.instances.push(inst);

    if (opts.onCrosshair) {
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData) { opts.onCrosshair(null); return; }
        opts.onCrosshair({ time: param.time, bar: param.seriesData.get(price) });
      });
    }
    return inst;
  },

  /* ── Sparkline SVG ────────────────────────────────────────
     Pour les tableaux macro : une centaine de points, aucune
     interaction, aucun axe. Un graphique complet serait vingt fois
     plus lourd pour un signal qu'on lit en un coup d'œil. */
  sparkline(values, { width = 96, height = 22, color = '#d9a441' } = {}) {
    if (!values || values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = width / (values.length - 1);
    const pts = values.map((v, i) =>
      `${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 2) - 1).toFixed(1)}`);
    const up = values[values.length - 1] >= values[0];
    return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
      preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts.join(' ')}" fill="none"
        stroke="${up ? color : color}" stroke-width="1.25" stroke-linejoin="round"/>
    </svg>`;
  },
};
