import { describe, expect, it } from "vitest";

import { type Export, versCsv } from "./csv";

function journee(surcharge: Partial<Export["journees"][number]> = {}): Export["journees"][number] {
  return {
    jour: "2026-09-04",
    qui: "Momo",
    joie: 7,
    note: null,
    declencheurs: [],
    photos: 0,
    vocal: false,
    titre: null,
    etiquettes: [],
    energie: null,
    calme: null,
    reactions: [],
    commentaires: [],
    posteLe: new Date("2026-09-04T20:00:00Z"),
    ...surcharge,
  };
}

function fichier(journees: Export["journees"]): Export {
  return {
    bande: "La bande",
    exporteLe: "2026-09-05T10:00:00.000Z",
    membres: [],
    declencheurs: [],
    journees,
  };
}

/** Un découpage simple : suffisant pour compter les colonnes des lignes citées. */
function colonnes(ligne: string): number {
  let compte = 1;
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i += 1) {
    if (ligne[i] === '"') dansGuillemets = !dansGuillemets;
    else if (ligne[i] === "," && !dansGuillemets) compte += 1;
  }
  return compte;
}

describe("versCsv", () => {
  it("donne à chaque ligne le nombre de colonnes de l'en-tête", () => {
    // C'est LE défaut de ce fichier : ajouter une colonne aux lignes sans la
    // mettre dans l'en-tête donne un tableur qui s'ouvre sans erreur et range
    // les commentaires sous « photos ».
    const csv = versCsv(fichier([journee(), journee({ titre: "Belle soirée" })]));
    const lignes = csv.replace(/^\ufeff/, "").trimEnd().split("\r\n");
    const attendu = colonnes(lignes[0]);
    for (const ligne of lignes) expect(colonnes(ligne)).toBe(attendu);
  });

  it("annonce dans l'en-tête tout ce qu'il exporte", () => {
    const entete = versCsv(fichier([])).replace(/^\ufeff/, "").split("\r\n")[0];
    for (const colonne of ["titre", "lieux", "vocal", "energie", "calme"]) {
      expect(entete).toContain(colonne);
    }
  });

  it("protège les virgules, les guillemets et les retours à la ligne", () => {
    const csv = versCsv(fichier([journee({ note: 'il a dit "oui", enfin' })]));
    expect(csv).toContain('"il a dit ""oui"", enfin"');
    const brut = versCsv(fichier([journee({ note: "deux\nlignes" })]));
    expect(brut).toContain('"deux\nlignes"');
  });

  it("laisse vide un curseur auquel personne n'a touché", () => {
    // Et surtout pas zéro : zéro serait une réponse, alors qu'il n'y en a pas
    // eu. On lit les colonnes par leur nom plutôt que par leur position, pour
    // que le test survive à l'ajout d'une colonne au milieu.
    const [entete, ligne] = versCsv(fichier([journee({ photos: 2 })]))
      .replace(/^\ufeff/, "")
      .trimEnd()
      .split("\r\n");
    const noms = entete.split(",");
    const valeurs = ligne.split(",");
    expect(valeurs[noms.indexOf("energie")]).toBe("");
    expect(valeurs[noms.indexOf("calme")]).toBe("");
    // Un compteur, lui, a le droit de valoir zéro : c'est bien une réponse.
    expect(valeurs[noms.indexOf("photos")]).toBe("2");
  });

  it("écrit un BOM pour qu'Excel lise l'UTF-8", () => {
    expect(versCsv(fichier([]))).toMatch(/^\ufeff/);
  });

  it("termine chaque ligne en CRLF", () => {
    expect(versCsv(fichier([journee()]))).toMatch(/\r\n$/);
  });
});
