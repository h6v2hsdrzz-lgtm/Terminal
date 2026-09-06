import type { Entree, Profil } from "../types";

/**
 * « Le quiz de la bande » : des questions tirées de leur propre journal.
 *
 * C'est le jeu qu'aucun autre groupe au monde ne peut avoir, et c'est aussi le
 * plus facile à rater. Trois règles ont été tenues :
 *
 * **Aucune question sur qui va bien.** On ne demande jamais « qui a eu la
 * meilleure année », « qui est le plus heureux », « qui a la moyenne la plus
 * haute ». Le plan l'interdit et il a raison : une question posée devient un
 * classement énoncé, et une mauvaise passe deviendrait une réponse de quiz.
 * On demande **ce qui s'est passé** — un lieu, un jour, un compte — jamais
 * comment quelqu'un allait.
 *
 * **Une question sans réponse sûre n'est pas posée.** Chaque génération vérifie
 * qu'elle dispose de vraies données ; à défaut, elle rend `null` et on passe à
 * une autre. Un quiz qui invente une bonne réponse se fait démasquer à la
 * première manche.
 *
 * **Les mauvaises réponses sont plausibles.** Elles sont tirées des données
 * réelles — d'autres lieux de la bande, d'autres notes du même jour — jamais
 * inventées. Trois options absurdes et une vraie, ce n'est plus une question.
 */
export type Question = {
  intitule: string;
  options: string[];
  bonne: string;
  /** D'où elle vient, pour pouvoir la relire en cas de contestation. */
  source: string;
};

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function enFrancais(jour: string): string {
  const [annee, mois, jourDuMois] = jour.split("-");
  return `${Number(jourDuMois)} ${MOIS[Number(mois) - 1]} ${annee}`;
}

