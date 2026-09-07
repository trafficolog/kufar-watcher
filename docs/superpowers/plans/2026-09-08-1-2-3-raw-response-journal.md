# 1.2.3 Raw Response Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded local raw-response journal for successful Kufar HTTP responses, with exact-byte fixture export and platform-correct storage configuration.

**Architecture:** Add a focused filesystem journal in the worker layer, inject it into `KufarHttpClient` only as an optional success-side diagnostic dependency, and have the Electron main process resolve the journal root from `app.getPath('userData')` before passing it to the utility worker. Keep persistence independent from network retry policy and do not create a scheduler/traversal solely to own the journal.

**Tech Stack:** TypeScript 6, Node `>=22 <23` built-in `node:fs/promises`, `node:path`, `node:crypto`, Electron 44 utility process, Vitest 5, npm 11.4.2.

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
- `electron/main/worker-storage.ts` — pure helper deriving the application journal directory and utility-process argument.
- `electron/worker/config.ts` — pure parser for the worker journal argument.
- `tests/worker-storage-config.test.ts` — cross-process path/argument contract without importing Electron runtime.
- `electron/main/index.ts` — use `app.getPath('userData')` and pass the generated worker argument.
- `electron/worker/index.ts` — validate/parse worker startup configuration without constructing an idle HTTP client.
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

Create `tests/unit/kufar-raw-response-journal.test.ts` using `mkdtemp`, `readFile`, `readdir`, `rm`, and `tmpdir` from Node. Use a helper that constructs the journal with deterministic `now` and `createId`.

Core expectations:

```ts
it('records exact body bytes in a versioned envelope', async () => {
  const journal = createJournal(rootDir, {
    now: () => new Date('2026-09-08T10:15:30.000Z'),
    createId: () => 'snapshot-1',
  })
  const body = new TextEncoder().encode('{"items":[1]}\n')

  const snapshot = await journal.record({
    requestUrl: 'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040',
    status: 200,
    body,
  })

  expect(snapshot).toMatchObject({
    version: 1,
    id: 'snapshot-1',
    endpoint: 'api.kufar.by/search-api/v2/search/rendered-paginated',
    status: 200,
    capturedAt: '2026-09-08T10:15:30.000Z',
    bodyBase64: Buffer.from(body).toString('base64'),
  })
  await expect(journal.list(snapshot.endpoint)).resolves.toEqual([snapshot])
})

it('maps different query strings to the same endpoint bucket', async () => {
  await journal.record({ requestUrl: urlA, status: 200, body: bodyA })
  await journal.record({ requestUrl: urlB, status: 200, body: bodyB })

  const snapshots = await journal.list(urlA)
  expect(snapshots).toHaveLength(2)
  expect(snapshots.map((item) => item.endpoint)).toEqual([
    'api.kufar.by/search-api/v2/search/rendered-paginated',
    'api.kufar.by/search-api/v2/search/rendered-paginated',
  ])
})
```

- [ ] **Step 2: Run focused test and prove RED**

```bash
npm test -- tests/unit/kufar-raw-response-journal.test.ts
```

Expected: FAIL because `electron/worker/kufar-raw-response-journal.ts` does not exist.

- [ ] **Step 3: Commit RED only**

```bash
git add tests/unit/kufar-raw-response-journal.test.ts
git commit -m "test(1.2.3): specify raw response journal"
```

- [ ] **Step 4: Implement endpoint identity and record/list minimally**

Use only built-ins:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
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

Create filenames with a zero-padded millisecond timestamp and ID:

```ts
private snapshotFilename(capturedAt: Date, id: string): string {
  const timestamp = String(capturedAt.getTime()).padStart(16, '0')
  return `${timestamp}-${id}.snapshot.json`
}
```

`record()` must call `mkdir(endpointDir, { recursive: true })`, write `JSON.stringify(snapshot)`, then call the retention helper. `list()` reads only files matching `SNAPSHOT_FILE_PATTERN`, validates each envelope shape, sorts ascending by `capturedAt`, and returns them.

- [ ] **Step 5: Add RED retention/restart/export tests**

Add tests that:

