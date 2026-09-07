# 1.2.3 Raw Response Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded local raw-response journal for successful Kufar HTTP responses, with exact-byte fixture export and platform-correct storage configuration.

**Architecture:** Add a focused filesystem journal in the worker layer, inject it into `KufarHttpClient` only as an optional success-side diagnostic dependency, and have the Electron main process resolve the journal root from `app.getPath('userData')` before passing it to the utility worker. Keep persistence independent from network retry policy and do not create a scheduler/traversal solely to own the journal.

**Tech Stack:** TypeScript 6, Node `>=22 <23` built-ins (`node:fs/promises`, `node:path`, `node:crypto`), Electron 44 utility process, Vitest 5, npm 11.4.2.

**Spec:** `docs/superpowers/specs/2026-09-08-1-2-3-raw-response-journal-design.md`

## Global Constraints

- Store only successful `2xx` raw response bodies.
- Preserve response body bytes exactly; do not parse, normalize, or pretty-print before storage.
- Endpoint identity is `URL.host + URL.pathname`; query and fragment do not create separate retention buckets.
- Production retention is exactly `5` snapshots per endpoint.
- Store snapshot envelopes in a hashed endpoint directory using SHA-256.
- Export decodes stored `bodyBase64` and writes exact original bytes to the caller-provided destination.
- A journal write failure must not turn a successful HTTP result into failure and must not trigger HTTP retry.
- The main process resolves the journal root from Electron `app.getPath('userData')`; the worker never reconstructs OS-specific user-data paths.
- Do not add Prisma schema, migrations, runtime dependencies, schema comparison, scheduler/traversal, renderer IPC, save dialogs, compression, or cloud upload.
- Automated tests use temporary directories and injected transports; never call live Kufar endpoints.
- Preserve RED and GREEN as separate commits for each behavior slice.
- Require exact-SHA GitHub Actions evidence before marking the task done.

---

## File Map

- `electron/worker/kufar-raw-response-journal.ts` — filesystem journal, endpoint identity, retention, envelope validation, export.
- `tests/unit/kufar-raw-response-journal.test.ts` — persistence, retention, restart/list, corruption, export tests.
- `electron/worker/kufar-http-client.ts` — optional journal dependency and safe warning hook on successful `2xx`.
- `tests/unit/kufar-http-client.test.ts` — success journaling, no journaling on failure, journal-error isolation.
- `shared/worker-config.ts` — shared utility-process argument prefix.
- `electron/main/worker-storage.ts` — derive the journal directory and serialize the worker argument.
- `electron/worker/config.ts` — parse the worker journal argument.
- `tests/worker-storage-config.test.ts` — pure path/argument contract.
- `tests/worker-storage-wiring-contract.test.ts` — source-level proof that main uses Electron `userData` for the worker argument.
- `electron/main/index.ts` — pass the journal argument when forking the utility worker.
- `electron/worker/index.ts` — parse/validate the startup argument without constructing an idle HTTP client.
- `docs/tasks/1-2-3-raw-log.md` and generated rollups — mark task/epic aligned after verification.

---

### Task 1: Implement the bounded filesystem journal

**Files:**
- Create: `tests/unit/kufar-raw-response-journal.test.ts`
- Create: `electron/worker/kufar-raw-response-journal.ts`

**Interfaces:**

```ts
export interface KufarRawResponseSnapshotInput {
  requestUrl: string | URL
  status: number
  body: Uint8Array
}

export interface KufarRawResponseSnapshot {
  version: 1
  id: string
  endpoint: string
  requestUrl: string
  status: number
  capturedAt: string
  bodyBase64: string
}

export interface KufarRawResponseJournal {
  record(input: KufarRawResponseSnapshotInput): Promise<KufarRawResponseSnapshot>
  list(endpoint: string | URL): Promise<KufarRawResponseSnapshot[]>
  exportSnapshot(endpoint: string | URL, id: string, destination: string): Promise<void>
}

export interface FileKufarRawResponseJournalOptions {
  rootDir: string
  retention?: number
  now?: () => Date
  createId?: () => string
}

export class FileKufarRawResponseJournal implements KufarRawResponseJournal
```

- [ ] **Step 1: Write RED tests for record/list and endpoint identity**

Create a temp-directory fixture with deterministic time/IDs:

```ts
let rootDir: string
let currentTime = new Date('2026-09-08T10:15:30.000Z')
let nextId = 'snapshot-1'

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'kufar-raw-journal-'))
})

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true })
})

function createJournal(retention = 5): FileKufarRawResponseJournal {
  return new FileKufarRawResponseJournal({
    rootDir,
    retention,
    now: () => currentTime,
    createId: () => nextId,
  })
}
```

