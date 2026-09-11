/**
 * Ce qu'on voit pendant que l'écran suivant se prépare.
 *
 * ## Pourquoi il n'y en avait pas, et pourquoi il en faut un
 *
 * Sans `loading.tsx`, Next garde l'écran PRÉCÉDENT affiché jusqu'à ce que le
 * suivant soit prêt. Sur une navigation de cinquante millisecondes c'est le bon
 * comportement — un clignotement de squelette serait pire. Mais ces écrans
 * lisent quatre cents journées : mesuré en développement, les souvenirs
 * prennent huit cents millisecondes, le profil trois cent cinquante, et la base
 * est en local. Avec Neon à l'autre bout, on touche « Souvenirs » et il ne se
 * passe rien pendant une seconde. L'application a l'air bloquée, on retouche, et
 * on double la charge.
 *
 * ## Pourquoi un squelette et pas un rond qui tourne
 *
 * Parce qu'il dit **où** le contenu va arriver. Un rond au milieu de l'écran ne
 * raconte rien et donne l'impression d'attendre plus longtemps.
 *
 * Il est délibérément vague : un titre, trois cartes. Dessiner le squelette
 * exact de chaque écran demanderait un fichier par route et une mise à jour à
 * chaque changement de mise en page — pour quelque chose qu'on voit une demi-
 * seconde.
 */
export default function Chargement() {
  return (
    <div className="px-4 pt-3">
      {/* L'annonce est en dehors du `aria-hidden` : un `aria-live` enterré
          dedans n'est jamais lu, ce qui est le seul cas où ce composant aurait
          servi à quelqu'un qui ne voit pas l'écran. */}
      <span className="sr-only" role="status">
        Chargement…
      </span>
      <div aria-hidden>
        <div className="mb-6 zone-sure-haute">
          <span className="block h-7 w-40 rounded-full bg-surface-2" />
          <span className="mt-2 block h-3.5 w-56 rounded-full bg-surface-2" />
        </div>

        <div className="space-y-3">
          {[0, 1, 2].map((rang) => (
            <div
              key={rang}
              className="rounded-[var(--radius-carte)] border border-trait bg-surface p-4"
              // Les trois cartes s'éteignent en décalé : sans ça, trois blocs
              // gris parfaitement synchrones ressemblent à une page cassée.
              style={{ animation: `respire 1.6s ease-in-out ${rang * 0.18}s infinite` }}
            >
              <div className="flex items-start gap-3">
                <span className="h-9 w-9 shrink-0 rounded-full bg-surface-2" />
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <span className="block h-3 w-24 rounded-full bg-surface-2" />
                  <span className="block h-3 w-full rounded-full bg-surface-2" />
                  <span className="block h-3 w-2/3 rounded-full bg-surface-2" />
                </div>
                <span className="h-12 w-12 shrink-0 rounded-2xl bg-surface-2" />
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
