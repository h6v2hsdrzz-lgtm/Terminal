import { contour, figure, regularite } from "@/lib/figure";
import { couleurJoie, couleurProfil } from "@/lib/couleurs";
import type { Profil } from "@/lib/types";

/**
 * La figure du jour — l'objet signature de l'application.
 *
 * Un sommet par personne, tiré vers l'extérieur par sa note. Le contour clair
 * en fond est la journée parfaite : on voit d'un coup combien il en reste.
 *
 * Trois précautions valent d'être dites :
 *
 * · **rien ne fuit sous le voile.** Quand `masquee` est vrai, la figure n'est
 *   pas dessinée à partir des notes : elle montre seulement qui est passé.
 *   Dessiner puis flouter reviendrait à envoyer les notes dans le HTML ;
 * · **aucune note n'est punie.** Une journée à 1 garde un tiers du rayon —
 *   c'est une présence, pas un point ;
 * · **la couleur vient de la moyenne**, sur la rampe chaude habituelle. Jamais
 *   de rouge, jamais d'alerte.
 */
export function FigureDuJour({
  profils,
  notes,
  taille = 200,
  libelles = true,
  masquee = false,
  presents = [],
}: {
  profils: Profil[];
  /** La note de chacun, ou null s'il n'a pas posé. Indexé par identifiant. */
  notes: Map<string, number | null>;
  taille?: number;
  libelles?: boolean;
  masquee?: boolean;
  /**
   * Qui a posé sa journée, sous le voile. Seulement des identifiants — savoir
   * que quelqu'un est passé ne dit rien de sa journée, et c'est précisément la
   * seule chose que le voile autorise à montrer.
   */
  presents?: string[];
}) {
  const marge = libelles ? 26 : 4;
  const rayon = taille / 2 - marge;
  const personnes = profils.map((p) => ({
    profil: p.id,
    joie: masquee ? null : (notes.get(p.id) ?? null),
    cachee: masquee && presents.includes(p.id),
  }));

  const sommets = figure(personnes, rayon);
  const parfait = figure(profils.map((p) => ({ profil: p.id, joie: 10 })), rayon);
  const presentes = personnes.filter((p) => p.joie !== null).map((p) => p.joie!);
  const combienCachees = personnes.filter((p) => p.cachee).length;
  const moyenne = presentes.length
    ? presentes.reduce((s, v) => s + v, 0) / presentes.length
    : null;
  const accord = regularite(sommets);

  const centre = taille / 2;
  const teinte = moyenne === null ? "var(--surface-3)" : couleurJoie(moyenne);

  /**
   * Les traits et les points suivent la taille.
   *
   * Un rayon de point fixe convient à une figure de deux cents pixels et
   * dévore celle de quarante-quatre du mur des formes : les points y pesaient
   * un quart du rayon, et on ne voyait plus la forme, seulement des billes.
   */
  const trait = Math.max(0.75, taille * 0.0075);
  const point = Math.max(1.6, taille * 0.028);

  return (
    <svg
      width={taille}
      height={taille}
      viewBox={`0 0 ${taille} ${taille}`}
      role="img"
      aria-label={
        masquee
          ? `La figure du jour, ${combienCachees} personne${combienCachees > 1 ? "s" : ""} sur ${profils.length} — elle se dévoile quand tu as posé la tienne.`
          : moyenne === null
            ? "Personne n'a encore posé sa journée."
            : `La figure du jour, ${presentes.length} personne${presentes.length > 1 ? "s" : ""} sur ${profils.length}.`
      }
    >
      <g transform={`translate(${centre} ${centre})`}>
        {/* La journée parfaite, en repère. Sans elle, on ne sait pas si la
            figure est grande ou petite — il n'y a rien à quoi la comparer. */}
        <path
          d={contour(parfait)}
          fill="none"
          stroke="var(--trait)"
          strokeWidth={trait}
          strokeDasharray={`${trait * 3} ${trait * 4}`}
        />

        <path
          d={contour(sommets)}
          fill={teinte}
          fillOpacity={masquee ? 0.25 : 0.55}
          stroke={masquee ? "var(--trait-fort)" : "var(--joie-encre)"}
          strokeWidth={trait * 1.5}
          strokeLinejoin="round"
        />

        {sommets.map((sommet, index) => {
          const profil = profils[index];
          // Caché n'est pas absent : l'un est passé et ne montre rien, l'autre
          // n'est pas passé. Les confondre viderait la figure de tout son sens
          // pendant la moitié de la soirée.
          const absent = sommet.joie === null && !sommet.cachee;
          return (
            <g key={sommet.profil}>
              {/* Le rayon, discret : il rattache le sommet au centre et
                  matérialise « jusqu'où » va chacun. */}
              <line
                x1="0" y1="0" x2={sommet.x} y2={sommet.y}
                stroke={couleurProfil(profil)}
                strokeWidth={trait}
                strokeOpacity={absent ? 0.22 : 0.4}
              />
              <circle
                cx={sommet.x} cy={sommet.y}
                r={absent ? point * 0.6 : point}
                // Caché : le contour de la personne, mais le disque vide. On
                // sait qui est là, on ne sait pas encore où.
                fill={absent || sommet.cachee ? "var(--surface)" : couleurProfil(profil)}
                stroke={couleurProfil(profil)}
                strokeWidth={absent ? trait * 1.5 : sommet.cachee ? trait * 2 : 0}
                strokeDasharray={absent ? `${trait * 2} ${trait * 2}` : undefined}
              />
              {libelles && (
                <text
                  x={parfait[index].x * 1.24}
                  y={parfait[index].y * 1.24 + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill={absent ? "var(--encre-3)" : couleurProfil(profil)}
                >
                  {profil.initiales}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Une figure très régulière mérite d'être signalée : c'est le seul
          moment où la bande est vraiment au même endroit. */}
      {!masquee && accord !== null && accord > 0.86 && presentes.length === profils.length && (
        <title>La bande est au diapason.</title>
      )}
    </svg>
  );
}
