-- « Marie Jane » devient « Marie Janne ».
--
-- Un UPDATE du libellé, pas un DELETE suivi d'un INSERT : la ligne garde son
-- identifiant, donc les journées qui la portent restent cochées et l'effet
-- mesuré garde son historique. C'est exactement le même raisonnement que pour
-- « Plante verte » → « Marie Jane » au lot A, et pour la même raison.
UPDATE "bande_declencheurs" SET "nom" = 'Marie Janne' WHERE "nom" = 'Marie Jane';
