#!/usr/bin/env bash
set -euo pipefail

export POSTGRES_USER="kufar_ci"
export POSTGRES_PASSWORD="kufar_ci_${GITHUB_RUN_ID:-local}"
export POSTGRES_DB="kufar_ci"
export POSTGRES_PORT="55432"
export COMPOSE_PROJECT_NAME="kufar_watcher_verify"

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup

docker compose up -d --wait

test "$(docker inspect --format='{{.State.Health.Status}}' kufar-watcher-postgres)" = "healthy"
test "$(docker inspect --format='{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}' kufar-watcher-postgres)" = "127.0.0.1"

docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE TABLE IF NOT EXISTS compose_persistence_check (value text PRIMARY KEY); INSERT INTO compose_persistence_check(value) VALUES ('persists') ON CONFLICT DO NOTHING;"

docker compose down

docker compose up -d --wait

persisted="$({ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT value FROM compose_persistence_check WHERE value = 'persists';"; } | tr -d '[:space:]')"
test "$persisted" = "persists"
