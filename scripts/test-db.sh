#!/usr/bin/env bash
set -euo pipefail

test_db_configure() {
  export POSTGRES_USER="${TEST_POSTGRES_USER:-kufar_ci}"
  export POSTGRES_PASSWORD="${TEST_POSTGRES_PASSWORD:-kufar_ci_${GITHUB_RUN_ID:-local}}"
  export POSTGRES_DB="${TEST_POSTGRES_DB:-kufar_ci}"
  export POSTGRES_PORT="${TEST_POSTGRES_PORT:-55432}"
  export COMPOSE_PROJECT_NAME="${TEST_COMPOSE_PROJECT_NAME:-kufar_watcher_verify}"
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"
}

test_db_cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}

test_db_start_clean() {
  test_db_configure
  trap test_db_cleanup EXIT
  test_db_cleanup
  docker compose up -d --wait
  npm run db:migrate:deploy
  npm run db:seed
}
