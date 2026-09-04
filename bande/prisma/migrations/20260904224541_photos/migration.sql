/*
  Warnings:

  - You are about to drop the column `photo` on the `bande_entrees` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bande_entrees" DROP COLUMN "photo";

-- CreateTable
CREATE TABLE "bande_photos" (
    "id" TEXT NOT NULL,
    "entree_id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "octets" BYTEA NOT NULL,
    "largeur" INTEGER NOT NULL,
    "hauteur" INTEGER NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bande_photos_entree_id_key" ON "bande_photos"("entree_id");

-- AddForeignKey
ALTER TABLE "bande_photos" ADD CONSTRAINT "bande_photos_entree_id_fkey" FOREIGN KEY ("entree_id") REFERENCES "bande_entrees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
