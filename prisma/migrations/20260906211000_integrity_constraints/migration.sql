-- DropForeignKey
ALTER TABLE "MonitorCursor" DROP CONSTRAINT "MonitorCursor_monitorId_fkey";

-- DropForeignKey
ALTER TABLE "Run" DROP CONSTRAINT "Run_monitorId_fkey";

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_monitorId_fkey";

-- CreateIndex
CREATE INDEX "Run_monitorId_startedAt_idx" ON "Run"("monitorId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Listing_listTime_idx" ON "Listing"("listTime" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Match_monitorId_listingId_key" ON "Match"("monitorId", "listingId");

-- CreateIndex
CREATE INDEX "Match_monitorId_notifiedAt_idx" ON "Match"("monitorId", "notifiedAt");

-- AddForeignKey
ALTER TABLE "MonitorCursor" ADD CONSTRAINT "MonitorCursor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
