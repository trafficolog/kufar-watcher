ALTER TABLE "MonitorCursor"
  ADD COLUMN "catchupCursor" TEXT,
  ADD COLUMN "catchupBoundaryTime" TIMESTAMP(3),
  ADD COLUMN "catchupBoundaryIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "catchupLastListTime" TIMESTAMP(3),
  ADD COLUMN "catchupLastListId" TEXT;

ALTER TABLE "MonitorCursor"
  ADD CONSTRAINT "MonitorCursor_catchup_cursor_boundary_pair_check"
    CHECK (("catchupCursor" IS NULL) = ("catchupBoundaryTime" IS NULL)),
  ADD CONSTRAINT "MonitorCursor_catchup_last_observation_pair_check"
    CHECK (("catchupLastListTime" IS NULL) = ("catchupLastListId" IS NULL));
