-- CreateTable
CREATE TABLE "bande_parties" (
    "id" TEXT NOT NULL,
    "groupe_id" TEXT NOT NULL,
    "jeu" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'un-telephone',
    "commencee_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finie_le" TIMESTAMP(3),

    CONSTRAINT "bande_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_scores_partie" (
    "id" TEXT NOT NULL,
    "partie_id" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "sobre" BOOLEAN NOT NULL DEFAULT false,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bande_scores_partie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_manches" (
    "id" TEXT NOT NULL,
    "partie_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "membre_id" TEXT,
    "donnees" JSONB NOT NULL DEFAULT '{}',
    "creee_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_manches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_cartes" (
    "id" TEXT NOT NULL,
    "groupe_id" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "creee_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_cartes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bande_parties_groupe_id_commencee_le_idx" ON "bande_parties"("groupe_id", "commencee_le");

-- CreateIndex
CREATE UNIQUE INDEX "bande_scores_partie_partie_id_membre_id_key" ON "bande_scores_partie"("partie_id", "membre_id");

-- CreateIndex
CREATE INDEX "bande_manches_partie_id_numero_idx" ON "bande_manches"("partie_id", "numero");

-- CreateIndex
CREATE INDEX "bande_cartes_groupe_id_idx" ON "bande_cartes"("groupe_id");

-- AddForeignKey
ALTER TABLE "bande_parties" ADD CONSTRAINT "bande_parties_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "bande_groupes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_scores_partie" ADD CONSTRAINT "bande_scores_partie_partie_id_fkey" FOREIGN KEY ("partie_id") REFERENCES "bande_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_manches" ADD CONSTRAINT "bande_manches_partie_id_fkey" FOREIGN KEY ("partie_id") REFERENCES "bande_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_cartes" ADD CONSTRAINT "bande_cartes_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "bande_groupes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
