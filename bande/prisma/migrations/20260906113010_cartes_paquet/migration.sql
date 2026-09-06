-- DropIndex
DROP INDEX "bande_cartes_groupe_id_idx";

-- AlterTable
ALTER TABLE "bande_cartes" ADD COLUMN     "paquet" TEXT NOT NULL DEFAULT 'potes';

-- CreateIndex
CREATE INDEX "bande_cartes_groupe_id_paquet_idx" ON "bande_cartes"("groupe_id", "paquet");
