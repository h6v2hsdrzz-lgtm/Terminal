"use client";

import {
  ArrowDown,
  ArrowUp,
  Baby,
  Download,
  Leaf,
  Pencil,
  Search,
  Table2,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ErreurApi } from "@/lib/api";
import { COULEURS_PERSONNES, PERSONNES, type Personne } from "@/lib/constantes";
import { isoVersFr } from "@/lib/date";
import { exporterCsv, exporterJson } from "@/lib/export";
import type { Entree } from "@/lib/types";

import { DialogueEdition } from "./DialogueEdition";
import { useJournal } from "./FournisseurJournal";
import { Carte } from "./ui/Carte";
import { Etiquette } from "./ui/Etiquette";

const PAS_AFFICHAGE = 25;

type Colonne = "date" | "personne" | "joie";
type Sens = "asc" | "desc";
type FiltreDeclencheur = "tous" | "avec" | "sans";

const ETAT_DECLENCHEUR: { valeur: FiltreDeclencheur; libelle: string }[] = [
  { valeur: "tous", libelle: "Tous" },
  { valeur: "avec", libelle: "Avec" },
  { valeur: "sans", libelle: "Sans" },
];

function Selecteur({
  etiquette,
  valeur,
  onChange,
}: {
  etiquette: string;
  valeur: FiltreDeclencheur;
  onChange: (v: FiltreDeclencheur) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-attenue">
      {etiquette}
      <select
        value={valeur}
        onChange={(e) => onChange(e.target.value as FiltreDeclencheur)}
        className="rounded-lg border border-bordure bg-surface px-2 py-1.5 text-xs text-texte"
      >
        {ETAT_DECLENCHEUR.map((etat) => (
          <option key={etat.valeur} value={etat.valeur}>
            {etat.libelle}
          </option>
        ))}
      </select>
    </label>
  );
}

/** En-tête de colonne triable. L'état du tri est porté par le <th>, seul
 *  élément à qui `aria-sort` s'applique. */
function EnTeteTri({
  cible,
  colonne,
  sens,
  onTri,
  children,
}: {
  cible: Colonne;
  colonne: Colonne;
  sens: Sens;
  onTri: (cible: Colonne) => void;
  children: React.ReactNode;
}) {
  const actif = colonne === cible;
  const Fleche = sens === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={actif ? (sens === "asc" ? "ascending" : "descending") : "none"}
      className="py-2 pr-3"
    >
      <button
        type="button"
        onClick={() => onTri(cible)}
        className="inline-flex items-center gap-1 font-medium uppercase tracking-wide transition hover:text-texte"
      >
        {children}
        {actif && <Fleche size={12} />}
      </button>
    </th>
  );
}

/**
 * Journal complet : filtré, trié, modifiable, exportable. L'export reprend
 * tout ce que les filtres laissent passer, dans l'ordre de tri affiché — la
 * pagination ne le tronque pas.
 */
