-- Lot M. Le stockage des octets devient indirect : ils restent en base tant
-- qu'aucune clé n'est renseignée, et partent chez Cloudflare R2 dès qu'une clé
-- l'est. Les deux états coexistent, donc la migration des fichiers peut
-- s'étaler, s'interrompre et repartir sans rien perdre.

-- « DROP NOT NULL » ne touche à aucune donnée existante : toutes les lignes
-- gardent leurs octets. C'est la possibilité de les vider qui est ajoutée.
ALTER TABLE "bande_photos" ALTER COLUMN "octets" DROP NOT NULL;
ALTER TABLE "bande_photos" ADD COLUMN "cle" TEXT;
ALTER TABLE "bande_photos" ADD COLUMN "cle_vignette" TEXT;

ALTER TABLE "bande_audios" ALTER COLUMN "octets" DROP NOT NULL;
ALTER TABLE "bande_audios" ADD COLUMN "cle" TEXT;
