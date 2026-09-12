DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Monitor"
    WHERE "query"->>'sellerType' IS NULL
      AND "sellerType" IS NOT NULL
      AND "sellerType" NOT IN ('private', 'company', 'bez-posrednikov')
  ) THEN
    RAISE EXCEPTION 'Unsupported legacy Monitor.sellerType value without canonical query sellerType';
  END IF;
END $$;

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
WHERE "query"->>'sellerType' IS NULL
  AND "sellerType" IN ('private', 'company', 'bez-posrednikov');

ALTER TABLE "Monitor" DROP COLUMN "sellerType";
