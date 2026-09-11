#!/usr/bin/env bash
set -euo pipefail

TEST_DB_PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

test_db_configure() {
  export POSTGRES_USER="${TEST_POSTGRES_USER:-kufar_ci}"
  export POSTGRES_PASSWORD="${TEST_POSTGRES_PASSWORD:-kufar_ci_${GITHUB_RUN_ID:-local}}"
  export POSTGRES_DB="${TEST_POSTGRES_DB:-kufar_ci}"
  export POSTGRES_PORT="${TEST_POSTGRES_PORT:-55432}"
  export COMPOSE_PROJECT_NAME="${TEST_COMPOSE_PROJECT_NAME:-kufar_watcher_verify}"
  export DATABASE_URL="$(
    cd "$TEST_DB_PROJECT_ROOT"
    ./node_modules/.bin/tsx -e "
      import { createPostgresDatabaseUrl } from './shared/postgres-url.ts'
      process.stdout.write(
        createPostgresDatabaseUrl({
          host: '127.0.0.1',
          port: Number(process.env.POSTGRES_PORT),
          user: process.env.POSTGRES_USER ?? '',
          password: process.env.POSTGRES_PASSWORD ?? '',
          database: process.env.POSTGRES_DB ?? '',
        }),
      )
    "
  )"
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
