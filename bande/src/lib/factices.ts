/**
 * Données factices — JALON 1 UNIQUEMENT.
 *
 * Elles servent à juger la direction artistique sur des écrans pleins plutôt
 * que sur des écrans vides. Le jalon 2 les remplace par un vrai script de
 * seed en base, et ce fichier disparaît.
 *
 * Le générateur est déterministe : deux rendus donnent la même bande, sinon
 * les captures d'écran ne seraient jamais comparables d'une fois sur l'autre.
 */
import { decaler, jourDeLaBande } from "./dates";
import type { Badge, Declencheur, Entree, Profil } from "./types";

export const BANDE = { nom: "Les Trois Fromages", code: "FROMAGE" };

export const PROFILS: Profil[] = [
  { id: "momo", pseudo: "Momo", teinte: 1, initiales: "MO" },
  { id: "sam", pseudo: "Sam", teinte: 2, initiales: "SA" },
  { id: "samy", pseudo: "Samy", teinte: 3, initiales: "SY" },
];

export const MOI = "momo";

export const DECLENCHEURS: Declencheur[] = [
  { id: "biberon", nom: "Biberon", emoji: "🍼" },
  { id: "plante", nom: "Plante verte", emoji: "🌿" },
  { id: "sport", nom: "Sport", emoji: "🏃" },
];

const NOTES = [
  "Réveil sans réveil, ça change tout.",
  "Journée de pluie, rien fait, zéro regret.",
  "Réunion de 3 h qui aurait tenu en un mail.",
  "On a retrouvé le bar de l'an dernier.",
  "Nuit courte mais bonne nouvelle au boulot.",
  "Rien de spécial, et c'est très bien.",
  "Le chat a dormi sur mon clavier toute la matinée.",
  "Enfin fini le truc que je repoussais depuis trois semaines.",
  "Trop de monde partout, j'ai fui.",
  "Soirée improvisée, la meilleure sorte.",
  null,
  null,
];

function generateur(graine: number) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat * 1664525 + 1013904223) >>> 0;
    return etat / 0x100000000;
  };
}

/** 90 jours plausibles : des trous, des séries, des creux et des remontées. */
function fabriquer(): Entree[] {
  const tirage = generateur(20260904);
  const aujourdhui = jourDeLaBande();
  const entrees: Entree[] = [];

  // Chacun a son niveau habituel et sa propre amplitude.
  const profils = {
    momo: { base: 6.4, amplitude: 2.1, presence: 0.94 },
    sam: { base: 7.2, amplitude: 1.4, presence: 0.88 },
    samy: { base: 5.9, amplitude: 2.6, presence: 0.8 },
  } as const;

  for (let recul = 89; recul >= 0; recul -= 1) {
    const jour = decaler(aujourdhui, -recul);
    const jourSem = new Date(jour).getDay();
    // Un week-end monte un peu, un lundi descend un peu : ça donne à la
    // statistique « jour de la semaine » quelque chose de vrai à trouver.
    const effetJour = jourSem === 0 || jourSem === 6 ? 0.9 : jourSem === 1 ? -0.7 : 0;
    const actifs = DECLENCHEURS.filter(() => tirage() < 0.4).map((d) => d.id);
    const effetDeclencheurs = actifs.includes("biberon") ? 1.3 : 0;

    for (const profil of PROFILS) {
      const reglage = profils[profil.id as keyof typeof profils];
      // Aujourd'hui, c'est moi qui n'ai pas encore posté : l'écran d'accueil
      // doit montrer le cas qu'on voit le plus souvent en ouvrant l'app.
      if (recul === 0 && profil.id === MOI) continue;
      if (recul > 0 && tirage() > reglage.presence) continue;

      const bruit = (tirage() - 0.5) * reglage.amplitude;
      const joie = Math.max(1, Math.min(10, Math.round(
        reglage.base + effetJour + effetDeclencheurs * (profil.id === "momo" ? 1 : 0.5) + bruit,
      )));

      const note = NOTES[Math.floor(tirage() * NOTES.length)];
      const reactions: Entree["reactions"] = [];
      if (tirage() < 0.55) reactions.push({ emoji: "❤️", parQui: ["sam"] });
      if (tirage() < 0.3) reactions.push({ emoji: "😂", parQui: ["samy", "momo"] });
      if (joie >= 9 && tirage() < 0.7) reactions.push({ emoji: "🔥", parQui: ["sam", "samy"] });

      const commentaires: Entree["commentaires"] = [];
      if (tirage() < 0.22) {
        commentaires.push({
          id: `${jour}-${profil.id}-c`,
          auteur: profil.id === "momo" ? "sam" : "momo",
          texte: joie >= 8 ? "ça fait plaisir de lire ça" : "on se fait un truc ce week-end ?",
          quand: "il y a 2 h",
        });
      }

      entrees.push({
        id: `${jour}-${profil.id}`,
        jour,
        profil: profil.id,
        joie,
        note,
        declencheurs: actifs,
        photo: null,
        reactions,
        commentaires,
        posteA: `${19 + Math.floor(tirage() * 4)}:${String(Math.floor(tirage() * 60)).padStart(2, "0")}`,
      });
    }
  }

  return entrees;
}

export const ENTREES: Entree[] = fabriquer();

export const BADGES: Badge[] = [
  { cle: "premier-dix", nom: "Plein pot", description: "Une journée notée 10", emoji: "🌟", obtenuLe: "2026-08-14" },
  { cle: "semaine", nom: "Sept d'affilée", description: "Une semaine sans en rater un", emoji: "📅", obtenuLe: "2026-07-02" },
  { cle: "mois", nom: "Trente jours", description: "Un mois complet", emoji: "🏔️", obtenuLe: "2026-08-01" },
  { cle: "remontada", nom: "Remontada", description: "+5 en une journée", emoji: "📈", obtenuLe: "2026-08-22" },
  { cle: "noctambule", nom: "Noctambule", description: "Un check-in entre minuit et 4 h", emoji: "🦉", obtenuLe: "2026-08-30" },
  { cle: "premiere-photo", nom: "Première photo", description: "Une image dans le fil", emoji: "📷", obtenuLe: null },
  { cle: "fidele", nom: "Sans faute", description: "Un mois entier sans en rater un seul", emoji: "💎", obtenuLe: null },
  { cle: "supporter", nom: "Supporter", description: "Cinquante réactions laissées", emoji: "🙌", obtenuLe: null },
];