```ts
it('retains only the newest five snapshots per endpoint', async () => {
  for (let index = 0; index < 6; index += 1) {
    clock.set(index)
    ids.set(`snapshot-${index}`)
    await journal.record({ requestUrl, status: 200, body: body(index) })
  }

  const snapshots = await journal.list(requestUrl)
  expect(snapshots.map((item) => item.id)).toEqual([
    'snapshot-1',
    'snapshot-2',
    'snapshot-3',
    'snapshot-4',
    'snapshot-5',
  ])
})

it('keeps endpoint retention independent', async () => {
  // six writes to endpoint A and two to endpoint B
  expect(await journal.list(endpointA)).toHaveLength(5)
  expect(await journal.list(endpointB)).toHaveLength(2)
})

it('lists snapshots written by a previous journal instance', async () => {
  await first.record(input)
  const second = new FileKufarRawResponseJournal({ rootDir })
  await expect(second.list(input.requestUrl)).resolves.toHaveLength(1)
})

it('exports exact original response bytes', async () => {
  const original = Uint8Array.from([0x7b, 0x0a, 0x20, 0x7d, 0x0a])
  const snapshot = await journal.record({ requestUrl, status: 200, body: original })
  await journal.exportSnapshot(requestUrl, snapshot.id, destination)
  expect(new Uint8Array(await readFile(destination))).toEqual(original)
})

it('rejects export of an unknown snapshot id', async () => {
  await expect(journal.exportSnapshot(requestUrl, 'missing', destination)).rejects.toThrow(
    /snapshot.*missing/i,
  )
})
```

- [ ] **Step 6: Prove these new tests RED**

Run the focused file again. Expected: initial record/list tests pass; retention/export tests fail because those behaviors are not yet implemented.

- [ ] **Step 7: Implement retention, validation, and export**

Retention:

```ts
private async enforceRetention(endpointDir: string): Promise<void> {
  const filenames = (await readdir(endpointDir))
    .filter((name) => SNAPSHOT_FILE_PATTERN.test(name))
    .sort()

  const excess = filenames.slice(0, Math.max(0, filenames.length - this.retention))
  await Promise.all(excess.map((name) => unlink(join(endpointDir, name))))
}
```

Validate stored JSON with explicit field checks before returning it from `list`. Do not silently coerce malformed envelopes.

Export:

```ts
async exportSnapshot(endpoint: string | URL, id: string, destination: string): Promise<void> {
  const snapshot = (await this.list(endpoint)).find((item) => item.id === id)
  if (!snapshot) throw new Error(`Raw response snapshot ${id} was not found`)
  await writeFile(destination, Buffer.from(snapshot.bodyBase64, 'base64'))
}
```

Do not create destination parent directories automatically; the caller owns the export destination.

- [ ] **Step 8: Prove Task 1 GREEN and commit**

```bash
npm test -- tests/unit/kufar-raw-response-journal.test.ts
npm run typecheck:electron
npm run lint
npm run format:check
git add electron/worker/kufar-raw-response-journal.ts tests/unit/kufar-raw-response-journal.test.ts
git commit -m "feat(1.2.3): add bounded raw response journal"
```

Require branch CI GREEN on the exact commit before Task 2.

---

### Task 2: Journal successful HTTP results without changing HTTP policy

**Files:**
- Modify: `tests/unit/kufar-http-client.test.ts`
- Modify: `electron/worker/kufar-http-client.ts`

**Interfaces consumed:**

```ts
export interface KufarRawResponseJournal {
  record(input: KufarRawResponseSnapshotInput): Promise<KufarRawResponseSnapshot>
  list(endpoint: string | URL): Promise<KufarRawResponseSnapshot[]>
  exportSnapshot(endpoint: string | URL, id: string, destination: string): Promise<void>
}
```

**Interfaces produced:**

```ts
export interface KufarHttpClientOptions {
  // existing fields...
  journal?: Pick<KufarRawResponseJournal, 'record'>
  onJournalWarning?: (message: string) => void
}
```

- [ ] **Step 1: Add RED success-journaling tests**

Extend the existing test helper to accept a mock journal.

