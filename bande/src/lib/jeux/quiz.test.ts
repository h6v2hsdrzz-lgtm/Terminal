import { describe, expect, it } from "vitest";

import { questionsDuQuiz } from "./quiz";
import { generateur } from "./tirage";
import type { Entree, Profil } from "../types";

const PROFILS: Profil[] = [
  { id: "a", pseudo: "Momo", teinte: 1, initiales: "MO", avatar: null },
  { id: "b", pseudo: "Sam", teinte: 2, initiales: "SA", avatar: null },
  { id: "c", pseudo: "Samy", teinte: 3, initiales: "SY", avatar: null },
];

function entree(surcharge: Partial<Entree> = {}): Entree {
  return {
    id: Math.random().toString(36),
    jour: "2026-06-01",
    profil: "a",
    joie: 7,
    titre: null,
    note: null,
    energie: null,
    calme: null,
    declencheurs: [],
    etiquettes: [],
    photos: [],
    audio: null,
    reactions: [],
    commentaires: [],
    posteA: "21:00",
    ...surcharge,
  };
}

/** Une bande bien remplie : de quoi alimenter toutes les fabriques. */
function bandeRiche(): Entree[] {
  const lieux = ["Chez moi", "Le bureau", "Le Zinc", "Le canal", "Chez Mamie"];
  return Array.from({ length: 60 }, (_, i) =>
    entree({
      jour: `2026-0${(i % 6) + 1}-${String((i % 27) + 1).padStart(2, "0")}`,
      profil: ["a", "b", "c"][i % 3],
      etiquettes: [{ id: `t${i}`, nom: lieux[i % (i % 3 === 0 ? 1 : lieux.length)] }],
      note: i % 2 === 0 ? `Une anecdote assez longue pour compter, numéro ${i}, avec du texte.` : null,
      audio: i % 3 === 0 ? { url: `/api/audio/${i}`, duree: 4000, niveaux: [1, 2] } : null,
      commentaires:
        i % 4 === 0
          ? [{ id: `c${i}`, auteurId: "b", auteur: "Sam", texte: "ha", quand: "21:00" }]
          : [],
    }),
  );
}

describe("questionsDuQuiz", () => {
  it("fabrique des questions à partir des données de la bande", () => {
    const questions = questionsDuQuiz(bandeRiche(), PROFILS, generateur(1), 8);
    expect(questions.length).toBeGreaterThanOrEqual(4);
  });

  it("met toujours la bonne réponse parmi les options", () => {
    const questions = questionsDuQuiz(bandeRiche(), PROFILS, generateur(7), 10);
    for (const question of questions) {
      expect(question.options).toContain(question.bonne);
      expect(question.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("ne pose jamais deux fois la même question", () => {
    const questions = questionsDuQuiz(bandeRiche(), PROFILS, generateur(3), 10);
    expect(new Set(questions.map((q) => q.intitule)).size).toBe(questions.length);
  });

  it("ne demande jamais qui va bien", () => {
    // La règle du plan : aucun classement du bonheur, jamais. Une question de
    // quiz sur la note de quelqu'un en serait un, énoncé à voix haute.
    const questions = questionsDuQuiz(bandeRiche(), PROFILS, generateur(11), 10);
    for (const question of questions) {
      expect(question.intitule).not.toMatch(/heureux|bonheur|meilleure note|moyenne|joie/i);
    }
  });

  it("ne rend rien plutôt que d'inventer quand la bande est trop jeune", () => {
    // Trois journées sans lieu, sans texte, sans vocal : il n'y a rien à
    // demander, et une question fabriquée sur du vide se ferait démasquer.
    const questions = questionsDuQuiz(
      [entree({ jour: "2026-06-01" }), entree({ jour: "2026-06-02" })],
      PROFILS,
      generateur(5),
      10,
    );
    expect(questions).toEqual([]);
  });

  it("se rejoue à l'identique à graine égale", () => {
    const entrees = bandeRiche();
    const a = questionsDuQuiz(entrees, PROFILS, generateur(42), 6);
    const b = questionsDuQuiz(entrees, PROFILS, generateur(42), 6);
    expect(a).toEqual(b);
  });
});