Required RED cases:

```ts
it('records exact body bytes in a versioned envelope', async () => {
  const body = new TextEncoder().encode('{"items":[1]}\n')
  const journal = createJournal()

  const snapshot = await journal.record({
    requestUrl: 'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040',
    status: 200,
    body,
  })

  expect(snapshot).toEqual({
    version: 1,
    id: 'snapshot-1',
    endpoint: 'api.kufar.by/search-api/v2/search/rendered-paginated',
    requestUrl: 'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040',
    status: 200,
    capturedAt: '2026-09-08T10:15:30.000Z',
    bodyBase64: Buffer.from(body).toString('base64'),
  })
  await expect(journal.list(snapshot.endpoint)).resolves.toEqual([snapshot])
})

it('maps different query strings to the same endpoint bucket', async () => {
  const journal = createJournal()
  await journal.record({
    requestUrl: 'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040',
    status: 200,
    body: Uint8Array.of(1),
  })
  nextId = 'snapshot-2'
  currentTime = new Date('2026-09-08T10:15:31.000Z')
  await journal.record({
    requestUrl: 'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=1010',
    status: 200,
    body: Uint8Array.of(2),
  })

  const snapshots = await journal.list(
    'https://api.kufar.by/search-api/v2/search/rendered-paginated?anything=else',
  )
  expect(snapshots.map((item) => item.id)).toEqual(['snapshot-1', 'snapshot-2'])
})
```

- [ ] **Step 2: Run focused test and prove RED**

```bash
npm test -- tests/unit/kufar-raw-response-journal.test.ts
```

Expected: FAIL with module-not-found for `electron/worker/kufar-raw-response-journal.ts`.

- [ ] **Step 3: Commit RED only**

```bash
git add tests/unit/kufar-raw-response-journal.test.ts
git commit -m "test(1.2.3): specify raw response journal"
```

- [ ] **Step 4: Implement endpoint identity plus record/list**

Start with:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SNAPSHOT_VERSION = 1 as const
const DEFAULT_RETENTION = 5
const SNAPSHOT_FILE_PATTERN = /^\d{16}-.+\.snapshot\.json$/

export function kufarEndpointIdentity(input: string | URL): string {
  const url = typeof input === 'string' ? new URL(input) : input
  return `${url.host}${url.pathname}`
}

function endpointDirectoryName(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex')
}
```

`record()` creates the hashed endpoint directory, writes `JSON.stringify(snapshot)`, then applies retention. `list()` reads only journal-owned filenames, parses JSON, validates the exact envelope fields, sorts by `capturedAt`, and returns snapshots.

Filename format:

```ts
private snapshotFilename(capturedAt: Date, id: string): string {
  const timestamp = String(capturedAt.getTime()).padStart(16, '0')
  return `${timestamp}-${id}.snapshot.json`
}
```

Validate `retention` as a positive integer in the constructor.

- [ ] **Step 5: Add RED tests for retention, restart, export, and corruption**

```ts
it('retains only the newest five snapshots per endpoint', async () => {
  const journal = createJournal(5)
  for (let index = 0; index < 6; index += 1) {
    nextId = `snapshot-${index}`
    currentTime = new Date(Date.UTC(2026, 8, 8, 10, 15, 30 + index))
    await journal.record({ requestUrl, status: 200, body: Uint8Array.of(index) })
  }

  expect((await journal.list(requestUrl)).map((item) => item.id)).toEqual([
    'snapshot-1',
    'snapshot-2',
    'snapshot-3',
    'snapshot-4',
    'snapshot-5',
  ])
})

it('keeps retention independent for different endpoint paths', async () => {
  const journal = createJournal(2)
  // write three snapshots to /rendered-paginated and one to /details
  // then assert IDs [a2, a3] for the first and [b1] for the second
})

it('lists snapshots written by a previous journal instance', async () => {
  await createJournal().record({ requestUrl, status: 200, body: Uint8Array.of(1) })
  const restarted = new FileKufarRawResponseJournal({ rootDir })
  await expect(restarted.list(requestUrl)).resolves.toHaveLength(1)
})

it('exports exact original response bytes', async () => {
  const original = Uint8Array.from([0x7b, 0x0a, 0x20, 0x7d, 0x0a])
  const snapshot = await createJournal().record({ requestUrl, status: 200, body: original })
  const destination = join(rootDir, 'fixture.json')
  await createJournal().exportSnapshot(requestUrl, snapshot.id, destination)
  expect(new Uint8Array(await readFile(destination))).toEqual(original)
})

