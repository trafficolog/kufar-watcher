DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Monitor"
    WHERE NOT ("query" ? 'sellerType')
      AND "sellerType" IS NOT NULL
      AND "sellerType" NOT IN ('private', 'company', 'bez-posrednikov')
  ) THEN
    RAISE EXCEPTION 'Unsupported legacy Monitor.sellerType value without canonical query sellerType';
  END IF;
END $$;

WITH "backfilledMonitors" AS (
  UPDATE "Monitor"
  SET "query" = jsonb_set(
    "query",
    '{sellerType}',
    to_jsonb(
      CASE "sellerType"
        WHEN 'bez-posrednikov' THEN 'private'
        ELSE "sellerType"
      END
    ),
    true
  )
  WHERE NOT ("query" ? 'sellerType')
    AND "sellerType" IN ('private', 'company', 'bez-posrednikov')
  RETURNING "id"
)
DELETE FROM "MonitorCursor"
WHERE "monitorId" IN (SELECT "id" FROM "backfilledMonitors");

ALTER TABLE "Monitor" DROP COLUMN "sellerType";
