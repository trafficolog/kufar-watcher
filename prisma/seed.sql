BEGIN;

INSERT INTO "Monitor" (
  "id",
  "name",
  "sourceUrl",
  "query",
  "intervalSec",
  "keywords",
  "searchInDescription",
  "state"
)
VALUES
  (
    100001,
    'seed-monitor-electronics',
    'https://fixtures.invalid/search/electronics',
    '{"host":"fixtures.invalid","category":"electronics","query":null,"region":null,"sellerType":"private","sort":"lst.d","operation":null,"pathFilters":[],"extraParams":{}}'::jsonb,
    60,
    '["pixel","phone"]'::jsonb,
    true,
    'active'
  ),
  (
    100002,
    'seed-monitor-housing',
    'https://fixtures.invalid/search/housing',
    '{"host":"fixtures.invalid","category":"housing","query":null,"region":null,"sellerType":null,"sort":"lst.d","operation":null,"pathFilters":[],"extraParams":{}}'::jsonb,
    300,
    '["studio","balcony"]'::jsonb,
    false,
    'active'
  )
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "sourceUrl" = EXCLUDED."sourceUrl",
  "query" = EXCLUDED."query",
  "intervalSec" = EXCLUDED."intervalSec",
  "keywords" = EXCLUDED."keywords",
  "searchInDescription" = EXCLUDED."searchInDescription",
  "state" = EXCLUDED."state";

INSERT INTO "MonitorCursor" (
  "monitorId",
  "boundaryTime",
  "boundaryIds",
  "lastRunAt",
  "updatedAt"
)
VALUES
  (
    100001,
    '2026-01-15T10:30:00Z',
    '["seed-listing-electronics-2"]'::jsonb,
    '2026-01-15T10:31:00Z',
    '2026-01-15T10:31:00Z'
  ),
  (
    100002,
    '2026-01-15T09:00:00Z',
    '["seed-listing-housing-2"]'::jsonb,
    '2026-01-15T09:01:00Z',
    '2026-01-15T09:01:00Z'
  )
ON CONFLICT ("monitorId") DO UPDATE SET
  "boundaryTime" = EXCLUDED."boundaryTime",
  "boundaryIds" = EXCLUDED."boundaryIds",
  "lastRunAt" = EXCLUDED."lastRunAt",
  "updatedAt" = EXCLUDED."updatedAt";

INSERT INTO "Run" (
  "id",
  "monitorId",
  "startedAt",
  "finishedAt",
  "outcome",
  "httpStatus",
  "seen",
  "matched",
  "error",
  "degradedLevel"
)
VALUES
  (100101, 100001, '2026-01-15T10:30:00Z', '2026-01-15T10:31:00Z', 'success', 200, 3, 2, NULL, NULL),
  (100102, 100002, '2026-01-15T09:00:00Z', '2026-01-15T09:01:00Z', 'success', 200, 3, 2, NULL, NULL)
ON CONFLICT ("id") DO UPDATE SET
  "monitorId" = EXCLUDED."monitorId",
  "startedAt" = EXCLUDED."startedAt",
  "finishedAt" = EXCLUDED."finishedAt",
  "outcome" = EXCLUDED."outcome",
  "httpStatus" = EXCLUDED."httpStatus",
  "seen" = EXCLUDED."seen",
  "matched" = EXCLUDED."matched",
  "error" = EXCLUDED."error",
  "degradedLevel" = EXCLUDED."degradedLevel";