it('rejects export of an unknown snapshot id', async () => {
  await expect(
    createJournal().exportSnapshot(requestUrl, 'missing', join(rootDir, 'fixture.json')),
  ).rejects.toThrow(/snapshot.*missing/i)
})
```

For the independent-retention test, use concrete IDs `a1`, `a2`, `a3`, `b1` and timestamps one second apart; assert first endpoint returns `['a2', 'a3']` and second returns `['b1']`.

For corruption, create the hashed endpoint directory through one valid `record()`, overwrite that envelope file with `{broken`, and assert `list()` rejects with `/invalid raw response snapshot/i`.

- [ ] **Step 6: Prove the new tests RED**

Run the same focused test. Expected: record/list cases are GREEN; retention/export/corruption cases fail until the full implementation is present.

- [ ] **Step 7: Implement retention, validation, and export**

Retention must only delete files matching `SNAPSHOT_FILE_PATTERN`:

```ts
private async enforceRetention(endpointDir: string): Promise<void> {
  const filenames = (await readdir(endpointDir))
    .filter((name) => SNAPSHOT_FILE_PATTERN.test(name))
    .sort()
  const excess = filenames.slice(0, Math.max(0, filenames.length - this.retention))
  await Promise.all(excess.map((name) => unlink(join(endpointDir, name))))
}
```

Export:

```ts
async exportSnapshot(endpoint: string | URL, id: string, destination: string): Promise<void> {
  const snapshot = (await this.list(endpoint)).find((item) => item.id === id)
  if (!snapshot) throw new Error(`Raw response snapshot ${id} was not found`)
  await writeFile(destination, Buffer.from(snapshot.bodyBase64, 'base64'))
}
```

Do not create destination parent directories automatically.

- [ ] **Step 8: Prove Task 1 GREEN and commit**

```bash
npm test -- tests/unit/kufar-raw-response-journal.test.ts
npm run typecheck:electron
npm run lint
npm run format:check
git add electron/worker/kufar-raw-response-journal.ts tests/unit/kufar-raw-response-journal.test.ts
git commit -m "feat(1.2.3): add bounded raw response journal"
```

Require branch CI GREEN on the exact GREEN SHA before Task 2.

---

### Task 2: Journal successful HTTP results without changing HTTP policy

**Files:**
- Modify: `tests/unit/kufar-http-client.test.ts`
- Modify: `electron/worker/kufar-http-client.ts`

**Consumed interface:** `Pick<KufarRawResponseJournal, 'record'>`.

**New options added to the existing `KufarHttpClientOptions`:**

```ts
journal?: Pick<KufarRawResponseJournal, 'record'>
onJournalWarning?: (message: string) => void
```

- [ ] **Step 1: Add RED success and non-success journal tests**

Use a deterministic record mock that returns a complete snapshot:

```ts
const journalRecord = vi.fn(async () => ({
  version: 1 as const,
  id: 'snapshot-1',
  endpoint: 'api.kufar.by/search-api/v2/search/rendered-paginated',
  requestUrl,
  status: 200,
  capturedAt: '2026-09-08T10:15:30.000Z',
  bodyBase64: Buffer.from(responseBody).toString('base64'),
}))
```

Successful response assertion:

```ts
const result = await client.get(requestUrl)
expect(result).toMatchObject({ ok: true, status: 200, attempts: 1 })
expect(journalRecord).toHaveBeenCalledTimes(1)
expect(journalRecord).toHaveBeenCalledWith({
  requestUrl: new URL(requestUrl),
  status: 200,
  body: responseBody,
})
```

Add one table-driven test with cases `302`, `404`, `429`, and `503` (with `maxAttempts: 1`) that asserts `journalRecord` is never called. Add a network-error case with `maxAttempts: 1` and the same assertion.

- [ ] **Step 2: Prove RED and commit tests**

```bash
npm test -- tests/unit/kufar-http-client.test.ts
git add tests/unit/kufar-http-client.test.ts
git commit -m "test(1.2.3): specify HTTP response journaling"
```

Expected: FAIL because the client has no journal option or success-side record call.

- [ ] **Step 3: Implement success-only journaling**

Import only the journal type:

```ts
import type { KufarRawResponseJournal } from './kufar-raw-response-journal'
```

Add fields and constructor assignment:

```ts
private readonly journal?: Pick<KufarRawResponseJournal, 'record'>
private readonly onJournalWarning: (message: string) => void

this.journal = options.journal
this.onJournalWarning = options.onJournalWarning ?? (() => undefined)
```

Inside the existing `2xx` branch before returning:

```ts
if (this.journal) {
  try {
    await this.journal.record({
      requestUrl: request.url,
      status: response.status,
      body: response.body,
    })
  } catch {
    this.onJournalWarning('Raw response snapshot could not be stored')
  }
}
```

Do not modify retry counters, rate-limit handling, status classification, or transport lifecycle.

- [ ] **Step 4: Add RED journal-error isolation test**

```ts
it('keeps a successful HTTP result when journaling fails', async () => {
  const warnings: string[] = []
  const journal = {
    record: vi.fn(async () => {
      throw new Error('disk full: raw payload must not leak')
    }),
  }
  const client = createClient({
    journal,
    onJournalWarning: (message) => warnings.push(message),
  })

  const result = await client.get(requestUrl)

  expect(result).toMatchObject({ ok: true, status: 200, attempts: 1 })
  expect(warnings).toEqual(['Raw response snapshot could not be stored'])
  expect(retrySleep).not.toHaveBeenCalled()
})
```

- [ ] **Step 5: Prove Task 2 GREEN and commit**

```bash
npm test -- tests/unit/kufar-http-client.test.ts tests/unit/kufar-raw-response-journal.test.ts
npm run typecheck:electron
npm run lint
npm run format:check
git add electron/worker/kufar-http-client.ts tests/unit/kufar-http-client.test.ts
git commit -m "feat(1.2.3): journal successful HTTP responses"
```

Require full exact-SHA branch CI GREEN before Task 3.

---

### Task 3: Pass platform-correct journal storage configuration to the worker

**Files:**
- Create: `shared/worker-config.ts`
- Create: `electron/main/worker-storage.ts`
- Create: `electron/worker/config.ts`
- Create: `tests/worker-storage-config.test.ts`
- Create: `tests/worker-storage-wiring-contract.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/worker/index.ts`
- Existing verification: `tests/worker-runtime.test.ts`

**Interfaces:**

```ts
export const RAW_RESPONSE_JOURNAL_ARG = '--raw-response-journal-dir='

export function rawResponseJournalDir(userDataDir: string): string
export function rawResponseJournalArg(userDataDir: string): string

export interface WorkerConfig {
  rawResponseJournalDir: string
}

export function readWorkerConfig(argv: readonly string[]): WorkerConfig
```

- [ ] **Step 1: Add RED pure configuration tests**

```ts
it('derives the journal directory from the supplied Electron userData path', () => {
  expect(rawResponseJournalDir('/profile/Kufar Monitor')).toBe(
    join('/profile/Kufar Monitor', 'raw-responses'),
  )
})

it('serializes and parses the worker journal argument', () => {
  const argument = rawResponseJournalArg('/profile/Kufar Monitor')
  expect(readWorkerConfig(['electron', 'worker.js', argument])).toEqual({
    rawResponseJournalDir: join('/profile/Kufar Monitor', 'raw-responses'),
  })
})

it('rejects startup when the journal argument is missing', () => {
  expect(() => readWorkerConfig(['electron', 'worker.js'])).toThrow(/raw response journal/i)
})
```

Use `join()` in expectations to remain portable across Windows/Linux.

- [ ] **Step 2: Add RED source-wiring contract test**

`tests/worker-storage-wiring-contract.test.ts` reads `electron/main/index.ts` as text and asserts all three contractual pieces exist:

```ts
expect(source).toContain("app.getPath('userData')")
expect(source).toContain('rawResponseJournalArg')
expect(source).toMatch(/utilityProcess\.fork\(workerPath,\s*\[workerJournalArg\]/s)
```

This is intentionally narrow; do not mock Electron just to test one wiring expression.

- [ ] **Step 3: Prove RED and commit tests**

```bash
npm test -- tests/worker-storage-config.test.ts tests/worker-storage-wiring-contract.test.ts
git add tests/worker-storage-config.test.ts tests/worker-storage-wiring-contract.test.ts
git commit -m "test(1.2.3): specify worker journal storage config"
```

Expected: FAIL because the helpers/constants and main wiring do not exist.

- [ ] **Step 4: Implement the shared prefix and pure helpers**

`shared/worker-config.ts`:

```ts
export const RAW_RESPONSE_JOURNAL_ARG = '--raw-response-journal-dir='
```

`electron/main/worker-storage.ts`:

```ts
import { join } from 'node:path'
import { RAW_RESPONSE_JOURNAL_ARG } from '../../shared/worker-config'

export function rawResponseJournalDir(userDataDir: string): string {
  return join(userDataDir, 'raw-responses')
}

export function rawResponseJournalArg(userDataDir: string): string {
  return `${RAW_RESPONSE_JOURNAL_ARG}${rawResponseJournalDir(userDataDir)}`
}
```

`electron/worker/config.ts`:

```ts
import { RAW_RESPONSE_JOURNAL_ARG } from '../../shared/worker-config'

export interface WorkerConfig {
  rawResponseJournalDir: string
}

export function readWorkerConfig(argv: readonly string[]): WorkerConfig {
  const argument = argv.find((value) => value.startsWith(RAW_RESPONSE_JOURNAL_ARG))
  const rawResponseJournalDir = argument?.slice(RAW_RESPONSE_JOURNAL_ARG.length)
  if (!rawResponseJournalDir) {
    throw new Error('Utility worker requires a raw response journal directory')
  }
  return { rawResponseJournalDir }
}
```

- [ ] **Step 5: Wire main spawn and worker startup**

In `electron/main/index.ts`, import `rawResponseJournalArg`, then immediately before supervisor creation:

```ts
const workerJournalArg = rawResponseJournalArg(app.getPath('userData'))
```

Change spawn to:

```ts
utilityProcess.fork(workerPath, [workerJournalArg], {
  serviceName: 'Kufar Monitor Worker',
})
```

In `electron/worker/index.ts`, import and execute:

```ts
const workerConfig = readWorkerConfig(process.argv)
void workerConfig.rawResponseJournalDir
```

Add one comment explaining that traversal ownership will consume the parsed directory when traversal is introduced; do not construct an idle `KufarHttpClient`/Agent.

- [ ] **Step 6: Prove Task 3 GREEN and commit**

```bash
npm test -- tests/worker-storage-config.test.ts tests/worker-storage-wiring-contract.test.ts tests/worker-runtime.test.ts
npm run typecheck:electron
npm run lint
npm run format:check
git add shared/worker-config.ts electron/main/worker-storage.ts electron/worker/config.ts electron/main/index.ts electron/worker/index.ts tests/worker-storage-config.test.ts tests/worker-storage-wiring-contract.test.ts
git commit -m "feat(1.2.3): configure worker raw journal storage"
```

Require full branch CI GREEN on the exact SHA.

---

### Task 4: Align task/epic docs and perform final verification

**Files:**
- Modify: `docs/tasks/1-2-3-raw-log.md`
- Generated modify: `docs/epics/1-2-http-client.md`
- Generated modify: `docs/phases/1-kufar-core.md` when generator output changes.
- Generated modify: `docs/operations/status/tasks.md`
- Generated modify: `docs/operations/status/drift-report.md`

- [ ] **Step 1: Update the task source card**

Set:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-08
```

Mark all three acceptance checkboxes complete. Add an implementation note stating:

- successful `2xx` bodies are stored in a five-snapshot filesystem journal per endpoint;
- endpoint identity excludes query strings;
- fixture export reproduces exact response bytes;
- filesystem journal failure does not alter HTTP success/retry semantics;
- schema comparison remains epic `4.1`;
- traversal ownership is not invented in this task.

- [ ] **Step 2: Refresh generated docs**

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: epic `1.2` shows all `3/3` child tasks done and becomes aligned according to generator rules.

- [ ] **Step 3: Run focused tests**

```bash
npm test -- tests/unit/kufar-raw-response-journal.test.ts tests/unit/kufar-http-client.test.ts tests/worker-storage-config.test.ts tests/worker-storage-wiring-contract.test.ts tests/worker-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run complete verification**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run docs:ops:check
```

Then require the repository's full GitHub Actions `verify` workflow to pass on the exact final SHA, including Postgres integration, build output verification, development launch smoke, and production launch smoke.

- [ ] **Step 5: Scope review**

Compare final branch with `main` and confirm there are no changes to:

- `prisma/schema.prisma` or migrations;
- fallback/degradation code;
- scheduler/traversal implementation;
- schema-drift comparison logic;
- renderer IPC/save-dialog code;
- package dependencies.

- [ ] **Step 6: Commit docs**

```bash
git add docs/tasks/1-2-3-raw-log.md docs/epics docs/phases docs/operations/status
git commit -m "docs(1.2.3): mark raw response journal done"
```

After final exact-SHA workflow success, use a normal merge commit rather than squash/rebase so RED -> GREEN history remains visible.
