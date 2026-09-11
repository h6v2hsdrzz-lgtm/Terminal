-- Le réveil du matin : deux repères, pour ne rien envoyer deux fois.
--
-- Relue avant d'être appliquée, comme toutes les autres. Deux colonnes
-- NULLABLES ajoutées, rien d'autre : aucun DROP, aucune donnée touchée, et une
-- ligne existante reste parfaitement valide avec un NULL.
--
-- · `bande_capsules.annonce_le` — quand la bande a été prévenue qu'un scellé
--   s'ouvrait. C'est la dette C5 de la vague 1 ;
-- · `bande_paroles.renvoyee_le` — quand un plaidoyer du « Tribunal des idées »
--   a été renvoyé à son auteur le lendemain matin. C'est le principe du jeu, et
--   la dette laissée par le lot O.
--
-- Sans ces deux repères, un réveil quotidien renverrait chaque jour la même
-- notification jusqu'à la fin des temps.

-- AlterTable
ALTER TABLE "bande_capsules" ADD COLUMN     "annonce_le" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "bande_paroles" ADD COLUMN     "renvoyee_le" TIMESTAMP(3);
