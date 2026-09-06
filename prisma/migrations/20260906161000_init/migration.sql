-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MonitorState" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "PriceKind" AS ENUM ('fixed', 'negotiable', 'free', 'unknown');

-- CreateTable
CREATE TABLE "Monitor" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "intervalSec" INTEGER NOT NULL,
    "keywords" JSONB NOT NULL,
    "searchInDescription" BOOLEAN NOT NULL DEFAULT false,
    "sellerType" TEXT,
    "state" "MonitorState" NOT NULL DEFAULT 'active',

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorCursor" (
    "monitorId" INTEGER NOT NULL,
    "boundaryTime" TIMESTAMP(3),
    "boundaryIds" JSONB NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitorCursor_pkey" PRIMARY KEY ("monitorId")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" SERIAL NOT NULL,
    "monitorId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "httpStatus" INTEGER,
    "seen" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "degradedLevel" TEXT,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "listId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceKind" "PriceKind" NOT NULL,
    "priceAmount" DECIMAL(65,30),
    "currency" TEXT,
    "url" TEXT NOT NULL,
    "region" TEXT,
    "accountId" TEXT,
    "isCompany" BOOLEAN,
    "listTime" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "raw" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("listId")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" SERIAL NOT NULL,
    "monitorId" INTEGER NOT NULL,
    "listingId" TEXT NOT NULL,
    "matchedTerms" JSONB NOT NULL,
    "matchedIn" JSONB NOT NULL,
    "snippet" TEXT,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "MonitorCursor" ADD CONSTRAINT "MonitorCursor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("listId") ON DELETE RESTRICT ON UPDATE CASCADE;

