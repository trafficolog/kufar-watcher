# 1.2.3 Raw Response Journal Design

**Task:** `docs/tasks/1-2-3-raw-log.md`

**Goal:** Preserve a small, bounded set of exact successful Kufar response bodies so schema drift can be diagnosed later and a stored response can be exported directly as a test fixture.

## Source requirements

The task requires three things and nothing more:

1. store the latest successful raw response for each endpoint;
2. retain only a few recent snapshots and evict older ones;
3. export a snapshot to a file suitable for `tests/fixtures/kufar/`.

Schema comparison is explicitly out of scope and remains in epic `4.1`.

## Architecture decision

Use a bounded filesystem journal under Electron `userData`, not a new Prisma model.

The project data model does not define a raw-response snapshot table in any delivery slice. Adding one here would expand the database contract without a corresponding domain entity or migration owner. A filesystem journal also matches the debugging purpose: snapshots are local diagnostic artifacts rather than relational application state.

The main process is the only process allowed to resolve the platform-specific storage root. It obtains `app.getPath('userData')`, appends the application-owned `raw-responses` directory, and passes that directory to the utility worker through `utilityProcess.fork()` arguments. The worker never reconstructs Windows/Linux user-data paths itself.

## Components

### `KufarRawResponseJournal`

Add `electron/worker/kufar-raw-response-journal.ts` with a narrow interface:

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
```

The concrete filesystem implementation accepts its root directory plus injectable `now()` and `createId()` functions for deterministic tests. Production IDs use `crypto.randomUUID()`.

### Endpoint identity

Endpoint identity is `URL.host + URL.pathname`, excluding query and fragment.

Examples:

- `https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040&size=30`
- `https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=1010&size=1`

both map to:

```text
api.kufar.by/search-api/v2/search/rendered-paginated
```

This keeps retention bounded across monitor-specific query combinations rather than creating one journal bucket per search URL.

Each endpoint directory is named by `sha256(endpoint)` so storage paths are safe and stable on both Windows and Linux. Human-readable endpoint identity remains inside every snapshot envelope.

## On-disk format

Each stored snapshot is a versioned JSON envelope:

```json
{
  "version": 1,
  "id": "<uuid>",
  "endpoint": "api.kufar.by/search-api/v2/search/rendered-paginated",
  "requestUrl": "https://api.kufar.by/search-api/v2/search/rendered-paginated?...",
  "status": 200,
  "capturedAt": "2026-09-08T10:15:30.000Z",
  "bodyBase64": "eyJ..."
}
```

The response body is stored as base64 so the journal preserves the exact bytes returned by the HTTP transport. The journal does not parse, normalize, pretty-print, validate, or rewrite JSON bodies.

Snapshot filenames contain a sortable timestamp plus ID. Only journal-owned snapshot filenames participate in retention; unrelated files in the root are never deleted.

## Retention

Default retention is exactly **5 snapshots per endpoint**.

After a new envelope is durably written, the journal enumerates that endpoint bucket and removes journal-owned snapshots older than the newest five. Different query strings share one endpoint bucket, while different endpoint paths have independent retention windows.

The limit is configurable only for tests; production uses five.

No byte quota, compression, global cross-endpoint eviction, or background cleanup service is added in this task. The known Kufar API surface is small, and the task specifically asks for a few recent snapshots per endpoint. Query stripping prevents normal monitor variation from creating unbounded buckets.

## HTTP client integration

`KufarHttpClient` gains an optional `journal` dependency and optional safe warning callback.

For each successful `2xx` response, after the transport has fully read the body and before returning the successful result, the client calls:

```ts
await journal.record({
  requestUrl: request.url,
  status: response.status,
  body: response.body,
})
```

Only successful `2xx` responses are journaled. Network failures, timeouts, `3xx`, `4xx`, `429`, and `5xx` outcomes do not produce raw-success snapshots.

A journal write failure must **not** turn a successful HTTP request into an HTTP failure and must never trigger an HTTP retry. The client reports a compact warning through an injected callback and still returns the original successful `KufarHttpResult`. The callback receives no raw response body.

This keeps network reliability policy and diagnostic persistence failure independent.

## Worker storage configuration

The main process spawns the worker with one application-owned argument containing the journal directory resolved from `app.getPath('userData')`.

The worker adds a small parser/helper for that argument so future traversal ownership can construct the filesystem journal without knowing Electron paths. This task does **not** invent a traversal or scheduler solely to exercise the journal; those owners do not exist yet.

The HTTP client therefore remains dependency-injected: when a traversal creates the production client, it supplies the journal created from worker storage configuration. Unit tests prove the integration now without prematurely creating an idle global HTTP client/Agent in the worker runtime.

## Export semantics

`exportSnapshot(endpoint, id, destination)` finds the stored envelope, base64-decodes `bodyBase64`, and writes those exact bytes to `destination`.

The export path is provided by the caller. The journal does not open dialogs, choose a filename, expose IPC, or copy files automatically into the repository. A caller may choose a `.json` destination under `tests/fixtures/kufar/`; the resulting file is byte-for-byte the original successful response body.

## Error handling

- Filesystem errors from direct journal API calls reject with ordinary typed/diagnostic `Error` objects; no raw response bytes are included in messages.
- Missing snapshot IDs reject explicitly rather than silently creating an empty fixture.
- Malformed stored envelope files are treated as journal corruption and rejected by `list`/export rather than being silently rewritten.
- HTTP-client integration catches journal persistence errors, calls the safe warning hook, and preserves the successful HTTP result.
- Retention deletes only files matching the journal's own snapshot filename pattern inside the hashed endpoint directory.

## Testing strategy

Use temporary directories and no live Kufar network calls.

RED -> GREEN coverage:

1. recording a successful body creates a readable snapshot envelope;
2. two URLs with different query strings map to the same endpoint bucket;
3. six writes retain only the newest five;
4. two endpoint paths retain independently;
5. a new journal instance can list snapshots written by a previous instance;
6. export reproduces the original body byte-for-byte;
7. unknown snapshot export fails explicitly;
8. successful `KufarHttpClient` responses are journaled once;
9. non-success HTTP outcomes and transport failures are not journaled;
10. journal write failure emits a safe warning but the HTTP result remains successful;
11. worker journal directory is derived from main-process `userData` and passed to `utilityProcess.fork` without hand-built OS paths.

## Files expected to change

- `electron/worker/kufar-raw-response-journal.ts` — new filesystem journal.
- `tests/unit/kufar-raw-response-journal.test.ts` — persistence/retention/export tests.
- `electron/worker/kufar-http-client.ts` — optional success journal integration.
- `tests/unit/kufar-http-client.test.ts` — journal integration/error-isolation tests.
- `electron/main/index.ts` and a small path/argument helper if needed — resolve `userData` and pass worker journal directory.
- focused main/worker configuration tests if the helper contains behavior worth testing.
- `docs/tasks/1-2-3-raw-log.md`, epic/phase/status generated docs — mark task/epic aligned after verification.

No Prisma migration or new runtime dependency is expected.

## Explicit non-goals

- schema comparison or drift detection;
- `SchemaSnapshot` or `HealthEvent` creation;
- persistence in Prisma/Postgres;
- response JSON parsing or adapter validation;
- scheduler/traversal implementation;
- renderer IPC, save dialogs, or fixture-management UI;
- compression, cloud upload, backup, or automatic bug-report submission.
