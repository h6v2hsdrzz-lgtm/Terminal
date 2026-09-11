-- Les notifications poussées.
--
-- Relue avant d'être appliquée, comme toutes les autres. Purement additive :
-- une colonne avec valeur par défaut sur `bande_membres`, et une table neuve.
-- Aucun DROP, aucune colonne existante touchée.

-- AlterTable
ALTER TABLE "bande_membres" ADD COLUMN     "notifications" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "bande_abonnements" (
    "id" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vu_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_abonnements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bande_abonnements_endpoint_key" ON "bande_abonnements"("endpoint");

-- CreateIndex
CREATE INDEX "bande_abonnements_membre_id_idx" ON "bande_abonnements"("membre_id");

-- AddForeignKey
ALTER TABLE "bande_abonnements" ADD CONSTRAINT "bande_abonnements_membre_id_fkey" FOREIGN KEY ("membre_id") REFERENCES "bande_membres"("id") ON DELETE CASCADE ON UPDATE CASCADE;
