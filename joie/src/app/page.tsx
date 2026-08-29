import { Application } from "@/composants/Application";
import { listerEntrees } from "@/lib/depot";
import type { Entree } from "@/lib/types";

// Le journal change à chaque saisie : la page est rendue à la demande, avec
// les entrées déjà en place — pas d'écran vide au premier affichage.
export const dynamic = "force-dynamic";

export default async function Page() {
  let entrees: Entree[] | null = null;
  try {
    entrees = await listerEntrees();
  } catch {
    // Base absente ou non migrée : on explique quoi lancer plutôt que
    // d'afficher une trace d'exception.
    entrees = null;
  }

  if (entrees === null) return <BaseIndisponible />;
  return <Application entreesInitiales={entrees} />;
}

/** Le cas de loin le plus fréquent au premier lancement : migration jamais jouée. */
function BaseIndisponible() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-lg font-semibold">Base de données inaccessible</h1>
      <p className="text-sm text-attenue">
        La base SQLite n&apos;a pas encore été créée, ou <code>DATABASE_URL</code> ne pointe
        pas dessus. Depuis le dossier <code>joie/</code> :
      </p>
      <pre className="overflow-x-auto rounded-xl border border-bordure bg-surface p-4 text-xs">
        npm run db:setup
      </pre>
      <p className="text-sm text-attenue">
        Puis rechargez cette page. <code>npm run db:seed</code> ajoute six semaines de
        données de démonstration.
      </p>
    </main>
  );
}
