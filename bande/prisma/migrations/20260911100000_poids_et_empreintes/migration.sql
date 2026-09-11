-- Lot M. Le poids d'un fichier doit survivre à son déménagement.
--
-- Jusqu'ici l'écran de stockage additionnait `pg_column_size(octets)`. Dès que
-- les octets partent chez R2, cette somme tombe à zéro et la jauge annonce une
-- base vide pendant que le seau se remplit. Le poids devient donc une colonne
-- à part, écrite à l'envoi, vraie où que vivent les octets.
ALTER TABLE "bande_photos" ADD COLUMN "poids" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bande_photos" ADD COLUMN "poids_vignette" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bande_photos" ADD COLUMN "empreinte" TEXT;
ALTER TABLE "bande_audios" ADD COLUMN "poids" INTEGER NOT NULL DEFAULT 0;

-- Le rattrapage se fait ici, tant que les octets sont encore là : après le
-- déménagement, il faudrait les retélécharger un par un pour le calculer.
-- `octet_length` et non `pg_column_size` : on veut le poids du fichier, pas
-- celui de sa représentation compressée en base.
UPDATE "bande_photos"
   SET "poids" = COALESCE(octet_length("octets"), 0),
       "poids_vignette" = COALESCE(octet_length("vignette"), 0),
       "empreinte" = CASE WHEN "octets" IS NULL THEN NULL
                          ELSE encode(sha256("octets"), 'hex') END;

UPDATE "bande_audios" SET "poids" = COALESCE(octet_length("octets"), 0);
