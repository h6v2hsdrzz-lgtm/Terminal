/**
 * L'export au format tableur.
 *
 * Il vit à part du dépôt, et pas par goût du rangement : le dépôt importe
 * `server-only` et le client Prisma, donc rien de ce qu'il contient ne peut
 * être appelé depuis un test. Cette fonction, elle, est du texte pur — c'est
 * exactement le genre de code qui casse en silence et qu'il faut pouvoir
 * éprouver.
 */
import type { exporter } from "./depot";

/** Le type est celui du dépôt : un `import type` s'efface à la compilation. */
export type Export = Awaited<ReturnType<typeof exporter>>;

export function versCsv(donnees: Export): string {
  // Un champ contenant une virgule, un guillemet ou un retour à la ligne doit
  // être entouré de guillemets, les guillemets internes étant doublés.
  const cellule = (valeur: unknown) => {
    const texte = valeur === null || valeur === undefined ? "" : String(valeur);
    return /[",\n\r]/.test(texte) ? `"${texte.replaceAll('"', '""')}"` : texte;
  };

  // L'en-tête et les lignes sont écrits l'un sous l'autre, dans le même ordre,
  // pour qu'un décalage se voie à la relecture : une colonne ajoutée d'un côté
  // seulement donne un fichier que le tableur ouvre sans broncher et qui range
  // les commentaires sous « photos ».
  const lignes = [
    [
      "jour", "qui", "joie", "titre", "note", "declencheurs", "lieux",
      "photos", "vocal", "energie", "rire", "reactions", "commentaires",
    ],
    ...donnees.journees.map((j) => [
      j.jour, j.qui, j.joie, j.titre ?? "", j.note ?? "",
      j.declencheurs.join(" | "),
      j.etiquettes.join(" | "),
      j.photos,
      j.vocal ? "oui" : "non",
      j.energie ?? "",
      j.calme ?? "",
      j.reactions.map((r) => `${r.de} ${r.emoji}`).join(" | "),
      j.commentaires.map((c) => `${c.de} : ${c.texte}`).join(" | "),
    ]),
  ];
  // Un BOM, parce qu'Excel lit sinon un fichier UTF-8 comme du latin-1 et
  // affiche « journÃ©e ».
  return "﻿" + lignes.map((l) => l.map(cellule).join(",")).join("\r\n") + "\r\n";
}