```ts
it('journals a successful response exactly once', async () => {
  const journal = { record: vi.fn(async () => snapshot) }
  const client = createClient({ transport, journal })

  const result = await client.get('https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040')

  expect(result.ok).toBe(true)
  expect(journal.record).toHaveBeenCalledTimes(1)
  expect(journal.record).toHaveBeenCalledWith({
    requestUrl: new URL('https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040'),
    status: 200,
    body: responseBody,
  })
})
```

Also add one table-driven test proving `302`, `404`, `429`, and exhausted `503` do not call `journal.record`, plus a network-error case.

- [ ] **Step 2: Prove RED and commit tests**

```bash
npm test -- tests/unit/kufar-http-client.test.ts
git add tests/unit/kufar-http-client.test.ts
git commit -m "test(1.2.3): specify HTTP response journaling"
```

Expected: FAIL because `journal` is not a supported client option and no record call exists.

- [ ] **Step 3: Implement success-only journal hook**

Import only the type:

```ts
import type { KufarRawResponseJournal } from './kufar-raw-response-journal'
```

Add fields:

```ts
private readonly journal?: Pick<KufarRawResponseJournal, 'record'>
private readonly onJournalWarning: (message: string) => void
```

Constructor defaults:

```ts
this.journal = options.journal
this.onJournalWarning = options.onJournalWarning ?? (() => undefined)
```

Inside the existing `2xx` branch, before returning success:

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

Do not put the journal call around the attempt loop and do not call retry sleep when it fails.

- [ ] **Step 4: Add RED journal-failure isolation test**

```ts
it('keeps a successful HTTP result when journaling fails', async () => {
  const warnings: string[] = []
  const journal = {
    record: vi.fn(async () => {
      throw new Error('disk full: secret raw payload must not appear')
    }),
  }
  const client = createClient({ journal, onJournalWarning: (message) => warnings.push(message) })

  const result = await client.get(requestUrl)

  expect(result).toMatchObject({ ok: true, status: 200, attempts: 1 })
  expect(warnings).toEqual(['Raw response snapshot could not be stored'])
  expect(retrySleep).not.toHaveBeenCalled()
})
```

- [ ] **Step 5: Prove Task 2 GREEN and commit**

```bash
npm test -- tests/unit/kufar-http-client.test.ts
npm test -- tests/unit/kufar-raw-response-journal.test.ts
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
- Create: `electron/main/worker-storage.ts`
- Create: `electron/worker/config.ts`
- Create: `tests/worker-storage-config.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/worker/index.ts`

**Interfaces produced:**

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

it('serializes and parses the worker journal argument without rebuilding OS paths', () => {
  const argument = rawResponseJournalArg('/profile/Kufar Monitor')
  expect(readWorkerConfig(['electron', 'worker.js', argument])).toEqual({
    rawResponseJournalDir: join('/profile/Kufar Monitor', 'raw-responses'),
  })
})

it('rejects startup when the journal directory argument is missing', () => {
  expect(() => readWorkerConfig(['electron', 'worker.js'])).toThrow(/raw response journal/i)
})
```

Use `join()` in expectations so the tests remain portable on Windows/Linux runners.

- [ ] **Step 2: Prove RED and commit tests**

```bash
npm test -- tests/worker-storage-config.test.ts
git add tests/worker-storage-config.test.ts
git commit -m "test(1.2.3): specify worker journal storage config"
```

- [ ] **Step 3: Implement pure main/worker helpers**

`electron/main/worker-storage.ts`:

```ts
import { join } from 'node:path'

export const RAW_RESPONSE_JOURNAL_ARG = '--raw-response-journal-dir='

export function rawResponseJournalDir(userDataDir: string): string {
  return join(userDataDir, 'raw-responses')
}

export function rawResponseJournalArg(userDataDir: string): string {
  return `${RAW_RESPONSE_JOURNAL_ARG}${rawResponseJournalDir(userDataDir)}`
}
```

`electron/worker/config.ts` should use the same prefix value without importing main-process code. Move the shared literal into `shared/worker-config.ts` if duplication would otherwise be required; prefer one shared constant.

Recommended final structure:

