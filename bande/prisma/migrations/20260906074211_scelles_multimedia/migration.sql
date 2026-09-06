-- AlterTable
ALTER TABLE "bande_capsules" ADD COLUMN     "apercu" BYTEA,
ADD COLUMN     "duree" INTEGER,
ADD COLUMN     "genre" TEXT NOT NULL DEFAULT 'mot',
ADD COLUMN     "mime" TEXT,
ADD COLUMN     "octets" BYTEA;
