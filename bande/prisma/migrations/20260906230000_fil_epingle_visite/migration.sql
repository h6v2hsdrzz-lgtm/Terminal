-- Lot L. Deux colonnes, toutes deux additives et avec une valeur par défaut :
-- aucune ligne existante n'est touchée, aucune donnée n'est perdue.

-- Une journée épinglée remonte en haut du fil, pour les trois.
ALTER TABLE "bande_entrees" ADD COLUMN "epingle" BOOLEAN NOT NULL DEFAULT false;

-- La dernière ouverture du fil. Nulle pour tout le monde au départ : la
-- première visite après la migration ne marque donc rien comme nouveau, ce qui
-- est exactement ce qu'on veut — on ne va pas signaler cent journées d'un coup.
ALTER TABLE "bande_membres" ADD COLUMN "fil_vu_le" TIMESTAMP(3);
