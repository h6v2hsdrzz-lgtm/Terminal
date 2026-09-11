import { NextResponse } from "next/server";

import { jourDeLaBande } from "@/lib/dates";
import { marquerScelleAnnonce, membresDe, scellesAAnnoncer } from "@/lib/depot";
import { marquerParoleRenvoyee, parolesARenvoyer } from "@/lib/depot-jeux";
import { prevenirEtAttendre } from "@/lib/pousse";

/**
 * Le réveil du matin : la seule chose de l'application qui se passe sans que
 * personne n'ouvre son téléphone.
 *
 * Il paie deux dettes, et elles attendaient la même chose — des notifications :
 *
 * · **un scellé qui s'ouvre** (dette C5, vague 1). Un scellé qui s'ouvre sans
 *   que personne ne le sache est un scellé qui ne s'ouvre pas ;
 * · **le plaidoyer du « Tribunal des idées »** (dette du lot O). On défend une
 *   idée absurde avec conviction, et le lendemain matin on se réécoute. C'est le
 *   principe du jeu, pas une option.
 *
 * ## Qui a le droit de l'appeler
 *
 * Vercel, et personne d'autre. Le planificateur envoie
 * `Authorization: Bearer $CRON_SECRET` ; sans le secret, la route répond 401
 * sans rien faire. Une route de réveil ouverte à tous laisserait n'importe qui
 * faire sonner trois téléphones à trois heures du matin.
 *
 * **Sans `CRON_SECRET` posé, la route refuse tout le monde** plutôt que
 * d'accepter tout le monde : un secret oublié doit couper la fonction, pas la
 * garde.
 *
 * ## Pourquoi il est rejouable
 *
 * Parce qu'un planificateur réessaie. Chaque chose envoyée est marquée
 * (`annonceLe`, `renvoyeeLe`) APRÈS l'envoi : deux passages dans la même
 * matinée n'envoient rien deux fois, et un envoi qui échoue sera retenté demain
 * plutôt que perdu.
 *
 * Et l'envoi est **attendu**, contrairement à partout ailleurs : une fonction
 * serverless qui rend sa réponse est gelée, et une notification encore en vol à
 * cet instant ne part jamais.
 *
 * ## Une fois par jour, et c'est tout
 *
 * Le palier gratuit de Vercel n'autorise qu'un déclenchement quotidien. C'est
 * exactement ce qu'il faut ici : les deux choses qu'il annonce se comptent en
 * jours, pas en minutes.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(requete: Request) {
  const attendu = process.env.CRON_SECRET;
  if (!attendu || requete.headers.get("authorization") !== `Bearer ${attendu}`) {
    return new NextResponse(null, { status: 401 });
  }

  const jour = jourDeLaBande();
  const rapport = { scelles: 0, paroles: 0 };

  // ── Les scellés du jour ───────────────────────────────────────────────────
  for (const scelle of await scellesAAnnoncer(jour)) {
    const membres = await membresDe(scelle.groupeId);
    if (membres.length === 0) continue;
    await prevenirEtAttendre(membres, {
      type: "scelle",
      titre: "Un scellé s'ouvre",
      corps: `${scelle.auteur} vous avait écrit : « ${scelle.texte.slice(0, 90)} »`,
      vers: "/souvenirs",
      // Une étiquette par scellé : deux qui s'ouvrent le même jour font deux
      // lignes, et c'est bien — ce sont deux choses différentes.
      etiquette: `scelle-${scelle.id}`,
    });
    await marquerScelleAnnonce(scelle.id);
    rapport.scelles += 1;
  }

  // ── Les plaidoyers de la veille ───────────────────────────────────────────
  //
  // « Plus de six heures » et pas « hier » : une partie qui finit à une heure du
  // matin doit se réécouter le matin MÊME, pas trente heures plus tard.
  const seuil = new Date(Date.now() - 6 * 60 * 60 * 1000);
  for (const parole of await parolesARenvoyer(seuil)) {
    await prevenirEtAttendre([parole.membreId], {
      type: "parole",
      titre: "Tu as dit ça hier soir",
      corps: `Ton plaidoyer : « ${parole.sujet.slice(0, 90)} ». Bon courage.`,
      vers: "/souvenirs",
      etiquette: `parole-${parole.id}`,
    });
    await marquerParoleRenvoyee(parole.id);
    rapport.paroles += 1;
  }

  return NextResponse.json(rapport, { headers: { "Cache-Control": "no-store" } });
}