INSERT INTO "Listing" (
  "listId",
  "title",
  "priceKind",
  "priceAmount",
  "currency",
  "url",
  "region",
  "accountId",
  "isCompany",
  "listTime",
  "description",
  "raw",
  "firstSeenAt"
)
VALUES
  (
    'seed-listing-electronics-1',
    'Fixture phone 128 GB',
    'fixed',
    799.00,
    'BYN',
    'https://fixtures.invalid/listing/electronics-1',
    'Fixture City',
    'fixture-account-1',
    false,
    '2026-01-15T10:29:00Z',
    'Synthetic phone listing used only for local development.',
    '{"fixture":true,"kind":"electronics"}'::jsonb,
    '2026-01-15T10:30:00Z'
  ),
  (
    'seed-listing-electronics-2',
    'Fixture phone with warranty',
    'negotiable',
    NULL,
    'BYN',
    'https://fixtures.invalid/listing/electronics-2',
    'Fixture City',
    'fixture-account-2',
    true,
    '2026-01-15T10:30:00Z',
    'Synthetic listing with a negotiable price.',
    '{"fixture":true,"kind":"electronics"}'::jsonb,
    '2026-01-15T10:30:30Z'
  ),
  (
    'seed-listing-electronics-3',
    'Fixture tablet',
    'fixed',
    499.00,
    'BYN',
    'https://fixtures.invalid/listing/electronics-3',
    'Fixture Region',
    'fixture-account-3',
    false,
    '2026-01-15T10:20:00Z',
    'Synthetic non-matching electronics listing.',
    '{"fixture":true,"kind":"electronics"}'::jsonb,
    '2026-01-15T10:30:45Z'
  ),
  (
    'seed-listing-housing-1',
    'Fixture studio near park',
    'fixed',
    1450.00,
    'BYN',
    'https://fixtures.invalid/listing/housing-1',
    'Fixture District',
    'fixture-account-4',
    false,
    '2026-01-15T08:58:00Z',
    'Synthetic studio listing with balcony.',
    '{"fixture":true,"kind":"housing"}'::jsonb,
    '2026-01-15T09:00:10Z'
  ),
  (
    'seed-listing-housing-2',
    'Fixture compact studio',
    'fixed',
    1320.00,
    'BYN',
    'https://fixtures.invalid/listing/housing-2',
    'Fixture District',
    'fixture-account-5',
    true,
    '2026-01-15T09:00:00Z',
    'Synthetic housing listing at the cursor boundary.',
    '{"fixture":true,"kind":"housing"}'::jsonb,
    '2026-01-15T09:00:20Z'
  ),
  (
    'seed-listing-housing-3',
    'Fixture two-room apartment',
    'fixed',
    1800.00,
    'BYN',
    'https://fixtures.invalid/listing/housing-3',
    'Fixture Region',
    'fixture-account-6',
    false,
    '2026-01-15T08:45:00Z',
    'Synthetic non-matching housing listing.',
    '{"fixture":true,"kind":"housing"}'::jsonb,
    '2026-01-15T09:00:30Z'
  )
ON CONFLICT ("listId") DO UPDATE SET
  "title" = EXCLUDED."title",
  "priceKind" = EXCLUDED."priceKind",
  "priceAmount" = EXCLUDED."priceAmount",
  "currency" = EXCLUDED."currency",
  "url" = EXCLUDED."url",
  "region" = EXCLUDED."region",
  "accountId" = EXCLUDED."accountId",
  "isCompany" = EXCLUDED."isCompany",
  "listTime" = EXCLUDED."listTime",
  "description" = EXCLUDED."description",
  "raw" = EXCLUDED."raw",
  "firstSeenAt" = EXCLUDED."firstSeenAt";

INSERT INTO "Match" (
  "id",
  "monitorId",
  "listingId",
  "matchedTerms",
  "matchedIn",
  "snippet",
  "notifiedAt"
)
VALUES
  (
    100201,
    100001,
    'seed-listing-electronics-1',
    '["phone"]'::jsonb,
    '["title","description"]'::jsonb,
    'Fixture phone 128 GB',
    '2026-01-15T10:31:10Z'
  ),
  (
    100202,
    100001,
    'seed-listing-electronics-2',
    '["phone"]'::jsonb,
    '["title"]'::jsonb,
    'Fixture phone with warranty',
    NULL
  ),
  (
    100203,
    100002,
    'seed-listing-housing-1',
    '["studio","balcony"]'::jsonb,
    '["title","description"]'::jsonb,
    'Fixture studio near park',
    '2026-01-15T09:01:10Z'
  ),
  (
    100204,
    100002,
    'seed-listing-housing-2',
    '["studio"]'::jsonb,
    '["title"]'::jsonb,
    'Fixture compact studio',
    NULL
  )
ON CONFLICT ("monitorId", "listingId") DO UPDATE SET
  "matchedTerms" = EXCLUDED."matchedTerms",
  "matchedIn" = EXCLUDED."matchedIn",
  "snippet" = EXCLUDED."snippet",
  "notifiedAt" = EXCLUDED."notifiedAt";

INSERT INTO "Setting" ("key", "value")
VALUES
  ('seed.fixture.enabled', 'true'::jsonb),
  ('seed.fixture.profile', '{"name":"synthetic-dev","version":1}'::jsonb)
ON CONFLICT ("key") DO UPDATE SET
  "value" = EXCLUDED."value";

COMMIT;
