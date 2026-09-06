import { constellation, poserEtiquettes } from "@/lib/lieu";

import { Carte } from "./Carte";

/**
 * Les lieux de la bande, en constellation.
 *
 * ## Pourquoi ce n'est pas une vraie carte
 *
 * Le plan demandait Leaflet et des tuiles OpenStreetMap. Deux raisons de ne
 * pas le faire, et la première suffit :
 *
 * **Les tuiles fuiraient.** Chaque tuile est une requête du téléphone vers un
 * serveur tiers, et la suite des tuiles demandées dit où sont vos souvenirs et
 * lesquels vous regardez. Pour une application dont la règle est que rien ne
 * sort de la bande, c'est cher payé pour un fond de carte.
 *
 * **Les positions sont arrondies au kilomètre.** Un fond de carte au niveau de
 * la rue afficherait une précision qu'on n'a pas — et laisserait croire à une
 * précision qu'on a refusé d'avoir.
 *
 * Restent les positions les unes par rapport aux autres, ce qui est justement
 * ce qu'on regarde : le lieu du quotidien au milieu, les échappées loin autour.
 * Aucune dépendance, aucune requête, et ça ressemble à la figure du jour.
 */
type Lieu = { id: string; nom: string; usages: number; latitude: number | null; longitude: number | null };

const TAILLE = 300;
const MARGE = 34;

export function CarteDesLieux({ lieux }: { lieux: Lieu[] }) {
  const situes = lieux.filter(
    (l): l is Lieu & { latitude: number; longitude: number } =>
      l.latitude !== null && l.longitude !== null,
  );
  if (situes.length < 2) return null;

  const plusVisite = Math.max(...situes.map((l) => l.usages));
  const points = constellation(situes, TAILLE, MARGE).map((p) => ({
    ...p,
    // Le rayon suit le nombre de passages, en racine : proportionnel à l'aire
    // plutôt qu'au rayon, sinon un lieu vu dix fois écrase tout.
    r: 4 + 8 * Math.sqrt(p.usages / plusVisite),
  }));
  const etiquettes = poserEtiquettes(points, TAILLE);

  return (
    <Carte className="p-4">
      <svg
        viewBox={`0 0 ${TAILLE} ${TAILLE}`}
        className="mx-auto block w-full max-w-[340px]"
        role="img"
        aria-label={`Les ${situes.length} lieux de la bande, placés les uns par rapport aux autres.`}
      >
        {/* Un quadrillage discret : sans repère, des points flottants ne
            disent pas qu'on regarde des distances. */}
        {[0.25, 0.5, 0.75].map((part) => (
          <g key={part} stroke="var(--trait)" strokeWidth="0.5">
            <line x1={TAILLE * part} y1={MARGE / 2} x2={TAILLE * part} y2={TAILLE - MARGE / 2} />
            <line x1={MARGE / 2} y1={TAILLE * part} x2={TAILLE - MARGE / 2} y2={TAILLE * part} />
          </g>
        ))}

        {points.map((point, i) => {
          const etiquette = etiquettes[i];
          return (
            <g key={point.id}>
              {/* Le trait relie le point à son nom quand celui-ci a dû être
                  poussé plus bas pour ne pas en écraser un autre. */}
              {etiquette.y > point.y && (
                <line
                  x1={point.x}
                  y1={point.y}
                  x2={etiquette.x}
                  y2={etiquette.y - 8}
                  stroke="var(--trait)"
                  strokeWidth="0.75"
                />
              )}
              <circle cx={point.x} cy={point.y} r={point.r} fill="var(--joie-encre)" fillOpacity={0.22} />
              <circle cx={point.x} cy={point.y} r={3} fill="var(--joie-encre)" />
              <text
                x={etiquette.x}
                y={etiquette.y}
                textAnchor={etiquette.ancre}
                fontSize="10"
                fill="var(--encre-2)"
              >
                {point.nom}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="mt-2 text-[12px] leading-snug text-encre-3">
        Vos lieux, placés les uns par rapport aux autres. Ce n&apos;est pas une
        carte : les positions sont arrondies au kilomètre, les écarts sont
        resserrés pour que les noms tiennent, et aucun fond de plan n&apos;est
        téléchargé — un fond de carte dirait à son serveur où sont vos souvenirs.
      </p>
    </Carte>
  );
}
