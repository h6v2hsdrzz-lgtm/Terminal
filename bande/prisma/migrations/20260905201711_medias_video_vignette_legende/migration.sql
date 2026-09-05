-- AlterTable
ALTER TABLE "bande_photos" ADD COLUMN     "duree" INTEGER,
ADD COLUMN     "genre" TEXT NOT NULL DEFAULT 'photo',
ADD COLUMN     "legende" TEXT,
ADD COLUMN     "vignette" BYTEA;
