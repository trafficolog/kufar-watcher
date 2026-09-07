#!/usr/bin/env bash
set -euo pipefail

TASK_FILE="docs/tasks/0-4-2-ci.md"
TEMP_TEST="tests/.ci-intentional-failure.test.ts"
TASK_BACKUP="$(mktemp)"
DOCS_LOG="$(mktemp)"
TEST_LOG="$(mktemp)"

cp "$TASK_FILE" "$TASK_BACKUP"

cleanup() {
  cp "$TASK_BACKUP" "$TASK_FILE"
  rm -f "$TASK_BACKUP" "$DOCS_LOG" "$TEST_LOG" "$TEMP_TEST"
}
trap cleanup EXIT

sed -i -E '0,/^status: .*/s//status: ci_intentional_failure/' "$TASK_FILE"

set +e
npm run docs:ops:check 2>&1 | tee "$DOCS_LOG"
docs_status=${PIPESTATUS[0]}
set -e

test "$docs_status" -ne 0
grep -Fq "неверный status 'ci_intentional_failure'" "$DOCS_LOG"

cp "$TASK_BACKUP" "$TASK_FILE"

cat > "$TEMP_TEST" <<'TEST'
import { expect, it } from 'vitest'

it('intentional red test proves CI blocks failures', () => {
  expect('red').toBe('green')
})
TEST

set +e
npx vitest run tests/.ci-intentional-failure.test.ts 2>&1 | tee "$TEST_LOG"
test_status=${PIPESTATUS[0]}
set -e

test "$test_status" -ne 0
grep -Fq 'intentional red test proves CI blocks failures' "$TEST_LOG"

rm -f "$TEMP_TEST"

echo 'CI failure modes verified'
