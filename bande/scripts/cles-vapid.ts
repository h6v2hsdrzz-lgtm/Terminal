/**
 * Fabrique la paire de clés VAPID, une fois.
 *
 * Les notifications poussées ne partent que si ces deux variables sont posées.
 * Rien n'est cassé sans elles : l'écran de réglages dit simplement que les
 * notifications ne sont pas branchées sur ce déploiement, et le reste tourne.
 *
 *   npm run pousse:cles
 *
 * Puis on colle les trois lignes affichées dans l'environnement — `.env` en
 * local, les variables du projet chez Vercel. **La moitié privée ne va nulle
 * part ailleurs** : elle est ce qui prouve que les notifications viennent de
 * nous, et elle n'a aucune raison d'exister ailleurs que sur le serveur.
 */
import { fabriquerCles } from "../src/lib/pousse/vapid";

const { publique, privee } = fabriquerCles();

process.stdout.write(`
Colle ceci dans ton environnement :

VAPID_PUBLIQUE=${publique}
VAPID_PRIVEE=${privee}
VAPID_CONTACT=mailto:quelqu-un@de-la-bande.fr

La publique voyage avec chaque abonnement, elle n'est pas secrète.
La PRIVÉE reste sur le serveur, et nulle part ailleurs.
Le contact sert aux opérateurs de service de pousse pour joindre quelqu'un si
nos envois posent problème ; certains refusent un jeton sans.
`);
