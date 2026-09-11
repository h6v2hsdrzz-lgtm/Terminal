-- Lot M. La vignette n'est plus forcément du JPEG : le navigateur l'encode en
-- WebP quand il sait, ce qui la rend environ un quart plus légère.
--
-- La colonne est nullable, et c'est le sens qu'on lui donne : « pas de type
-- enregistré » veut dire « JPEG », ce qu'étaient toutes les vignettes jusqu'ici.
-- Aucune ligne existante n'est touchée.
ALTER TABLE "bande_photos" ADD COLUMN "mime_vignette" TEXT;
