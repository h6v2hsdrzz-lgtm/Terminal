/**
 * Le script de l'application est un seul <script> dans index.html. Les tests
 * l'extraient et l'évaluent hors navigateur : il n'y a rien à construire, et
 * c'est bien le code livré qui est testé, pas une copie.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const chemin = fileURLToPath(new URL("../index.html", import.meta.url));

export function chargerMoteur() {
  const html = readFileSync(chemin, "utf8");
  const debut = html.indexOf('<script id="code">');
  const fin = html.lastIndexOf("</script>");
  if (debut < 0 || fin < 0) throw new Error("Script introuvable dans index.html");
  const source = html.slice(html.indexOf(">", debut) + 1, fin);

  // pas de document ni de localStorage : le script ne démarre pas l'interface
  // et se contente de publier son moteur.
  const contexte = vm.createContext({ console, Intl, Date, Math, JSON });
  vm.runInContext(source, contexte, { filename: "index.html" });
  if (!contexte.Prevoyant) throw new Error("Le moteur n'a pas été exposé");
  return contexte.Prevoyant;
}

/** Un flux minimal, complété par les valeurs passées. */
export function flux(P, patch) {
  const etat = P.poserEtat({
    comptes: [{ id: "c1", nom: "Courant", solde: 0 }],
    flux: [Object.assign({
      id: "f1", libelle: "Test", type: "depense", montant: 100,
      frequence: "mensuel", debut: "2026-01-10", compteId: "c1",
    }, patch)],
  });
  return etat.flux[0];
}
