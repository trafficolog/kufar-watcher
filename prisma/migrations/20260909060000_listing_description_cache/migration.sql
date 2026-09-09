-- CreateEnum
CREATE TYPE "ListingAvailability" AS ENUM ('unknown', 'available', 'unavailable');

-- AlterTable
ALTER TABLE "Listing"
ADD COLUMN "availability" "ListingAvailability" NOT NULL DEFAULT 'unknown',
ADD COLUMN "descriptionLoadedAt" TIMESTAMP(3);