export function Historique() {
  const { entrees, supprimer, signaler } = useJournal();

  const [profils, setProfils] = useState<Personne[]>([]);
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [biberon, setBiberon] = useState<FiltreDeclencheur>("tous");
  const [plante, setPlante] = useState<FiltreDeclencheur>("tous");
  const [recherche, setRecherche] = useState("");

  const [colonne, setColonne] = useState<Colonne>("date");
  const [sens, setSens] = useState<Sens>("desc");

  const [enEdition, setEnEdition] = useState<Entree | null>(null);
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);
  // Un journal de plusieurs mois ne se lit pas d'un seul écran : on en montre
  // une page, l'export porte lui sur tout ce que les filtres laissent passer.
  const [limite, setLimite] = useState(PAS_AFFICHAGE);

  const lignes = useMemo(() => {
    const terme = recherche.trim().toLowerCase();

    const filtrees = entrees.filter((entree) => {
      if (profils.length > 0 && !profils.includes(entree.personne)) return false;
      if (du && entree.date < du) return false;
      if (au && entree.date > au) return false;
      if (biberon !== "tous" && entree.biberon !== (biberon === "avec")) return false;
      if (plante !== "tous" && entree.planteVerte !== (plante === "avec")) return false;
      if (terme && !(entree.notes ?? "").toLowerCase().includes(terme)) return false;
      return true;
    });

    const signe = sens === "asc" ? 1 : -1;
    return filtrees.sort((a, b) => {
      if (colonne === "joie") return signe * (a.joie - b.joie || a.date.localeCompare(b.date));
      if (colonne === "personne") {
        return signe * (a.personne.localeCompare(b.personne) || a.date.localeCompare(b.date));
      }
      return signe * (a.date.localeCompare(b.date) || a.personne.localeCompare(b.personne));
    });
  }, [entrees, profils, du, au, biberon, plante, recherche, colonne, sens]);

  const visibles = lignes.slice(0, limite);
  const restantes = lignes.length - visibles.length;

  const filtreActif =
    profils.length > 0 || du || au || biberon !== "tous" || plante !== "tous" || recherche;

  function basculerTri(cible: Colonne) {
    if (cible === colonne) setSens(sens === "asc" ? "desc" : "asc");
    else {
      setColonne(cible);
      setSens(cible === "date" ? "desc" : "asc");
    }
  }

  function basculerProfil(personne: Personne) {
    setProfils((actuels) =>
      actuels.includes(personne)
        ? actuels.filter((p) => p !== personne)
        : [...actuels, personne],
    );
  }

  function reinitialiser() {
    setProfils([]);
    setDu("");
    setAu("");
    setBiberon("tous");
    setPlante("tous");
    setRecherche("");
  }

  async function confirmerSuppression(entree: Entree) {
    setAConfirmer(null);
    try {
      await supprimer(entree);
      signaler(`Entrée du ${isoVersFr(entree.date)} supprimée.`);
    } catch (erreur) {
      signaler(
        erreur instanceof ErreurApi ? erreur.message : "Suppression impossible.",
        "erreur",
      );
    }
  }

  return (
    <>
      <Carte
        titre="Journal"
        sousTitre={`${lignes.length} entrée${lignes.length > 1 ? "s" : ""}${
          filtreActif ? " après filtrage" : ""
        }`}
        icone={<Table2 size={16} />}
        actions={
          <>
            <button
              type="button"
              onClick={() => exporterCsv(lignes)}
              disabled={lignes.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-bordure px-2.5 py-1.5 text-xs font-medium text-attenue transition hover:bg-surface-2 hover:text-texte disabled:opacity-50"
            >
              <Download size={13} /> CSV
            </button>
            <button
              type="button"
              onClick={() => exporterJson(lignes)}
              disabled={lignes.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-bordure px-2.5 py-1.5 text-xs font-medium text-attenue transition hover:bg-surface-2 hover:text-texte disabled:opacity-50"
            >
              <Download size={13} /> JSON
            </button>
          </>
        }
      >
        {/* ── Filtres ──────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-bordure pb-4">
          <div className="flex items-center gap-1.5">
            {PERSONNES.map((personne) => {
              const actif = profils.includes(personne);
              return (
                <button
                  key={personne}
                  type="button"
                  aria-pressed={actif}
                  onClick={() => basculerProfil(personne)}
                  style={actif ? { borderColor: COULEURS_PERSONNES[personne] } : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                    actif
                      ? "bg-surface-2 text-texte"
                      : "border-bordure text-attenue hover:bg-surface-2"
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: COULEURS_PERSONNES[personne] }}
                  />
                  {personne}
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-1.5 text-xs text-attenue">
            Du
            <input
              type="date"
              value={du}
              onChange={(e) => setDu(e.target.value)}
              className="rounded-lg border border-bordure bg-surface px-2 py-1.5 text-xs tabulaire text-texte"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-attenue">
            au
            <input
              type="date"
              value={au}
              onChange={(e) => setAu(e.target.value)}
              className="rounded-lg border border-bordure bg-surface px-2 py-1.5 text-xs tabulaire text-texte"
            />
          </label>

          <Selecteur etiquette="Biberon" valeur={biberon} onChange={setBiberon} />
          <Selecteur etiquette="Plante" valeur={plante} onChange={setPlante} />

          <label className="flex min-w-[10rem] flex-1 items-center gap-1.5 rounded-lg border border-bordure bg-surface px-2 py-1.5 text-xs">
            <Search size={13} className="shrink-0 text-faible" />
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher dans les notes"
              className="w-full bg-transparent outline-none placeholder:text-faible"
            />
          </label>

          {filtreActif && (
            <button
              type="button"
              onClick={reinitialiser}
              className="text-xs font-medium text-ardoise underline-offset-2 hover:underline"
            >
              Réinitialiser
            </button>
          )}
        </div>

        {lignes.length === 0 ? (
          <p className="py-10 text-center text-sm text-attenue">
            {entrees.length === 0
              ? "Le journal est vide — la première saisie apparaîtra ici."
              : "Aucune entrée ne correspond à ces filtres."}
          </p>
        ) : (
          <>
            {/* ── Tableau : à partir du format tablette ──────────────── */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-bordure text-left text-xs uppercase tracking-wide text-attenue">
                    <EnTeteTri cible="date" colonne={colonne} sens={sens} onTri={basculerTri}>
                      Date
                    </EnTeteTri>
                    <EnTeteTri cible="personne" colonne={colonne} sens={sens} onTri={basculerTri}>
                      Personne
                    </EnTeteTri>
                    <EnTeteTri cible="joie" colonne={colonne} sens={sens} onTri={basculerTri}>
                      Joie
                    </EnTeteTri>
                    <th scope="col" className="py-2 pr-3">Déclencheurs</th>
                    <th scope="col" className="py-2 pr-3">Notes</th>
                    <th scope="col" className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((entree) => (
                    <tr key={entree.id} className="border-b border-bordure last:border-0">
                      <td className="py-2.5 pr-3 tabulaire whitespace-nowrap">
                        {isoVersFr(entree.date)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: COULEURS_PERSONNES[entree.personne] }}
                          />
                          {entree.personne}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-5 tabulaire font-medium">{entree.joie}</span>
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${entree.joie * 10}%`,
                                backgroundColor: COULEURS_PERSONNES[entree.personne],
                              }}
                            />
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="flex flex-wrap gap-1">
                          {entree.biberon && (
                            <Etiquette couleur="var(--ardoise)" titre="Facteur biberon">
                              <Baby size={11} /> Biberon
                            </Etiquette>
                          )}
                          {entree.planteVerte && (
                            <Etiquette couleur="var(--vert-texte)" titre="Facteur plante verte">
                              <Leaf size={11} /> Plante
                            </Etiquette>
                          )}
                          {!entree.biberon && !entree.planteVerte && (
                            <span className="text-xs text-faible">—</span>
                          )}
                        </span>
                      </td>
                      <td className="max-w-[16rem] py-2.5 pr-3">
                        <span className="block truncate text-attenue" title={entree.notes ?? ""}>
                          {entree.notes ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {aConfirmer === entree.id ? (
                          <span className="inline-flex items-center gap-2 text-xs">
                            <span className="text-attenue">Supprimer ?</span>
                            <button
                              type="button"
                              onClick={() => confirmerSuppression(entree)}
                              className="font-medium text-rouge hover:underline"
                            >
                              Oui
                            </button>
                            <button
                              type="button"
                              onClick={() => setAConfirmer(null)}
                              className="text-attenue hover:underline"
                            >
                              Non
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-1">
                            <button
                              type="button"
                              onClick={() => setEnEdition(entree)}
                              aria-label={`Modifier l'entrée du ${isoVersFr(entree.date)} pour ${entree.personne}`}
                              className="rounded-md p-1.5 text-attenue transition hover:bg-surface-2 hover:text-texte"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setAConfirmer(entree.id)}
                              aria-label={`Supprimer l'entrée du ${isoVersFr(entree.date)} pour ${entree.personne}`}
                              className="rounded-md p-1.5 text-attenue transition hover:bg-surface-2 hover:text-rouge"
                            >
                              <Trash2 size={14} />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Cartes : sur téléphone, un tableau à six colonnes est illisible ── */}
            <ul className="space-y-2 md:hidden">
              {visibles.map((entree) => (
                <li
                  key={entree.id}
                  className="rounded-xl border border-bordure bg-surface-2 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <span
                          aria-hidden
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: COULEURS_PERSONNES[entree.personne] }}
                        />
                        {entree.personne}
                        <span className="tabulaire text-attenue">
                          · {isoVersFr(entree.date)}
                        </span>
                      </p>
                      <p className="mt-1 flex flex-wrap gap-1">
                        {entree.biberon && (
                          <Etiquette couleur="var(--ardoise)">
                            <Baby size={11} /> Biberon
                          </Etiquette>
                        )}
                        {entree.planteVerte && (
                          <Etiquette couleur="var(--vert-texte)">
                            <Leaf size={11} /> Plante
                          </Etiquette>
                        )}
                      </p>
                    </div>
                    <span
                      className="text-2xl font-semibold tabulaire leading-none"
                      style={{ color: COULEURS_PERSONNES[entree.personne] }}
                    >
                      {entree.joie}
                    </span>
                  </div>

                  {entree.notes && (
                    <p className="mt-2 text-xs text-attenue">{entree.notes}</p>
                  )}

                  <div className="mt-2 flex justify-end gap-1">
                    {aConfirmer === entree.id ? (
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span className="text-attenue">Supprimer ?</span>
                        <button
                          type="button"
                          onClick={() => confirmerSuppression(entree)}
                          className="font-medium text-rouge"
                        >
                          Oui
                        </button>
                        <button type="button" onClick={() => setAConfirmer(null)} className="text-attenue">
                          Non
                        </button>
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setEnEdition(entree)}
                          aria-label={`Modifier l'entrée du ${isoVersFr(entree.date)}`}
                          className="rounded-md p-1.5 text-attenue transition hover:bg-surface-3"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setAConfirmer(entree.id)}
                          aria-label={`Supprimer l'entrée du ${isoVersFr(entree.date)}`}
                          className="rounded-md p-1.5 text-attenue transition hover:bg-surface-3 hover:text-rouge"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {restantes > 0 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-xs text-attenue">
                <span className="tabulaire">
                  {visibles.length} sur {lignes.length}
                </span>
                <button
                  type="button"
                  onClick={() => setLimite((actuelle) => actuelle + PAS_AFFICHAGE)}
                  className="rounded-lg border border-bordure px-3 py-1.5 font-medium transition hover:bg-surface-2 hover:text-texte"
                >
                  Afficher {Math.min(PAS_AFFICHAGE, restantes)} de plus
                </button>
              </div>
            )}
          </>
        )}
      </Carte>

      {enEdition && (
        <DialogueEdition entree={enEdition} onFermer={() => setEnEdition(null)} />
      )}
    </>
  );
}
