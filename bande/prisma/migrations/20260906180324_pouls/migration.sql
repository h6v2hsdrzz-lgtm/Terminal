-- CreateTable
CREATE TABLE "bande_pouls" (
    "id" TEXT NOT NULL,
    "groupe_id" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "jour" TEXT NOT NULL,
    "rire" INTEGER NOT NULL,
    "energie" INTEGER NOT NULL,
    "pose_a" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_pouls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bande_pouls_groupe_id_jour_idx" ON "bande_pouls"("groupe_id", "jour");

-- AddForeignKey
ALTER TABLE "bande_pouls" ADD CONSTRAINT "bande_pouls_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "bande_groupes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_pouls" ADD CONSTRAINT "bande_pouls_membre_id_fkey" FOREIGN KEY ("membre_id") REFERENCES "bande_membres"("id") ON DELETE CASCADE ON UPDATE CASCADE;
