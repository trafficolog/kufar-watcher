import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function createLifecycleFixture(): string {
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

function createPartialEpicLifecycleFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kufar-docs-ops-'))
  roots.push(root)

  writeDoc(
    root,
    'docs/phases/1.md',
    `---
id: "1"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
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
last_reviewed: 2026-09-12
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
last_reviewed: 2026-09-12
depends_on: []
---

# Задача 1.1.1 — Done task
`,
  )
  writeDoc(
    root,
    'docs/tasks/1-1-2.md',
    `---
id: "1.1.2"
phase: 1
epic: "1.1"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
depends_on: []
---

# Задача 1.1.2 — Todo task
`,
  )

  const refresh = runCli(root, 'refresh')
  if (refresh.status !== 0) throw new Error(refresh.stderr || refresh.stdout)

  return root
}

function createPartialPhaseLifecycleFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kufar-docs-ops-'))
  roots.push(root)

  writeDoc(
    root,
    'docs/phases/1.md',
    `---
id: "1"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
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
status: done
sync_state: aligned
last_reviewed: 2026-09-12
---

# Эпик 1.1 — Done epic
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
last_reviewed: 2026-09-12
depends_on: []
---

# Задача 1.1.1 — Done task
`,
  )
  writeDoc(
    root,
    'docs/epics/1-2.md',
    `---
id: "1.2"
phase: 1
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
---

# Эпик 1.2 — Todo epic
`,
  )
  writeDoc(
    root,
    'docs/tasks/1-2-1.md',
    `---
id: "1.2.1"
phase: 1
epic: "1.2"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
depends_on: []
---

# Задача 1.2.1 — Todo task
`,
  )

  const refresh = runCli(root, 'refresh')
  if (refresh.status !== 0) throw new Error(refresh.stderr || refresh.stdout)

  return root
}

function createAllTodoLifecycleFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kufar-docs-ops-'))
  roots.push(root)

  writeDoc(
    root,
    'docs/phases/1.md',
    `---
id: "1"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
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
last_reviewed: 2026-09-12
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
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
depends_on: []
---

# Задача 1.1.1 — Todo task
`,
  )

  const refresh = runCli(root, 'refresh')
  if (refresh.status !== 0) throw new Error(refresh.stderr || refresh.stdout)

  return root
}

function createGeneratedFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kufar-docs-ops-'))
  roots.push(root)

  writeDoc(
    root,
    'docs/phases/1.md',
    `---
id: "1"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
---

# Фаза 1 — Fixture

<!-- docs:ops:begin phase-1-epics -->
placeholder
<!-- docs:ops:end phase-1-epics -->
`,
  )
  writeDoc(
    root,
    'docs/epics/1-1.md',
    `---
id: "1.1"
phase: 1
status: done
sync_state: aligned
last_reviewed: 2026-09-11
---

# Эпик 1.1 — Fixture epic

<!-- docs:ops:begin epic-1.1-tasks -->
placeholder
<!-- docs:ops:end epic-1.1-tasks -->
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
  mkdirSync(join(root, 'docs/operations/status'), { recursive: true })

  const refresh = runCli(root, 'refresh')
  if (refresh.status !== 0) throw new Error(refresh.stderr || refresh.stdout)

  return root
}

function createFreshnessFixture(): string {
  const root = createGeneratedFixture()
  const phasePath = join(root, 'docs/phases/1.md')
  writeFileSync(
    phasePath,
    readFileSync(phasePath, 'utf8').replace(
      '**Эпиков:** 1 · **done:** 1 · **в работе/план:** 0',
      '**Эпиков:** 1 · **done:** 0 · **в работе/план:** 1',
    ),
  )

  return root
}

function runCli(root: string, command: 'check' | 'refresh') {
  return spawnSync(TSX, [CLI, command], {
    cwd: root,
    encoding: 'utf8',
  })
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('docs-ops check', () => {
  it('rejects an epic left todo/drifted when every child task is done/aligned', () => {
    const result = runCli(createLifecycleFixture(), 'check')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('1-1.md: lifecycle не соответствует дочерним задачам')
  })

  it('rejects an epic left todo when child tasks show partial progress', () => {
    const result = runCli(createPartialEpicLifecycleFixture(), 'check')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('1-1.md: lifecycle не соответствует дочерним задачам')
  })

  it('rejects a phase left todo when child epics show partial progress', () => {
    const result = runCli(createPartialPhaseLifecycleFixture(), 'check')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('1.md: lifecycle не соответствует дочерним эпикам')
  })

  it('accepts todo parents when every direct child is still todo', () => {
    const result = runCli(createAllTodoLifecycleFixture(), 'check')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('check: OK')
  })

  it.each(['blocked', 'cancelled'])('accepts an epic explicitly marked %s', (status) => {
    const root = createPartialEpicLifecycleFixture()
    const epicPath = join(root, 'docs/epics/1-1.md')
    const phasePath = join(root, 'docs/phases/1.md')
    writeFileSync(epicPath, readFileSync(epicPath, 'utf8').replace('status: todo', `status: ${status}`))
    writeFileSync(
      phasePath,
      readFileSync(phasePath, 'utf8').replace('status: todo', 'status: in_progress'),
    )
    const refresh = runCli(root, 'refresh')
    if (refresh.status !== 0) throw new Error(refresh.stderr || refresh.stdout)

    const result = runCli(root, 'check')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('check: OK')
  })

  it.each(['blocked', 'cancelled'])('accepts a phase explicitly marked %s', (status) => {
    const root = createPartialPhaseLifecycleFixture()
    const phasePath = join(root, 'docs/phases/1.md')
    writeFileSync(
      phasePath,
      readFileSync(phasePath, 'utf8').replace('status: todo', `status: ${status}`),
    )
    const refresh = runCli(root, 'refresh')
    if (refresh.status !== 0) throw new Error(refresh.stderr || refresh.stdout)

    const result = runCli(root, 'check')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('check: OK')
  })

  it('rejects stale generated docs without mutating them', () => {
    const root = createFreshnessFixture()
    const phasePath = join(root, 'docs/phases/1.md')
    const statusPath = join(root, 'docs/operations/status/current-state.md')
    const phaseBefore = readFileSync(phasePath, 'utf8')
    const statusBefore = readFileSync(statusPath, 'utf8')

    const result = runCli(root, 'check')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("1.md: generated block 'phase-1-epics' устарел")
    expect(readFileSync(phasePath, 'utf8')).toBe(phaseBefore)
    expect(readFileSync(statusPath, 'utf8')).toBe(statusBefore)
  })

  it('rejects a stale generated status rollup without mutating it', () => {
    const root = createGeneratedFixture()
    const statusPath = join(root, 'docs/operations/status/current-state.md')
    writeFileSync(statusPath, readFileSync(statusPath, 'utf8').replace('- Задач: 1', '- Задач: 0'))
    const statusBefore = readFileSync(statusPath, 'utf8')

    const result = runCli(root, 'check')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'docs/operations/status/current-state.md: generated status устарел',
    )
    expect(readFileSync(statusPath, 'utf8')).toBe(statusBefore)
  })

  it('does not treat an older generation stamp as freshness drift by itself', () => {
    const root = createGeneratedFixture()
    const statusPath = join(root, 'docs/operations/status/current-state.md')
    writeFileSync(
      statusPath,
      readFileSync(statusPath, 'utf8').replace(
        /_Сгенерировано \d{4}-\d{2}-\d{2}_/,
        '_Сгенерировано 2000-01-01_',
      ),
    )
    const statusBefore = readFileSync(statusPath, 'utf8')

    const result = runCli(root, 'check')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('check: OK')
    expect(readFileSync(statusPath, 'utf8')).toBe(statusBefore)
  })
})