```ts
// shared/worker-config.ts
export const RAW_RESPONSE_JOURNAL_ARG = '--raw-response-journal-dir='

// electron/worker/config.ts
import { RAW_RESPONSE_JOURNAL_ARG } from '../../shared/worker-config'

export function readWorkerConfig(argv: readonly string[]): WorkerConfig {
  const argument = argv.find((value) => value.startsWith(RAW_RESPONSE_JOURNAL_ARG))
  const rawResponseJournalDir = argument?.slice(RAW_RESPONSE_JOURNAL_ARG.length)
  if (!rawResponseJournalDir) {
    throw new Error('Utility worker requires a raw response journal directory')
  }
  return { rawResponseJournalDir }
}
```

- [ ] **Step 4: Wire main spawn and worker startup**

In `electron/main/index.ts`, immediately before supervisor creation:

```ts
const workerJournalArg = rawResponseJournalArg(app.getPath('userData'))
```

Then spawn with:

```ts
utilityProcess.fork(workerPath, [workerJournalArg], {
  serviceName: 'Kufar Monitor Worker',
})
```

In `electron/worker/index.ts`:

```ts
const workerConfig = readWorkerConfig(process.argv)
void workerConfig.rawResponseJournalDir
```

The explicit read validates the startup contract but does not construct an idle `KufarHttpClient` or `Agent`. Add a comment that traversal ownership will consume this config when introduced.

- [ ] **Step 5: Add source-wiring contract assertion only if needed**

If pure tests cannot prove `app.getPath('userData')` is actually used by `main/index.ts`, add one focused contract test that reads the source file and asserts both `app.getPath('userData')` and `rawResponseJournalArg` appear in the worker spawn path. Keep it narrow; do not mock the whole Electron module.

- [ ] **Step 6: Prove Task 3 GREEN and commit**

```bash
npm test -- tests/worker-storage-config.test.ts
npm test -- tests/worker-runtime.test.ts
npm run typecheck:electron
npm run lint
npm run format:check
git add shared/worker-config.ts electron/main/worker-storage.ts electron/worker/config.ts electron/main/index.ts electron/worker/index.ts tests/worker-storage-config.test.ts
git commit -m "feat(1.2.3): configure worker raw journal storage"
```

If `tests/worker-runtime.test.ts` has a different current name, use the existing worker runtime test discovered in the repository rather than creating a duplicate test suite.

Require full branch CI GREEN on the exact SHA.

---

### Task 4: Align task/epic docs and perform final verification

**Files:**
- Modify: `docs/tasks/1-2-3-raw-log.md`
- Generated modify: `docs/epics/1-2-http-client.md`
- Generated modify as applicable: `docs/phases/1-kufar-core.md`
- Generated modify: `docs/operations/status/tasks.md`
- Generated modify: `docs/operations/status/drift-report.md`

- [ ] **Step 1: Update the task source card**

Set:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-08
```

Mark all three acceptance checkboxes complete. Add a short implementation note that:

- successful `2xx` bodies are stored in a five-snapshot filesystem journal per endpoint;
- endpoint identity excludes query strings;
- fixture export reproduces exact response bytes;
- filesystem journal failure does not alter HTTP success/retry semantics;
- schema comparison remains epic `4.1`.

Do not claim there is already a scheduler traversal; describe the completed contract as HTTP-success journaling ready for traversal ownership.

- [ ] **Step 2: Refresh generated docs**

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: epic `1.2` becomes `done 3/3` and aligned if generator rules derive epic completion from all children.

- [ ] **Step 3: Run focused tests**

```bash
npm test -- tests/unit/kufar-raw-response-journal.test.ts tests/unit/kufar-http-client.test.ts tests/worker-storage-config.test.ts
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

Compare the final branch with `main` and confirm there are no changes to:

- `prisma/schema.prisma` or migrations;
- fallback/degradation code;
- scheduler/traversal implementation;
- schema-drift comparison logic;
- renderer IPC/save-dialog code;
- new runtime dependencies.

- [ ] **Step 6: Commit docs**

```bash
git add docs/tasks/1-2-3-raw-log.md docs/epics docs/phases docs/operations/status
git commit -m "docs(1.2.3): mark raw response journal done"
```

After the exact-SHA final workflow is GREEN, run the branch-finishing process while preserving RED -> GREEN commits with a normal merge commit rather than squash/rebase.
