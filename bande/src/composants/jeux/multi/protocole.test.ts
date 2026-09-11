import { describe, expect, it } from "vitest";

import type { EtatPartie, Joueur } from "@/lib/jeux/types";

import { PHASES, acteurDe, attendus, classementDeVitesse, reponsesDe, toutLeMondeARepondu } from "./protocole";

const JOUEURS: Joueur[] = ["momo", "sam", "samy"].map((membreId, i) => ({
  membreId,
  pseudo: membreId[0].toUpperCase() + membreId.slice(1),
  teinte: i + 1,
  initiales: membreId.slice(0, 2).toUpperCase(),
  avatar: null,
  points: 0,
  sobre: false,
  ordre: i,
}));

function etatDe(options: Partial<EtatPartie> = {}): EtatPartie {
  return {
    partie: {
      id: "p1",
      jeu: "jamais",
      mode: "multi",
      commenceeLe: "2026-09-11T20:00:00.000Z",
      finie: false,
      joueurs: JOUEURS,
    },
    etat: "encours",
    hoteId: "momo",
    code: null,
    manche: 1,
    phase: PHASES.question,
    donneesPhase: {},
    echeance: null,
    version: 1,
    presents: ["momo", "sam", "samy"],
    actions: [],
    maintenant: "2026-09-11T20:00:05.000Z",
    ...options,
  };
}

const action = (membreId: string, donnees: Record<string, unknown>, manche = 1, phase: string = PHASES.question) => ({
  membreId,
  manche,
  phase,
  donnees,
  quand: "2026-09-11T20:00:01.000Z",
});

describe("les réponses d'une phase", () => {
  it("ne mélange pas deux manches, ni deux phases", () => {
    const etat = etatDe({
      actions: [
        action("momo", { choix: "a" }),
        action("sam", { choix: "b" }, 2),
        action("samy", { choix: "c" }, 1, PHASES.revelation),
      ],
    });
    expect(reponsesDe(etat, PHASES.question).map((r) => r.membreId)).toEqual(["momo"]);
  });
});

describe("qui est attendu", () => {
  it("n'attend ni l'acteur, ni un absent", () => {
    const etat = etatDe({ presents: ["momo", "sam"] });
    expect(attendus(etat, JOUEURS, "momo")).toEqual(["sam"]);
  });

  it("ne déclare jamais « tout le monde a répondu » quand personne n'est attendu", () => {
    // Sinon un jeu « tour » où l'acteur est seul présent révélerait la manche
    // avant même que l'acteur ait touché son écran.
    const etat = etatDe({ presents: ["momo"] });
    expect(toutLeMondeARepondu(etat, JOUEURS, PHASES.question, "momo")).toBe(false);
  });

  it("attend les présents, et seulement eux", () => {
    const etat = etatDe({ presents: ["momo", "sam"], actions: [action("sam", { choix: "a" })] });
    expect(toutLeMondeARepondu(etat, JOUEURS, PHASES.question, "momo")).toBe(true);
  });
});

describe("l'acteur de la manche", () => {
  it("se lit dans la phase, pas dans un calcul refait chez chacun", () => {
    // Recalculer l'acteur côté client le ferait changer d'un téléphone à
    // l'autre dès que la liste des joueurs diffère d'un élément.
    expect(acteurDe(etatDe({ donneesPhase: { acteur: "sam" } }))).toBe("sam");
    expect(acteurDe(etatDe({ donneesPhase: {} }))).toBeNull();
  });
});

describe("le classement d'une manche de réflexe", () => {
  const r = (membreId: string, quand: string, donnees: Record<string, unknown> = {}) => ({
    membreId,
    donnees,
    quand,
  });

  it("classe sur l'horodatage du serveur", () => {
    const rangs = classementDeVitesse([
      r("sam", "2026-09-11T20:00:00.300Z"),
      r("momo", "2026-09-11T20:00:00.120Z"),
    ]);
    expect(rangs.map((x) => [x.reponse.membreId, x.rang])).toEqual([
      ["momo", 1],
      ["sam", 2],
    ]);
  });

  it("ne donne aucun rang à un départ brûlé, et n'en consomme pas un", () => {
    const rangs = classementDeVitesse([
      r("momo", "2026-09-11T20:00:00.010Z", { faux: true }),
      r("sam", "2026-09-11T20:00:00.400Z"),
    ]);
    expect(rangs.map((x) => x.rang)).toEqual([0, 1]);
  });
});
