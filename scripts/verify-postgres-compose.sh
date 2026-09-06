#!/usr/bin/env bash
set -euo pipefail

export POSTGRES_USER="kufar_ci"
export POSTGRES_PASSWORD="kufar_ci_${GITHUB_RUN_ID:-local}"
export POSTGRES_DB="kufar_ci"
export POSTGRES_PORT="55432"
export COMPOSE_PROJECT_NAME="kufar_watcher_verify"
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup

docker compose up -d --wait

test "$(docker inspect --format='{{.State.Health.Status}}' kufar-watcher-postgres)" = "healthy"
test "$(docker inspect --format='{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}' kufar-watcher-postgres)" = "127.0.0.1"

npm run db:migrate:deploy

model_count="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Monitor', 'MonitorCursor', 'Run', 'Listing', 'Match', 'Setting');"; } | tr -d '[:space:]')"
test "$model_count" = "6"

future_model_count="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('SellerBlock', 'Favorite', 'PriceSnapshot', 'HealthEvent', 'SchemaSnapshot', 'AdapterState');"; } | tr -d '[:space:]')"
test "$future_model_count" = "0"

migration_count="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;'; } | tr -d '[:space:]')"
test "$migration_count" = "2"

index_count="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('Run_monitorId_startedAt_idx', 'Listing_listTime_idx', 'Match_monitorId_listingId_key', 'Match_monitorId_notifiedAt_idx');"; } | tr -d '[:space:]')"
test "$index_count" = "4"

index_defs="$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('Run_monitorId_startedAt_idx', 'Listing_listTime_idx') ORDER BY indexname;")"
printf '%s\n' "$index_defs" | grep -Fq '("listTime" DESC)'
printf '%s\n' "$index_defs" | grep -Fq '("monitorId", "startedAt" DESC)'

docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
INSERT INTO "Monitor" ("id", "name", "sourceUrl", "query", "intervalSec", "keywords")
VALUES (9001, 'constraint-fixture', 'https://example.invalid/search', '{}'::jsonb, 60, '[]'::jsonb);

INSERT INTO "MonitorCursor" ("monitorId", "boundaryIds", "updatedAt")
VALUES (9001, '[]'::jsonb, CURRENT_TIMESTAMP);

INSERT INTO "Run" ("id", "monitorId")
VALUES (9001, 9001);

INSERT INTO "Listing" ("listId", "title", "priceKind", "url", "listTime", "raw")
VALUES ('fixture-listing', 'Fixture listing', 'fixed', 'https://example.invalid/listing', CURRENT_TIMESTAMP, '{}'::jsonb);

INSERT INTO "Match" ("id", "monitorId", "listingId", "matchedTerms", "matchedIn")
VALUES (9001, 9001, 'fixture-listing', '[]'::jsonb, '[]'::jsonb);
SQL

set +e
duplicate_output="$(docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "INSERT INTO \"Match\" (\"id\", \"monitorId\", \"listingId\", \"matchedTerms\", \"matchedIn\") VALUES (9002, 9001, 'fixture-listing', '[]'::jsonb, '[]'::jsonb);" 2>&1)"
duplicate_status=$?
set -e

test "$duplicate_status" -ne 0
printf '%s\n' "$duplicate_output" | grep -Fq 'Match_monitorId_listingId_key'

docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'DELETE FROM "Monitor" WHERE "id" = 9001;'

owned_row_count="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT (SELECT count(*) FROM "MonitorCursor" WHERE "monitorId" = 9001) + (SELECT count(*) FROM "Run" WHERE "monitorId" = 9001) + (SELECT count(*) FROM "Match" WHERE "monitorId" = 9001);'; } | tr -d '[:space:]')"
test "$owned_row_count" = "0"

listing_row_count="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM \"Listing\" WHERE \"listId\" = 'fixture-listing';"; } | tr -d '[:space:]')"
test "$listing_row_count" = "1"

docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE TABLE IF NOT EXISTS compose_persistence_check (value text PRIMARY KEY); INSERT INTO compose_persistence_check(value) VALUES ('persists') ON CONFLICT DO NOTHING;"

docker compose down

docker compose up -d --wait

persisted="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT value FROM compose_persistence_check WHERE value = 'persists';"; } | tr -d '[:space:]')"
test "$persisted" = "persists"
