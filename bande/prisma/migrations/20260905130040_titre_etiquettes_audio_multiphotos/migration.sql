-- DropIndex
DROP INDEX "bande_photos_entree_id_key";

-- AlterTable
ALTER TABLE "bande_entrees" ADD COLUMN     "calme" INTEGER,
ADD COLUMN     "energie" INTEGER,
ADD COLUMN     "titre" TEXT;

-- AlterTable
ALTER TABLE "bande_photos" ADD COLUMN     "ordre" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "bande_audios" (
    "id" TEXT NOT NULL,
    "entree_id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "octets" BYTEA NOT NULL,
    "duree" INTEGER NOT NULL,
    "niveaux" INTEGER[],
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_audios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_etiquettes" (
    "id" TEXT NOT NULL,
    "groupe_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_etiquettes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_entree_etiquettes" (
    "entree_id" TEXT NOT NULL,
    "etiquette_id" TEXT NOT NULL,

    CONSTRAINT "bande_entree_etiquettes_pkey" PRIMARY KEY ("entree_id","etiquette_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bande_audios_entree_id_key" ON "bande_audios"("entree_id");

-- CreateIndex
CREATE UNIQUE INDEX "bande_etiquettes_groupe_id_cle_key" ON "bande_etiquettes"("groupe_id", "cle");

-- CreateIndex
CREATE INDEX "bande_entree_etiquettes_etiquette_id_idx" ON "bande_entree_etiquettes"("etiquette_id");

-- CreateIndex
CREATE INDEX "bande_photos_entree_id_ordre_idx" ON "bande_photos"("entree_id", "ordre");

-- AddForeignKey
ALTER TABLE "bande_audios" ADD CONSTRAINT "bande_audios_entree_id_fkey" FOREIGN KEY ("entree_id") REFERENCES "bande_entrees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_etiquettes" ADD CONSTRAINT "bande_etiquettes_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "bande_groupes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_entree_etiquettes" ADD CONSTRAINT "bande_entree_etiquettes_entree_id_fkey" FOREIGN KEY ("entree_id") REFERENCES "bande_entrees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_entree_etiquettes" ADD CONSTRAINT "bande_entree_etiquettes_etiquette_id_fkey" FOREIGN KEY ("etiquette_id") REFERENCES "bande_etiquettes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
