"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Carte, TitreSection } from "./Carte";
import { libelleMois } from "@/lib/souvenirs";
import { enTexteLong } from "@/lib/dates";
import type { Retrospective as Donnees } from "@/lib/souvenirs";
import type { Profil } from "@/lib/types";

/**
 * Le résumé d'un mois, et l'image qu'on en partage.
 *
 * L'image est dessinée sur une toile au moment du clic plutôt que rendue en
 * amont : elle n'existe que si quelqu'un la demande, et elle reprend
 * exactement les couleurs du thème en cours — celles qui sont à l'écran, pas
 * une copie qui finirait par diverger.
 */
const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export function Retrospective({
  donnees,
  profils,
  nomBande,
  mois,
  choisi,
}: {
  donnees: Donnees;
  profils: Profil[];
  nomBande: string;
  mois: string[];
  choisi: string;
}) {
  const [enCours, setEnCours] = useState(false);
  const ancre = useRef<HTMLDivElement>(null);

  async function partager() {
    setEnCours(true);
    try {
      const blob = await dessiner(donnees, profils, nomBande, ancre.current!);
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = `${nomBande.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${choisi}.png`;
      lien.click();
      // Libérer tout de suite fait échouer le téléchargement dans certains
      // navigateurs : on laisse le temps au clic d'aboutir.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setEnCours(false);
    }
  }

  const nul = donnees.journeesPosees === 0;

  return (
    <section>
      <TitreSection
        action={
          mois.length > 1 && (
            <span className="flex gap-1.5 overflow-x-auto">
              {mois.slice(0, 6).map((m) => (
                <Link
                  key={m}
                  href={`/souvenirs?mois=${m}`}
                  scroll={false}
                  className={`shrink-0 rounded-[var(--radius-pilule)] border px-2 py-0.5 text-[12px] transition ${
                    m === choisi
                      ? "border-encre bg-encre text-[var(--surface)]"
                      : "border-trait bg-surface-2 text-encre-2 hover:border-trait-fort"
                  }`}
                >
                  {libelleMois(m).split(" ")[0].slice(0, 4)}
                </Link>
              ))}
            </span>
          )
        }
      >
        Rétrospective
      </TitreSection>

      <Carte className="overflow-hidden">
        <div ref={ancre} className="p-5">
          <p className="text-[13px] uppercase tracking-[0.12em] text-encre-3">{nomBande}</p>
          <h2 className="mt-0.5 text-[26px] font-semibold tracking-[-0.02em] first-letter:uppercase">
            {donnees.periode}
          </h2>

          {nul ? (
            <p className="mt-3 text-[15px] leading-snug text-encre-2">
              Rien de posé ce mois-ci. Ça arrive, et ça ne se rattrape pas — la
              suite compte davantage.
            </p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Chiffre valeur={String(donnees.jours)} libelle={donnees.jours > 1 ? "jours vécus" : "jour vécu"} />
                <Chiffre
                  valeur={donnees.moyenne === null ? "—" : donnees.moyenne.toFixed(1).replace(".", ",")}
                  libelle="de moyenne"
                />
                <Chiffre valeur={String(donnees.joursComplets)} libelle="au complet" />
              </div>

              <ul className="mt-4 space-y-2 border-t border-trait pt-4">
                {donnees.meilleurJour && (
                  <Ligne
                    quoi="Le plus haut"
                    valeur={`${enTexteLong(donnees.meilleurJour.jour)} · ${donnees.meilleurJour.moyenne.toFixed(1).replace(".", ",")}`}
                  />
                )}
                {donnees.plusDure && (
                  // On nomme le jour le plus dur aussi. Un résumé qui ne garde
                  // que les sommets raconte une autre bande que la vraie.
                  <Ligne
                    quoi="Le plus dur"
                    valeur={`${enTexteLong(donnees.plusDure.jour)} · ${donnees.plusDure.moyenne.toFixed(1).replace(".", ",")}`}
                  />
                )}
                {donnees.meilleurJourSemaine !== null && (
                  <Ligne quoi="Votre meilleur jour" valeur={NOMS_JOURS[donnees.meilleurJourSemaine]} />
                )}
                <Ligne
                  quoi="Ce que vous avez laissé"
                  valeur={[
                    `${donnees.notesEcrites} note${donnees.notesEcrites > 1 ? "s" : ""}`,
                    donnees.photos > 0 && `${donnees.photos} photo${donnees.photos > 1 ? "s" : ""}`,
                    `${donnees.reactions} réaction${donnees.reactions > 1 ? "s" : ""}`,
                    donnees.commentaires > 0 && `${donnees.commentaires} commentaire${donnees.commentaires > 1 ? "s" : ""}`,
                  ].filter(Boolean).join(" · ")}
                />
              </ul>

              <ul className="mt-4 space-y-2 border-t border-trait pt-4">
                {donnees.parProfil.map((ligne) => {
                  const profil = profils.find((p) => p.id === ligne.profil);
                  if (!profil) return null;
                  return (
                    <li key={ligne.profil} className="flex items-center gap-2.5 text-[14px]">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: `var(--profil-${profil.teinte})` }}
                      />
                      <span className="min-w-0 flex-1 truncate">{profil.pseudo}</span>
                      <span className="chiffres text-encre-2">
                        {ligne.posees} jour{ligne.posees > 1 ? "s" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {!nul && (
          <div className="border-t border-trait p-4">
            <button
              type="button"
              onClick={partager}
              disabled={enCours}
              className="w-full rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-2.5 text-[14px] font-medium transition hover:border-encre-3 disabled:opacity-50"
            >
              {enCours ? "Un instant…" : "Enregistrer l'image"}
            </button>
            <p className="mt-2 text-center text-[12px] text-encre-3">
              Une image carrée, à envoyer à qui vous voulez.
            </p>
          </div>
        )}
      </Carte>
    </section>
  );
}

function Chiffre({ valeur, libelle }: { valeur: string; libelle: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-3 text-center">
      <p className="chiffres text-[24px] leading-none">{valeur}</p>
      <p className="mt-1.5 text-[11px] leading-tight text-encre-3">{libelle}</p>
    </div>
  );
}

function Ligne({ quoi, valeur }: { quoi: string; valeur: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-[14px]">
      <span className="shrink-0 text-encre-3">{quoi}</span>
      <span className="text-right first-letter:uppercase">{valeur}</span>
    </li>
  );
}

// ── L'image ──────────────────────────────────────────────────────────────────

const COTE = 1080;

/** Les couleurs viennent du thème affiché, pas d'une copie qui divergerait. */
function jeton(ancre: HTMLElement, nom: string): string {
  return getComputedStyle(ancre).getPropertyValue(nom).trim() || "#000";
}

async function dessiner(
  donnees: Donnees,
  profils: Profil[],
  nomBande: string,
  ancre: HTMLElement,
): Promise<Blob> {
  const toile = document.createElement("canvas");
  toile.width = COTE;
  toile.height = COTE;
  const c = toile.getContext("2d")!;

  const encre = jeton(ancre, "--encre");
  const encre2 = jeton(ancre, "--encre-2");
  const encre3 = jeton(ancre, "--encre-3");
  const joie = jeton(ancre, "--joie-encre");

  c.fillStyle = jeton(ancre, "--sol");
  c.fillRect(0, 0, COTE, COTE);

  const police = (taille: number, graisse = "400") =>
    `${graisse} ${taille}px Inter, ui-sans-serif, system-ui, sans-serif`;

  c.fillStyle = encre3;
  c.font = police(26, "500");
  c.letterSpacing = "3px";
  c.fillText(nomBande.toUpperCase(), 88, 150);
  c.letterSpacing = "0px";

  c.fillStyle = encre;
  c.font = police(72, "600");
  const periode = donnees.periode.charAt(0).toUpperCase() + donnees.periode.slice(1);
  c.fillText(periode, 88, 236);

  // Trois chiffres, sur une ligne.
  const tuiles: [string, string][] = [
    [String(donnees.jours), donnees.jours > 1 ? "jours vécus" : "jour vécu"],
    [donnees.moyenne === null ? "—" : donnees.moyenne.toFixed(1).replace(".", ","), "de moyenne"],
    [String(donnees.joursComplets), "au complet"],
  ];
  tuiles.forEach(([valeur, libelle], i) => {
    const x = 88 + i * 305;
    c.fillStyle = jeton(ancre, "--surface-2");
    arrondi(c, x, 300, 280, 170, 28);
    c.fill();
    c.fillStyle = joie;
    c.font = police(76, "600");
    c.textAlign = "center";
    c.fillText(valeur, x + 140, 392);
    c.fillStyle = encre3;
    c.font = police(24);
    c.fillText(libelle, x + 140, 436);
    c.textAlign = "left";
  });

  let y = 550;
  const ligne = (quoi: string, valeur: string) => {
    c.fillStyle = encre3;
    c.font = police(26);
    c.fillText(quoi, 88, y);
    c.fillStyle = encre;
    c.font = police(30, "500");
    c.textAlign = "right";
    c.fillText(valeur, COTE - 88, y);
    c.textAlign = "left";
    y += 58;
  };

  if (donnees.meilleurJour) {
    ligne("Le plus haut", `${enTexteLong(donnees.meilleurJour.jour)} · ${donnees.meilleurJour.moyenne.toFixed(1).replace(".", ",")}`);
  }
  if (donnees.plusDure) {
    ligne("Le plus dur", `${enTexteLong(donnees.plusDure.jour)} · ${donnees.plusDure.moyenne.toFixed(1).replace(".", ",")}`);
  }
  if (donnees.meilleurJourSemaine !== null) {
    ligne("Votre meilleur jour", NOMS_JOURS[donnees.meilleurJourSemaine]);
  }

  // Une barre par personne : longueur proportionnelle aux journées posées.
  // Le nom vit à gauche de la barre, pas dedans : sur un bleu saturé il
  // devenait illisible, et une barre courte l'aurait de toute façon tronqué.
  y += 24;
  const COL_NOM = 240;
  const DEBUT_BARRE = 88 + COL_NOM;
  const LARGEUR_BARRE = COTE - DEBUT_BARRE - 160;
  const maxPosees = Math.max(1, ...donnees.parProfil.map((p) => p.posees));

  for (const membre of donnees.parProfil) {
    const profil = profils.find((p) => p.id === membre.profil);
    if (!profil) continue;
    const couleur = jeton(ancre, `--profil-${profil.teinte}`);

    c.fillStyle = couleur;
    c.beginPath();
    c.arc(102, y - 6, 9, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = encre;
    c.font = police(28, "500");
    c.fillText(profil.pseudo, 126, y + 2);

    c.fillStyle = jeton(ancre, "--surface-3");
    arrondi(c, DEBUT_BARRE, y - 20, LARGEUR_BARRE, 28, 14);
    c.fill();

    c.fillStyle = couleur;
    arrondi(c, DEBUT_BARRE, y - 20, Math.max(28, LARGEUR_BARRE * (membre.posees / maxPosees)), 28, 14);
    c.fill();

    c.fillStyle = encre2;
    c.font = police(26);
    c.textAlign = "right";
    c.fillText(`${membre.posees}`, COTE - 88, y + 2);
    c.textAlign = "left";
    y += 56;
  }

  c.fillStyle = encre3;
  c.font = police(24);
  c.fillText("Journal de joie", 88, COTE - 74);

  return new Promise<Blob>((resoudre, rejeter) =>
    toile.toBlob((b) => (b ? resoudre(b) : rejeter(new Error("image impossible"))), "image/png"),
  );
}

function arrondi(c: CanvasRenderingContext2D, x: number, y: number, l: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, l, h, r);
}