function melanger<T>(elements: T[], hasard: () => number): T[] {
  const copie = [...elements];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(hasard() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/** Le lieu qui revient le plus chez quelqu'un. */
function lieuFavoriDe(entrees: Entree[], membreId: string): string | null {
  const comptes = new Map<string, number>();
  for (const entree of entrees) {
    if (entree.profil !== membreId) continue;
    for (const etiquette of entree.etiquettes) {
      comptes.set(etiquette.nom, (comptes.get(etiquette.nom) ?? 0) + 1);
    }
  }
  const classe = [...comptes.entries()].sort((a, b) => b[1] - a[1]);
  return classe[0]?.[0] ?? null;
}

type Fabrique = (
  entrees: Entree[],
  profils: Profil[],
  hasard: () => number,
) => Question | null;

/** « Quel lieu revient le plus chez X ? » */
const lieuDeQuelquun: Fabrique = (entrees, profils, hasard) => {
  const candidats = melanger(profils, hasard);
  for (const profil of candidats) {
    const favori = lieuFavoriDe(entrees, profil.id);
    if (!favori) continue;
    const autres = [
      ...new Set(entrees.flatMap((e) => e.etiquettes.map((t) => t.nom))),
    ].filter((nom) => nom !== favori);
    if (autres.length < 2) continue;
    return {
      intitule: `Quel lieu revient le plus souvent chez ${profil.pseudo} ?`,
      options: melanger([favori, ...melanger(autres, hasard).slice(0, 3)], hasard),
      bonne: favori,
      source: "les lieux du journal",
    };
  }
  return null;
};

/** « Qui a posté le plus de notes vocales ? » */
const roiDuVocal: Fabrique = (entrees, profils, hasard) => {
  const comptes = new Map<string, number>();
  for (const entree of entrees) {
    if (entree.audio) comptes.set(entree.profil, (comptes.get(entree.profil) ?? 0) + 1);
  }
  if (comptes.size < 2) return null;
  const classe = [...comptes.entries()].sort((a, b) => b[1] - a[1]);
  // Une égalité en tête n'a pas de bonne réponse : on ne pose pas la question.
  if (classe[0][1] === classe[1][1]) return null;
  const gagnant = profils.find((p) => p.id === classe[0][0]);
  if (!gagnant) return null;
  return {
    intitule: "Qui a posté le plus de notes vocales ?",
    options: melanger(profils.map((p) => p.pseudo), hasard),
    bonne: gagnant.pseudo,
    source: `${classe[0][1]} vocaux`,
  };
};

/** « Quel jour est-ce que X a écrit ça ? » — le mois, pas la date exacte. */
const quandCetteAnecdote: Fabrique = (entrees, profils, hasard) => {
  const avecTexte = entrees.filter((e) => (e.note ?? "").trim().length > 40);
  if (avecTexte.length < 4) return null;
  const choisie = melanger(avecTexte, hasard)[0];
  const auteur = profils.find((p) => p.id === choisie.profil);
  if (!auteur) return null;

  const autresJours = melanger(
    [...new Set(avecTexte.map((e) => e.jour))].filter((j) => j !== choisie.jour),
    hasard,
  ).slice(0, 3);
  if (autresJours.length < 2) return null;

  return {
    intitule: `Quand ${auteur.pseudo} a-t-il écrit ça ? « ${(choisie.note ?? "").slice(0, 90)}… »`,
    options: melanger([choisie.jour, ...autresJours].map(enFrancais), hasard),
    bonne: enFrancais(choisie.jour),
    source: choisie.jour,
  };
};

/** « Combien de journées X a-t-il posté ? » */
const combienDeJournees: Fabrique = (entrees, profils, hasard) => {
  const profil = melanger(profils, hasard)[0];
  if (!profil) return null;
  const combien = entrees.filter((e) => e.profil === profil.id).length;
  if (combien < 5) return null;
  // Les leurres encadrent la vraie valeur : « 3 », « 200 » et « 47 » se
  // devinent sans rien savoir.
  const ecart = Math.max(2, Math.round(combien * 0.15));
  const leurres = [combien - ecart, combien + ecart, combien + 2 * ecart].filter((n) => n > 0);
  return {
    intitule: `Combien de journées ${profil.pseudo} a-t-il posté en tout ?`,
    options: melanger([combien, ...leurres].map(String), hasard),
    bonne: String(combien),
    source: `${combien} journées`,
  };
};

/** « Qui a écrit le plus de commentaires ? » */
const roiDuCommentaire: Fabrique = (entrees, profils, hasard) => {
  const comptes = new Map<string, number>();
  for (const entree of entrees) {
    for (const commentaire of entree.commentaires) {
      comptes.set(commentaire.auteurId, (comptes.get(commentaire.auteurId) ?? 0) + 1);
    }
  }
  if (comptes.size < 2) return null;
  const classe = [...comptes.entries()].sort((a, b) => b[1] - a[1]);
  if (classe[0][1] === classe[1][1]) return null;
  const gagnant = profils.find((p) => p.id === classe[0][0]);
  if (!gagnant) return null;
  return {
    intitule: "Qui commente le plus les journées des autres ?",
    options: melanger(profils.map((p) => p.pseudo), hasard),
    bonne: gagnant.pseudo,
    source: `${classe[0][1]} commentaires`,
  };
};

const FABRIQUES: Fabrique[] = [
  lieuDeQuelquun,
  roiDuVocal,
  quandCetteAnecdote,
  combienDeJournees,
  roiDuCommentaire,
];

/**
 * Fabrique autant de questions que possible, sans doublon d'intitulé.
 *
 * On demande un nombre, on peut en obtenir moins : une bande d'une semaine n'a
 * pas de quoi remplir un quiz, et il vaut mieux trois vraies questions que dix
 * dont sept sont inventées.
 */
export function questionsDuQuiz(
  entrees: Entree[],
  profils: Profil[],
  hasard: () => number,
  combien = 10,
): Question[] {
  const questions: Question[] = [];
  const vues = new Set<string>();
  // Plusieurs passes : chaque fabrique tire au hasard, donc elle peut produire
  // une question différente à chaque appel.
  for (let passe = 0; passe < combien * 3 && questions.length < combien; passe++) {
    const fabrique = FABRIQUES[passe % FABRIQUES.length];
    const question = fabrique(entrees, profils, hasard);
    if (!question || vues.has(question.intitule)) continue;
    // Une question dont toutes les options sont identiques n'en est pas une.
    if (new Set(question.options).size < 2) continue;
    if (!question.options.includes(question.bonne)) continue;
    vues.add(question.intitule);
    questions.push(question);
  }
  return questions;
}
