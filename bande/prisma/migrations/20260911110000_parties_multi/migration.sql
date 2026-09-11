-- Lot N. Les parties se jouent à trois téléphones, donc l'état passe côté
-- serveur : il ne peut plus vivre dans l'appareil de celui qui anime.
--
-- Tout est additif. Les parties existantes gardent leur mode « un-telephone »
-- (la valeur par défaut ne s'applique qu'aux nouvelles lignes) et se terminent
-- comme avant.

ALTER TABLE "bande_parties" ADD COLUMN "hote_id" TEXT;
ALTER TABLE "bande_parties" ADD COLUMN "code" TEXT;
ALTER TABLE "bande_parties" ADD COLUMN "etat" TEXT NOT NULL DEFAULT 'salon';
ALTER TABLE "bande_parties" ADD COLUMN "phase" TEXT;
ALTER TABLE "bande_parties" ADD COLUMN "donnees_phase" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "bande_parties" ADD COLUMN "echeance" TIMESTAMP(3);
ALTER TABLE "bande_parties" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Les parties d'avant le lot N n'ont jamais eu de salon : elles sont en cours,
-- ou finies. Les laisser à « salon » les ferait réapparaître dans un écran
-- d'attente qu'elles n'ont jamais connu.
UPDATE "bande_parties"
   SET "etat" = CASE WHEN "finie_le" IS NULL THEN 'encours' ELSE 'finie' END;

-- La valeur par défaut du mode change pour les NOUVELLES parties seulement.
ALTER TABLE "bande_parties" ALTER COLUMN "mode" SET DEFAULT 'multi';

ALTER TABLE "bande_scores_partie"
  ADD COLUMN "vu_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "bande_actions_joueurs" (
  "id" TEXT NOT NULL,
  "partie_id" TEXT NOT NULL,
  "membre_id" TEXT NOT NULL,
  "manche" INTEGER NOT NULL,
  "phase" TEXT NOT NULL,
  "donnees" JSONB NOT NULL DEFAULT '{}',
  "creee_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bande_actions_joueurs_pkey" PRIMARY KEY ("id")
);

-- Un joueur n'a qu'une réponse par phase : la deuxième remplace la première.
-- C'est ce qui rend l'envoi rejouable quand le réseau hésite.
CREATE UNIQUE INDEX "bande_actions_joueurs_partie_manche_phase_membre_key"
  ON "bande_actions_joueurs" ("partie_id", "manche", "phase", "membre_id");
CREATE INDEX "bande_actions_joueurs_partie_manche_idx"
  ON "bande_actions_joueurs" ("partie_id", "manche");
CREATE INDEX "bande_parties_groupe_etat_idx" ON "bande_parties" ("groupe_id", "etat");

ALTER TABLE "bande_actions_joueurs"
  ADD CONSTRAINT "bande_actions_joueurs_partie_id_fkey"
  FOREIGN KEY ("partie_id") REFERENCES "bande_parties"("id") ON DELETE CASCADE;
