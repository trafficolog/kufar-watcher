-- CreateTable
CREATE TABLE "MonitorCatchUpCheckpoint" (
    "monitorId" INTEGER NOT NULL,
    "resumeCursor" TEXT NOT NULL,
    "pendingBoundaryTime" TIMESTAMP(3) NOT NULL,
    "pendingBoundaryIds" JSONB NOT NULL,
    "pagesRead" INTEGER NOT NULL,
    "lastPage" INTEGER,
    "lastIndex" INTEGER,
    "lastListId" TEXT,
    "lastListTime" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitorCatchUpCheckpoint_pkey" PRIMARY KEY ("monitorId"),
    CONSTRAINT "MonitorCatchUpCheckpoint_pagesRead_check" CHECK ("pagesRead" >= 1),
    CONSTRAINT "MonitorCatchUpCheckpoint_lastObservation_check" CHECK (
        (
            "lastPage" IS NULL AND
            "lastIndex" IS NULL AND
            "lastListId" IS NULL AND
            "lastListTime" IS NULL
        ) OR (
            "lastPage" IS NOT NULL AND
            "lastIndex" IS NOT NULL AND
            "lastListId" IS NOT NULL AND
            "lastListTime" IS NOT NULL
        )
    ),
    CONSTRAINT "MonitorCatchUpCheckpoint_lastPage_check" CHECK ("lastPage" IS NULL OR "lastPage" >= 1),
    CONSTRAINT "MonitorCatchUpCheckpoint_lastIndex_check" CHECK ("lastIndex" IS NULL OR "lastIndex" >= 0)
);

-- AddForeignKey
ALTER TABLE "MonitorCatchUpCheckpoint"
ADD CONSTRAINT "MonitorCatchUpCheckpoint_monitorId_fkey"
FOREIGN KEY ("monitorId") REFERENCES "MonitorCursor"("monitorId") ON DELETE CASCADE ON UPDATE CASCADE;
