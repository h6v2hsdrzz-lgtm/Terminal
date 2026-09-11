-- Les paroles : ce que quelqu'un a dit pendant un jeu, et qu'on garde.
--
-- Relue avant d'être appliquée, comme toutes les autres. Ce qu'elle fait :
--
-- · elle CRÉE `bande_paroles`, et rien d'autre côté données ;
-- · elle renomme trois index et refait une clé étrangère à l'identique. C'est
--   de la cosmétique : la migration du lot N avait été écrite à la main avec
--   des noms d'index courts, et Prisma veut les siens. Aucun DROP sur une
--   donnée existante, aucune colonne perdue.

-- DropForeignKey
ALTER TABLE "bande_actions_joueurs" DROP CONSTRAINT "bande_actions_joueurs_partie_id_fkey";

-- CreateTable
CREATE TABLE "bande_paroles" (
    "id" TEXT NOT NULL,
    "partie_id" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "manche" INTEGER NOT NULL,
    "sujet" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "octets" BYTEA,
    "cle" TEXT,
    "poids" INTEGER NOT NULL DEFAULT 0,
    "duree" INTEGER NOT NULL,
    "niveaux" INTEGER[],
    "note" INTEGER,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_paroles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bande_paroles_partie_id_manche_idx" ON "bande_paroles"("partie_id", "manche");

-- CreateIndex
CREATE INDEX "bande_paroles_membre_id_cree_le_idx" ON "bande_paroles"("membre_id", "cree_le");

-- AddForeignKey
ALTER TABLE "bande_paroles" ADD CONSTRAINT "bande_paroles_partie_id_fkey" FOREIGN KEY ("partie_id") REFERENCES "bande_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_paroles" ADD CONSTRAINT "bande_paroles_membre_id_fkey" FOREIGN KEY ("membre_id") REFERENCES "bande_membres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_actions_joueurs" ADD CONSTRAINT "bande_actions_joueurs_partie_id_fkey" FOREIGN KEY ("partie_id") REFERENCES "bande_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "bande_actions_joueurs_partie_manche_idx" RENAME TO "bande_actions_joueurs_partie_id_manche_idx";

-- RenameIndex
ALTER INDEX "bande_actions_joueurs_partie_manche_phase_membre_key" RENAME TO "bande_actions_joueurs_partie_id_manche_phase_membre_id_key";

-- RenameIndex
ALTER INDEX "bande_parties_groupe_etat_idx" RENAME TO "bande_parties_groupe_id_etat_idx";
