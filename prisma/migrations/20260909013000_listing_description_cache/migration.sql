-- CreateEnum
CREATE TYPE "ListingAvailability" AS ENUM ('active', 'gone');

-- AlterTable
ALTER TABLE "Listing"
ADD COLUMN "availability" "ListingAvailability" NOT NULL DEFAULT 'active',
ADD COLUMN "descriptionLoaded" BOOLEAN NOT NULL DEFAULT false;
