/* ════════════════════════════════════════════════════════════
   globe.js — projection orthographique des réserves officielles.

   Le COT ne voit que le COMEX. Or depuis 2022 le premier acheteur
   structurel d'or n'est pas sur le COMEX : ce sont les banques
   centrales, qui achètent en gré à gré et déclarent au FMI avec
   plusieurs mois de retard. Ces tonnages n'apparaissent nulle part
   dans le positionnement des futures — d'où cette vue, qui est le
   seul endroit du poste où ce moteur est visible.

   Une carte plate donnerait de la Russie et du Canada une importance
   que la projection invente. La projection orthographique montre la
   Terre telle qu'on la voit depuis l'espace : les surfaces sont
   honnêtes au centre, la moitié du globe est cachée, et on tourne
   pour voir le reste. Tout est calculé ici, sans bibliothèque
   cartographique et sans requête réseau : les contours sont déposés
   une fois pour toutes dans `data/land.json`.
   ════════════════════════════════════════════════════════════ */
'use strict';

const Globe = {
  land: null,
  loading: null,

  async loadLand() {
    if (this.land) return this.land;
    if (!this.loading) {
      this.loading = fetch('data/land.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { this.land = j; return j; })
        .catch(() => null);
    }
    return this.loading;
  },

  /* ── Projection ───────────────────────────────────────────
     λ0 / φ0 : le point du globe placé au centre de l'écran.
     `cosc` est le cosinus de la distance angulaire au centre :
     négatif, le point est de l'autre côté de la Terre. */
  project(lon, lat, view) {
    const d = Math.PI / 180;
    const l = (lon - view.lon) * d, p = lat * d, p0 = view.lat * d;
    const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
    if (cosc < 0) return null;
    return {
      x: view.cx + view.r * Math.cos(p) * Math.sin(l),
      y: view.cy - view.r * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l)),
      z: cosc,
    };
  },

  /* Point subsolaire — longitude et latitude du soleil au zénith.
     Sert à ombrer la face nuit : sur un marché ouvert 24 h, savoir
     quelles places sont en journée n'est pas décoratif. */
  subsolar(now = new Date()) {
    const d = Math.PI / 180;
    const start = Date.UTC(now.getUTCFullYear(), 0, 0);
    const day = (now - start) / 86400000;
    /* déclinaison solaire, approximation courante à ±0,5° */
    const dec = -23.44 * Math.cos(d * (360 / 365) * (day + 10));
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
    return { lon: 180 - utcHours * 15, lat: dec };
  },

  /* ── Rendu ────────────────────────────────────────────────
     Un seul canvas, redessiné à chaque rotation. À cette taille
     (quelques milliers de segments) le tracé tient largement dans
     une image par rafraîchissement. */
  draw(canvas, holders, view) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return [];
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    /* Le zoom agrandit le rayon de la sphère : au-delà de 1 elle déborde
       du cadre, et c'est exactement ce qu'on veut — l'Europe concentre
       une vingtaine de détenteurs sur quelques degrés, impossible à
       distinguer à l'échelle du globe entier. */
    const zoom = Math.max(1, Math.min(6, view.zoom || 1));
    const base = Math.min(w, h) / 2 - 12;
    const v = { ...view, zoom, cx: w / 2, cy: h / 2, r: base * zoom };

    /* océan */
    const grad = g.createRadialGradient(v.cx - v.r * 0.3, v.cy - v.r * 0.35, v.r * 0.1, v.cx, v.cy, v.r);
    grad.addColorStop(0, '#141c26');
    grad.addColorStop(1, '#0a0e14');
    g.beginPath();
    g.arc(v.cx, v.cy, v.r, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = '#252d38';
    g.lineWidth = 1;
    g.stroke();

    /* graticule tous les 20° */
    g.strokeStyle = 'rgba(120,135,155,.13)';
    g.lineWidth = 0.6;
    for (let lon = -180; lon < 180; lon += 20) this.stroke(g, v, this.meridian(lon));
    for (let lat = -80; lat <= 80; lat += 20) this.stroke(g, v, this.parallel(lat));

    /* continents */
    if (this.land) {
      g.strokeStyle = 'rgba(150,170,195,.5)';
      g.fillStyle = 'rgba(70,88,110,.28)';
      g.lineWidth = 0.8;
      for (const ring of this.land.rings) this.stroke(g, v, ring, true);
    }

    /* Éclairage solaire.

       On pourrait tracer le terminateur — le cercle des points à 90° du
       soleil — et remplir la face nuit, mais ce polygone se referme du
       mauvais côté selon que le point antisolaire est devant ou derrière
       le globe, et le remplissage part alors en travers de l'océan. Une
       lueur radiale centrée sur le point subsolaire donne la même
       information — où il fait jour à cet instant — et reste juste dans
       toutes les orientations. */
    const sun = this.subsolar();
    const sp = this.project(sun.lon, sun.lat, v);
    g.save();
    g.beginPath();
    g.arc(v.cx, v.cy, v.r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(4,7,12,.34)';
    g.fillRect(v.cx - v.r, v.cy - v.r, v.r * 2, v.r * 2);
    if (sp) {
      const day = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, v.r * 1.15);
      day.addColorStop(0, `rgba(150,175,205,${0.14 * sp.z})`);
      day.addColorStop(0.55, `rgba(120,145,180,${0.05 * sp.z})`);
      day.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = day;
      g.fillRect(v.cx - v.r, v.cy - v.r, v.r * 2, v.r * 2);
    }
    g.restore();

    /* réserves : l'aire du disque est proportionnelle au tonnage —
       un rayon proportionnel écraserait tout sauf les États-Unis.

       Le tracé est découpé sur la sphère : sans cela, un pays qui
       approche du limbe fait déborder son disque hors du globe, et
       les 8 133 tonnes des États-Unis flottent dans le vide dès que
       Washington passe de l'autre côté. */
    const max = holders.reduce((m, x) => Math.max(m, x.tonnes), 1);
    const hit = [];
    const labels = [];
    g.save();
    g.beginPath();
    g.arc(v.cx, v.cy, v.r, 0, Math.PI * 2);
    g.clip();
    /* Le rayon des disques ne suit pas le zoom : à 4× l'or des
       États-Unis couvrirait tout l'écran. Il grandit en racine, ce qui
       écarte visuellement les voisins sans les faire enfler. */
    const rScale = base * 0.155 * Math.sqrt(zoom);
    for (const hd of [...holders].sort((a, b) => a.tonnes - b.tonnes)) {
      const p = this.project(hd.lon, hd.lat, v);
      if (!p || p.z < 0.06) continue;
      const rad = 3 + Math.sqrt(hd.tonnes / max) * rScale;
      const sel = hd.iso === view.selected;
      const hov = hd.iso === view.hovered;
      const fade = 0.25 + 0.75 * Math.min(1, p.z * 1.6);
      g.beginPath();
      g.arc(p.x, p.y, rad, 0, Math.PI * 2);
      g.fillStyle = hd.institution
        ? `rgba(142,122,184,${(sel || hov ? 0.5 : 0.2) * fade})`
        : `rgba(217,164,65,${(sel || hov ? 0.55 : 0.22) * fade})`;
      g.fill();
      g.strokeStyle = sel ? '#ffffff'
        : hd.institution ? `rgba(163,145,203,${(hov ? 1 : 0.85) * fade})`
          : `rgba(230,183,92,${(hov ? 1 : 0.9) * fade})`;
      g.lineWidth = sel ? 2 : hov ? 1.8 : 1.1;
      g.stroke();
      if (sel) {
        /* halo de repérage : sur une grappe européenne, la bordure
           blanche seule ne suffit pas à retrouver le pays choisi */
        g.beginPath();
        g.arc(p.x, p.y, rad + 6, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,255,255,.35)';
        g.lineWidth = 1;
        g.stroke();
      }
      hit.push({ ...hd, x: p.x, y: p.y, rad, pick: Math.max(rad, 10) });
      if ((hd.rank <= 8 || sel || hov || zoom >= 2.2) && p.z > 0.3) labels.push({ hd, p, rad, fade, sel, hov });
    }

    /* Un détenteur entièrement recouvert par un plus gros n'est pas
       étiquetable : le FMI siège à Washington, son disque disparaît sous
       celui des États-Unis, et deux noms empilés sur le même point ne
       désignent plus rien. */
    const shown = labels.filter(({ hd, p, rad }) => !labels.some((o) =>
      o.hd !== hd && o.rad > rad && Math.hypot(o.p.x - p.x, o.p.y - p.y) < o.rad * 0.8));

    /* Les libellés, du plus gros au plus petit, en sautant ceux qui
       tomberaient sur un voisin. L'Europe concentre l'Allemagne, la
       France et l'Italie sur trois degrés : tout écrire y produit une
       bouillie, et le tableau en dessous dit de toute façon le
       classement exact. */
    /* hors du découpage : un libellé collé au limbe serait tronqué par
       le bord de la sphère alors qu'il doit rester lisible */
    g.restore();
    g.font = '600 10px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    const placed = [];
    /* le pays sélectionné puis le survolé passent devant : leur libellé
       ne doit jamais être celui qu'on sacrifie à l'anti-chevauchement */
    const order = shown.sort((a, b) =>
      (b.sel - a.sel) || (b.hov - a.hov) || (b.hd.tonnes - a.hd.tonnes));
    for (const { hd, p, rad, fade, sel, hov } of order) {
      /* Un disque sorti du cadre par le zoom n'a pas de libellé : sinon
         son nom se colle au bord de l'écran, désignant un pays qu'on ne
         voit pas. */
      if (p.x < -rad || p.x > w + rad || p.y < -rad || p.y > h + rad) continue;
      const text = hd.institution ? hd.iso : hd.name;
      const wl = g.measureText(text).width;
      const x = Math.max(wl / 2 + 5, Math.min(w - wl / 2 - 5, p.x));
      const y = Math.max(14, p.y - rad - 5);
      if (!sel && !hov
        && placed.some((q) => Math.abs(q.x - x) < (q.w + wl) / 2 + 6 && Math.abs(q.y - y) < 17)) continue;
      placed.push({ x, y, w: wl });
      g.fillStyle = sel ? 'rgba(217,164,65,.92)' : 'rgba(8,10,14,.78)';
      g.fillRect(x - wl / 2 - 3, y - 9, wl + 6, 12);
      g.fillStyle = sel ? '#0b0e13' : `rgba(214,221,229,${fade})`;
      g.fillText(text, x, y);
    }
    return hit;
  },

  /* ── Désignation ──────────────────────────────────────────
     Choisir « le premier disque touché » revient à désigner celui que
     l'ordre de tracé a mis dessus, c'est-à-dire le plus petit. Sur la
     grappe européenne, viser l'Italie donnait le Portugal.

     On prend donc le disque dont le centre est le plus proche du clic,
     et à distance égale le plus petit — un petit pays posé sur un gros
     reste atteignable, alors que l'inverse serait impossible. */
  pick(hits, x, y) {
    let best = null, bestScore = Infinity;
    for (const h of hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d > h.pick) continue;
      const score = d + h.rad * 0.12;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    return best;
  },

  /* trace une suite de [lon,lat] en coupant aux passages derrière
     le globe — sans cette coupure, un continent qui disparaît au
     limbe se referme par un trait qui traverse l'océan */
  stroke(g, v, pts, fill = false, fillOnly = false) {
    let open = false;
    g.beginPath();
    for (const [lon, lat] of pts) {
      const p = this.project(lon, lat, v);
      if (!p) { open = false; continue; }
      if (!open) { g.moveTo(p.x, p.y); open = true; } else g.lineTo(p.x, p.y);
    }
    if (fill) { g.closePath(); g.fill(); }
    if (!fillOnly) g.stroke();
  },

  meridian(lon) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 4) pts.push([lon, lat]);
    return pts;
  },

  parallel(lat) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 4) pts.push([lon, lat]);
    return pts;
  },
};

