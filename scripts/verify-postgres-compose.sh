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
test "$migration_count" = "1"

docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE TABLE IF NOT EXISTS compose_persistence_check (value text PRIMARY KEY); INSERT INTO compose_persistence_check(value) VALUES ('persists') ON CONFLICT DO NOTHING;"

docker compose down

docker compose up -d --wait

persisted="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT value FROM compose_persistence_check WHERE value = 'persists';"; } | tr -d '[:space:]')"
test "$persisted" = "persists"
