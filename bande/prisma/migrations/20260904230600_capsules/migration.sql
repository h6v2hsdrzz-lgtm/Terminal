-- CreateTable
CREATE TABLE "bande_capsules" (
    "id" TEXT NOT NULL,
    "groupe_id" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "ouvrir_le" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_capsules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bande_capsules_groupe_id_ouvrir_le_idx" ON "bande_capsules"("groupe_id", "ouvrir_le");

-- AddForeignKey
ALTER TABLE "bande_capsules" ADD CONSTRAINT "bande_capsules_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "bande_groupes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_capsules" ADD CONSTRAINT "bande_capsules_membre_id_fkey" FOREIGN KEY ("membre_id") REFERENCES "bande_membres"("id") ON DELETE CASCADE ON UPDATE CASCADE;