/* ── Places de marché ─────────────────────────────────────────
   L'or se traite 24 heures sur 24 par relais entre fuseaux. Les
   horaires sont donnés en heure locale de chaque place et convertis
   en UTC ici ; `open` dit qui tient le marché en ce moment. */
const TRADING_HUBS = [
  { name: 'Sydney', lon: 151.2, lat: -33.9, openUtc: 22, closeUtc: 6, note: 'Ouverture de la semaine, volumes minces.' },
  { name: 'Tokyo', lon: 139.7, lat: 35.7, openUtc: 0, closeUtc: 6, note: 'TOCOM ; l\'or y cote en yens.' },
  { name: 'Shanghai', lon: 121.5, lat: 31.2, openUtc: 1, closeUtc: 7, note: 'SGE — livraison physique obligatoire, prime chinoise.' },
  { name: 'Bombay', lon: 72.9, lat: 19.1, openUtc: 3.5, closeUtc: 17, note: 'Demande physique de bijouterie, saisonnière.' },
  { name: 'Dubaï', lon: 55.3, lat: 25.3, openUtc: 4, closeUtc: 13, note: 'Plaque tournante du physique entre Asie et Europe.' },
  { name: 'Zurich', lon: 8.5, lat: 47.4, openUtc: 7, closeUtc: 16, note: 'Raffinage : l\'essentiel des lingots mondiaux y transitent.' },
  { name: 'Londres', lon: -0.1, lat: 51.5, openUtc: 8, closeUtc: 17, note: 'LBMA — le gré à gré de référence, et les deux fixings.' },
  { name: 'New York', lon: -74.0, lat: 40.7, openUtc: 13, closeUtc: 22, note: 'COMEX — les contrats à terme du rapport COT.' },
];

function hubStatus(now = new Date()) {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  return TRADING_HUBS.map((x) => {
    const open = x.openUtc <= x.closeUtc
      ? h >= x.openUtc && h < x.closeUtc
      : h >= x.openUtc || h < x.closeUtc;   /* place à cheval sur minuit UTC */
    return { ...x, open };
  });
}
