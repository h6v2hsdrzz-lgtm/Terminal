-- CreateTable
CREATE TABLE "bande_groupes" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "code_invitation" TEXT NOT NULL,
    "reveler_apres_post" BOOLEAN NOT NULL DEFAULT true,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_groupes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_membres" (
    "id" TEXT NOT NULL,
    "groupe_id" TEXT NOT NULL,
    "pseudo" TEXT NOT NULL,
    "teinte" INTEGER NOT NULL,
    "poignee_reprise" TEXT NOT NULL,
    "code_reprise" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vu_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_membres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_declencheurs" (
    "id" TEXT NOT NULL,
    "groupe_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bande_declencheurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_entrees" (
    "id" TEXT NOT NULL,
    "groupe_id" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "jour" TEXT NOT NULL,
    "joie" INTEGER NOT NULL,
    "note" TEXT,
    "photo" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bande_entrees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_entree_declencheurs" (
    "entree_id" TEXT NOT NULL,
    "declencheur_id" TEXT NOT NULL,

    CONSTRAINT "bande_entree_declencheurs_pkey" PRIMARY KEY ("entree_id","declencheur_id")
);

-- CreateTable
CREATE TABLE "bande_reactions" (
    "id" TEXT NOT NULL,
    "entree_id" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bande_commentaires" (
    "id" TEXT NOT NULL,
    "entree_id" TEXT NOT NULL,
    "membre_id" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bande_commentaires_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bande_groupes_code_invitation_key" ON "bande_groupes"("code_invitation");

-- CreateIndex
CREATE UNIQUE INDEX "bande_membres_poignee_reprise_key" ON "bande_membres"("poignee_reprise");

-- CreateIndex
CREATE INDEX "bande_membres_groupe_id_idx" ON "bande_membres"("groupe_id");

-- CreateIndex
CREATE UNIQUE INDEX "bande_membres_groupe_id_pseudo_key" ON "bande_membres"("groupe_id", "pseudo");

-- CreateIndex
CREATE INDEX "bande_declencheurs_groupe_id_idx" ON "bande_declencheurs"("groupe_id");

-- CreateIndex
CREATE INDEX "bande_entrees_groupe_id_jour_idx" ON "bande_entrees"("groupe_id", "jour");

-- CreateIndex
CREATE UNIQUE INDEX "bande_entrees_membre_id_jour_key" ON "bande_entrees"("membre_id", "jour");

-- CreateIndex
CREATE INDEX "bande_reactions_entree_id_idx" ON "bande_reactions"("entree_id");

-- CreateIndex
CREATE UNIQUE INDEX "bande_reactions_entree_id_membre_id_emoji_key" ON "bande_reactions"("entree_id", "membre_id", "emoji");

-- CreateIndex
CREATE INDEX "bande_commentaires_entree_id_idx" ON "bande_commentaires"("entree_id");

-- AddForeignKey
ALTER TABLE "bande_membres" ADD CONSTRAINT "bande_membres_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "bande_groupes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_declencheurs" ADD CONSTRAINT "bande_declencheurs_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "bande_groupes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_entrees" ADD CONSTRAINT "bande_entrees_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "bande_groupes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_entrees" ADD CONSTRAINT "bande_entrees_membre_id_fkey" FOREIGN KEY ("membre_id") REFERENCES "bande_membres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_entree_declencheurs" ADD CONSTRAINT "bande_entree_declencheurs_entree_id_fkey" FOREIGN KEY ("entree_id") REFERENCES "bande_entrees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_entree_declencheurs" ADD CONSTRAINT "bande_entree_declencheurs_declencheur_id_fkey" FOREIGN KEY ("declencheur_id") REFERENCES "bande_declencheurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_reactions" ADD CONSTRAINT "bande_reactions_entree_id_fkey" FOREIGN KEY ("entree_id") REFERENCES "bande_entrees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_reactions" ADD CONSTRAINT "bande_reactions_membre_id_fkey" FOREIGN KEY ("membre_id") REFERENCES "bande_membres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_commentaires" ADD CONSTRAINT "bande_commentaires_entree_id_fkey" FOREIGN KEY ("entree_id") REFERENCES "bande_entrees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bande_commentaires" ADD CONSTRAINT "bande_commentaires_membre_id_fkey" FOREIGN KEY ("membre_id") REFERENCES "bande_membres"("id") ON DELETE CASCADE ON UPDATE CASCADE;
