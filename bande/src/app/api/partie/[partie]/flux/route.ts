import { lireEtatPartie, presenceDePartie, versionPartie } from "@/lib/depot-jeux";
import { membreConnecte } from "@/lib/session";

/**
 * Le flux d'une partie : un événement par changement d'état.
 *
 * ## Pourquoi SSE et pas du sondage
 *
 * Le reste de l'application se contente d'une empreinte relue toutes les trois
 * secondes, et c'est très bien pour un fil. Une partie, non : trois secondes
 * entre « tout le monde a voté » et l'affichage du résultat, ce sont trois
 * secondes où quelqu'un demande « alors ? ». SSE descend à quelques centaines
 * de millisecondes, ne demande aucun compte tiers, et se reconnecte tout seul —
 * `EventSource` le fait sans une ligne de code.
 *
 * ## Pourquoi le serveur sonde quand même
 *
 * PostgreSQL sait notifier (`LISTEN`/`NOTIFY`), mais pas à travers le pool de
 * Neon, qui coupe les connexions au fil des transactions. On relit donc la
 * VERSION — une seule colonne, sur une clé primaire — quatre fois par seconde,
 * et on n'envoie l'état complet que lorsqu'elle bouge. C'est la différence
 * entre « lire un entier » et « recharger une partie », et elle se voit sur
 * une base gratuite.
 *
 * ## Pourquoi la présence se relit à part
 *
 * Une absence ne fait bouger aucune version : personne ne publie « mon
 * téléphone s'éteint ». Sans cette deuxième lecture, un joueur disparu resterait
 * « présent » jusqu'à la prochaine reconnexion du flux — cinquante secondes — et
 * pendant ce temps la manche attendrait sa réponse, et personne ne pourrait
 * reprendre la main. On relit donc la liste des présents deux fois par seconde
 * et demie, et on ne recharge l'état complet que si elle a changé.
 *
 * ## La durée
 *
 * Une fonction ne vit pas indéfiniment en production. On ferme proprement au
 * bout de cinquante secondes, avant que la plateforme ne le fasse brutalement :
 * `EventSource` rouvre dans la foulée, et la reconnexion est invisible. Le
 * commentaire de garde (`:`) toutes les quinze secondes empêche les
 * intermédiaires de couper une connexion qu'ils croient morte.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CADENCE_MS = 250;
const PRESENCE_MS = 2_500;
const GARDE_MS = 15_000;
const VIE_MS = 50_000;

export async function GET(
  requete: Request,
  { params }: { params: Promise<{ partie: string }> },
) {
  const membreId = await membreConnecte();
  if (!membreId) return new Response(null, { status: 401 });

  const { partie: partieId } = await params;
  // Une première lecture complète sert de contrôle d'accès : `lireEtatPartie`
  // rend `null` pour une partie qui n'est pas de la bande, et on n'ouvre pas
  // un flux sur une partie qu'on n'a pas le droit de lire.
  const depart = await lireEtatPartie(membreId, partieId);
  if (!depart) return new Response(null, { status: 404 });

  const encodeur = new TextEncoder();
  let fermé = false;

  const flux = new ReadableStream({
    async start(controleur) {
      const envoyer = (evenement: string, donnees: unknown) => {
        if (fermé) return;
        controleur.enqueue(
          encodeur.encode(`event: ${evenement}\ndata: ${JSON.stringify(donnees)}\n\n`),
        );
      };

      const fermer = () => {
        if (fermé) return;
        fermé = true;
        try {
          controleur.close();
        } catch {
          // Déjà fermé par la plateforme : il n'y a rien à sauver.
        }
      };

      requete.signal.addEventListener("abort", fermer);

      envoyer("etat", depart);
      let connue = depart.version;
      let presents = [...depart.presents].sort().join(",");
      let derniereGarde = Date.now();
      let dernierePresence = Date.now();
      const finDeVie = Date.now() + VIE_MS;

      while (!fermé && Date.now() < finDeVie) {
        await new Promise((suite) => setTimeout(suite, CADENCE_MS));
        if (fermé) break;

        try {
          const version = await versionPartie(partieId);
          if (version === null) {
            // La partie a disparu — quelqu'un a quitté la bande, la base a été
            // réinitialisée. On le dit plutôt que de laisser l'écran attendre.
            envoyer("disparue", {});
            break;
          }

          let aChange = version !== connue;
          if (!aChange && Date.now() - dernierePresence > PRESENCE_MS) {
            dernierePresence = Date.now();
            aChange = (await presenceDePartie(partieId)).join(",") !== presents;
          }

          if (aChange) {
            const etat = await lireEtatPartie(membreId, partieId);
            if (!etat) break;
            connue = etat.version;
            presents = [...etat.presents].sort().join(",");
            envoyer("etat", etat);
          } else if (Date.now() - derniereGarde > GARDE_MS) {
            controleur.enqueue(encodeur.encode(": garde\n\n"));
            derniereGarde = Date.now();
          }
        } catch {
          // Une base qui hoquette ne doit pas tuer la partie : on laisse le
          // client rouvrir, ce qu'il fait tout seul.
          break;
        }
      }

      fermer();
    },
  });

  return new Response(flux, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // Un flux ne se met pas en cache, et surtout pas dans un cache partagé :
      // ce sont les votes d'une bande précise.
      "Cache-Control": "private, no-cache, no-store, no-transform",
      Connection: "keep-alive",
      // Sans ça, un intermédiaire qui tamponne garde les événements pour les
      // envoyer en bloc à la fin — c'est-à-dire jamais.
      "X-Accel-Buffering": "no",
    },
  });
}
