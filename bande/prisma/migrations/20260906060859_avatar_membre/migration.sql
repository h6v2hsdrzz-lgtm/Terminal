-- AlterTable
ALTER TABLE "bande_membres" ADD COLUMN     "avatar" BYTEA,
ADD COLUMN     "modifie_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
