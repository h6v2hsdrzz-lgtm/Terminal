import { couleurJoie, partJoie } from "@/lib/couleurs";

/**
 * Le visage de la joie — l'élément signature de l'application.
 *
 * Ce n'est pas un emoji : c'est un tracé dont la bouche s'incurve avec la
 * note et dont le disque prend la teinte de la rampe. Un emoji aurait plafonné
 * à douze expressions figées et changé de dessin d'un téléphone à l'autre.
 *
 * Aucune note n'est punie : à 1, la bouche est simplement horizontale et le
 * disque discret. Pas de rouge, pas de grimace.
 */
export function VisageJoie({
  valeur,
  taille = 96,
  className = "",
}: {
  valeur: number;
  taille?: number;
  className?: string;
}) {
  const part = partJoie(valeur);

  // Le point de contrôle passe sous la ligne des commissures à mesure que la
  // note monte : c'est ce seul nombre qui fait toute l'expression.
  const controle = 54 + part * 34;
  const rayonOeil = 5.4 - part * 0.9;
  const ecartement = 14 + part * 1.5;

  return (
    <svg
      viewBox="0 0 100 100"
      width={taille}
      height={taille}
      className={className}
      role="img"
      aria-label={`Niveau de joie : ${Math.round(valeur)} sur 10`}
    >
      <circle cx="50" cy="50" r="46" fill={couleurJoie(valeur)} />
      <circle cx={50 - ecartement} cy="41" r={rayonOeil} fill="var(--encre)" />
      <circle cx={50 + ecartement} cy="41" r={rayonOeil} fill="var(--encre)" />
      <path
        d={`M 31 64 Q 50 ${controle} 69 64`}
        fill="none"
        stroke="var(--encre)"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}
