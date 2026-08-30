-- CreateTable
CREATE TABLE "entrees" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "personne" TEXT NOT NULL,
    "joie" INTEGER NOT NULL,
    "biberon" BOOLEAN NOT NULL DEFAULT false,
    "plante_verte" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entrees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entrees_date_idx" ON "entrees"("date");

-- CreateIndex
CREATE INDEX "entrees_personne_idx" ON "entrees"("personne");

-- CreateIndex
CREATE UNIQUE INDEX "entrees_date_personne_key" ON "entrees"("date", "personne");
