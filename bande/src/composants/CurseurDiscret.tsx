"use client";

import { useState } from "react";

/**
 * Un curseur secondaire : l'énergie, le rire.
 *
 * Il est facultatif, et il le reste vraiment — tant qu'on n'y a pas touché,
 * rien n'est envoyé. C'est la différence entre « je n'ai pas répondu » et
 * « j'ai répondu 5 », et un curseur qui démarre au milieu ment sur les deux.
 * L'écran affiche donc un tiret jusqu'au premier geste.
 *
 * Ces deux mesures n'entrent dans aucun classement et ne comptent dans aucune
 * moyenne. Elles servent à relire une année et à voir qu'une journée à 7 sans
 * énergie n'est pas la même chose qu'une journée à 7 pleine d'élan.
 */
export function CurseurDiscret({
  nom,
  etiquette,
  bas,
  haut,
  valeurInitiale = null,
}: {
  nom: string;
  etiquette: string;
  /** Ce que veut dire 1, et ce que veut dire 10. */
  bas: string;
  haut: string;
  valeurInitiale?: number | null;
}) {
  const [valeur, setValeur] = useState<number | null>(valeurInitiale);

  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={nom} className="text-[14px] text-encre-2">
          {etiquette}
        </label>
        <span className="chiffres text-[15px] text-encre-3">
          {valeur === null ? "—" : valeur}
        </span>
      </div>

      {/* Le champ nommé n'existe que si on a répondu : un champ vide et un
          champ absent veulent dire la même chose côté serveur, mais ne pas
          l'émettre du tout évite d'avoir à s'en remettre à cette équivalence. */}
      {valeur !== null && <input type="hidden" name={nom} value={valeur} />}

      <input
        id={nom}
        type="range"
        min={1}
        max={10}
        step={1}
        value={valeur ?? 5}
        onChange={(e) => setValeur(Number(e.target.value))}
        aria-valuetext={valeur === null ? "pas encore répondu" : `${valeur} sur 10`}
        className="mt-1 w-full accent-[var(--encre)]"
        style={{ opacity: valeur === null ? 0.5 : 1 }}
      />

      <div className="flex justify-between text-[12px] text-encre-3">
        <span>{bas}</span>
        <span>{haut}</span>
      </div>
    </div>
  );
}
