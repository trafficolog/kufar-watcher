import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

const CLI = fileURLToPath(new URL('../../src/docs-ops/cli.ts', import.meta.url))
const TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url))
const roots: string[] = []

function writeDoc(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kufar-docs-ops-'))
  roots.push(root)

  writeDoc(
    root,
    'docs/phases/1.md',
    `---
id: "1"
status: todo
sync_state: drifted
last_reviewed: 2026-09-11
---

# Фаза 1 — Fixture
`,
  )
  writeDoc(
    root,
    'docs/epics/1-1.md',
    `---
id: "1.1"
phase: 1
status: todo
sync_state: drifted
last_reviewed: 2026-09-11
---

# Эпик 1.1 — Fixture epic
`,
  )
  writeDoc(
    root,
    'docs/tasks/1-1-1.md',
    `---
id: "1.1.1"
phase: 1
epic: "1.1"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
depends_on: []
---

# Задача 1.1.1 — Fixture task
`,
  )

  return root
}

function runCheck(root: string) {
  return spawnSync(TSX, [CLI, 'check'], {
    cwd: root,
    encoding: 'utf8',
  })
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('docs-ops check', () => {
  it('rejects an epic left todo/drifted when every child task is done/aligned', () => {
    const result = runCheck(createFixture())

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("1-1.md: lifecycle не соответствует дочерним задачам")
  })
})
