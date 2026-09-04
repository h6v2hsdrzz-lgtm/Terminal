/**
 * Vérifie la palette de profils livrée dans `globals.css`.
 *
 * Les couleurs de profil sont le seul endroit de l'application où la couleur
 * porte de l'information : c'est elle qui dit de qui est une courbe. Elle doit
 * donc tenir quatre contrôles mesurables, et sur TOUTES les paires — deux
 * personnes quelconques peuvent se retrouver côte à côte dans une légende,
 * pas seulement deux voisines dans la liste.
 *
 *   1. bande de clarté   — L OKLCH dans la bande du thème
 *   2. plancher de chroma — en dessous, une teinte se lit comme un gris
 *   3. écart daltonien   — ΔE OKLab ×100 sous protanopie et deutéranopie
 *   4. écart vision normale — les mêmes paires, sans simulation
 *   5. contraste sur le fond — WCAG
 *
 * Les seuils viennent de la littérature data-viz (simulation Machado, Oliveira
 * & Fernandes 2009 à sévérité 1,0). Le contrôle 5 est un avertissement et non
 * un échec : sous 3:1, une couleur reste lisible si elle est doublée d'un
 * libellé — ce que fait l'application partout (légendes nommées, avatars aux
 * initiales).
 *
 *   node scripts/valider-palette.mjs
 */
import { readFileSync } from "node:fs";

const BANDE = { clair: [0.43, 0.77], sombre: [0.48, 0.67] };
const PLANCHER_CHROMA = 0.1;
const CIBLE_DALTONISME = 8.0;
const PLANCHER_DALTONISME = 6.0;
const PLANCHER_NORMAL = 15.0;
const CONTRASTE_MIN = 3.0;

const MACHADO = {
  protanopie: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopie: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
};

const versLineaire = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (hex) => [0, 2, 4].map((i) => versLineaire(parseInt(hex.slice(1).slice(i, i + 2), 16) / 255));
const luminance = (hex) => { const [r, g, b] = lin(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };

function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
const oklch = (hex) => { const [L, a, b] = oklab(lin(hex)); return [L, Math.hypot(a, b)]; };
const simuler = (v, genre) => (genre === "normale" ? v : MACHADO[genre].map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]));
function ecart(h1, h2, genre = "normale") {
  const a = oklab(simuler(lin(h1), genre));
  const b = oklab(simuler(lin(h2), genre));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

function controler(palette, { theme, fond }) {
  const [bas, haut] = BANDE[theme];
  const lignes = [];
  let ok = true;

  const horsBande = palette.filter((c) => { const [L] = oklch(c); return L < bas || L > haut; });
  if (horsBande.length) ok = false;
  lignes.push([!horsBande.length, "bande de clarté",
    horsBande.length ? `hors bande : ${horsBande.join(", ")}` : `les ${palette.length} dans L ${bas}–${haut}`]);

  const ternes = palette.filter((c) => oklch(c)[1] < PLANCHER_CHROMA);
  if (ternes.length) ok = false;
  lignes.push([!ternes.length, "plancher de chroma",
    ternes.length ? `se lisent comme du gris : ${ternes.join(", ")}` : `les ${palette.length} ≥ ${PLANCHER_CHROMA}`]);

  const paires = [];
  for (let i = 0; i < palette.length; i += 1) for (let j = i + 1; j < palette.length; j += 1) paires.push([i, j]);

  let pireDaltonien = null;
  for (const genre of ["protanopie", "deuteranopie"]) {
    for (const [i, j] of paires) {
      const d = ecart(palette[i], palette[j], genre);
      if (!pireDaltonien || d < pireDaltonien.d) pireDaltonien = { d, genre, a: palette[i], b: palette[j] };
    }
  }
  const dalOk = pireDaltonien.d >= PLANCHER_DALTONISME;
  if (!dalOk) ok = false;
  lignes.push([dalOk, "écart daltonien",
    `pire paire ${pireDaltonien.a}↔${pireDaltonien.b} ΔE ${pireDaltonien.d.toFixed(1)} (${pireDaltonien.genre})`
      + (pireDaltonien.d < CIBLE_DALTONISME ? " — sous la cible de 8, légendes nommées obligatoires" : "")]);

  let pireNormal = null;
  for (const [i, j] of paires) {
    const d = ecart(palette[i], palette[j]);
    if (!pireNormal || d < pireNormal.d) pireNormal = { d, a: palette[i], b: palette[j] };
  }
  const normOk = pireNormal.d >= PLANCHER_NORMAL;
  if (!normOk) ok = false;
  lignes.push([normOk, "écart vision normale",
    `pire paire ${pireNormal.a}↔${pireNormal.b} ΔE ${pireNormal.d.toFixed(1)}`]);

  const faibles = palette.filter((c) => contraste(c, fond) < CONTRASTE_MIN);
  lignes.push([true, "contraste sur le fond",
    faibles.length
      ? `sous ${CONTRASTE_MIN}:1, à doubler d'un libellé : ${faibles.map((c) => `${c} (${contraste(c, fond).toFixed(2)})`).join(", ")}`
      : `les ${palette.length} ≥ ${CONTRASTE_MIN}:1`]);

  return { lignes, ok };
}

// -- lecture des jetons livrés ------------------------------------------------
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const blocs = [...css.matchAll(/--profil-1:\s*(#[0-9a-f]{6});([\s\S]*?)--profil-7:\s*(#[0-9a-f]{6});/gi)]
  .map((m) => [m[1], ...[...m[2].matchAll(/--profil-[2-6]:\s*(#[0-9a-f]{6});/gi)].map((x) => x[1]), m[3]]);

if (blocs.length < 2) { console.error("Palette introuvable dans globals.css."); process.exit(1); }

// Le premier bloc est le thème clair ; les suivants (media query et `.sombre`)
// portent le même jeu sombre, il suffit d'en contrôler un.
const jeux = [
  { nom: "thème clair", palette: blocs[0], theme: "clair", fond: "#ffffff" },
  { nom: "thème sombre", palette: blocs[1], theme: "sombre", fond: "#101216" },
];

let tout = true;
for (const jeu of jeux) {
  console.log(`\n${jeu.nom} — ${jeu.palette.length} emplacements sur ${jeu.fond}`);
  const { lignes, ok } = controler(jeu.palette, jeu);
  for (const [bon, nom, detail] of lignes) console.log(`  ${bon ? "ok  " : "NON "} ${nom.padEnd(22)} ${detail}`);
  if (!ok) tout = false;
}
console.log(tout ? "\nPalette valide.\n" : "\nPalette refusée.\n");
process.exit(tout ? 0 : 1);
