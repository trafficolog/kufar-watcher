# 3.1.1 Telegram Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a grammY long-polling bot in the utility worker, expose an app-confirmed one-chat binding flow, and keep the Telegram token behind a main-process safe-storage boundary.

**Architecture:** Electron main owns encrypted secret persistence and passes plaintext to the active utility worker only through typed in-memory process messages. The worker owns grammY, candidate state, authorization, and the persisted bound-chat `Setting`; renderer sees only safe product-level state and a bind action over trusted IPC.

**Tech Stack:** Electron 44.2, TypeScript 6, grammY 1.46.0, Prisma 7/PostgreSQL, Vitest 5, Electron utilityProcess/typed IPC.

**Spec:** `docs/superpowers/specs/2026-09-13-3-1-1-telegram-bootstrap-design.md`

## Global Constraints

- Telegram network I/O runs only in the utility worker.
- Use grammY `1.46.0` with built-in sequential long polling; no runner and no webhook.
- Token plaintext must never be persisted in PostgreSQL, argv, environment variables, renderer state, logs, or worker events.
- Use Electron async safeStorage APIs; treat Linux `basic_text` as unprotected.
- Candidate chat is memory-only; only `telegram.bound-chat` is persisted in `Setting`.
- Binding is possible only through trusted renderer IPC and must be revalidated in the worker.
- Missing token is a normal non-fatal state.
- `3.1.2`, `3.1.3`, `3.2`, and `5.0.2` remain out of scope.

---

### Task 1: Shared Telegram contracts and dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `shared/telegram.ts`
- Modify: `shared/runtime.ts`
- Test: `tests/unit/runtime-contract.test.ts`

**Interfaces:**
- Produces: `TelegramRuntimeState`, `TelegramCandidate`, `TelegramBindResult`, `TelegramDesktopState`.
- Produces: typed `telegram-configure`, `telegram-bind-candidate`, `telegram-state`, `telegram-candidate`, and `telegram-bind-result` process messages.

- [ ] **Step 1: Write failing shared-contract tests**

Add compile/runtime-shape assertions around discriminants and safe DTOs. The test must make it impossible for a token field to exist in worker Telegram events.

```ts
expect(telegramStateEvent).toEqual({
  type: 'telegram-state',
  state: 'not-configured',
  boundChatId: null,
})
expect('token' in telegramStateEvent).toBe(false)
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
npm test -- tests/unit/runtime-contract.test.ts
```

Expected: FAIL because Telegram shared types/messages do not exist yet.

- [ ] **Step 3: Add minimal shared contracts and pin grammY**

Create:

```ts
export type TelegramRuntimeState =
  | 'not-configured'
  | 'starting'
  | 'waiting-for-binding'
  | 'ready'
  | 'degraded'

export type TelegramBindResult = 'bound' | 'candidate-mismatch' | 'no-candidate'

export interface TelegramCandidate {
  chatId: string
  chatType: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown'
  displayName: string
  username?: string
}
```

Extend worker messages exactly as defined in the design and add `grammy: "1.46.0"` using `npm install grammy@1.46.0 --save-exact` so `package-lock.json` is generated rather than hand-authored.

- [ ] **Step 4: Run targeted tests and typecheck**

```bash
npm test -- tests/unit/runtime-contract.test.ts
npm run typecheck:electron
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json shared/telegram.ts shared/runtime.ts tests/unit/runtime-contract.test.ts
git commit -m "feat: add Telegram runtime contracts"
```

---

### Task 2: Main-process Telegram secret read boundary

**Files:**
- Create: `electron/main/telegram-secret-store.ts`
- Test: `tests/unit/telegram-secret-store.test.ts`

**Interfaces:**
- Consumes: Electron `safeStorage` async APIs through an injected adapter.
- Produces: `TelegramSecretReadResult` and `createTelegramSecretStore(...)`.

- [ ] **Step 1: Write failing tests for missing/protected/unavailable states**

Cover absent file, protected decrypt, encryption unavailable, Linux `basic_text`, malformed ciphertext/decrypt failure, and ensure public errors never include ciphertext/plaintext.

```ts
await expect(store.read()).resolves.toEqual({ state: 'missing' })
await expect(linuxBasicStore.read()).resolves.toEqual({
  state: 'unavailable',
  reason: 'unprotected-backend',
})
```

- [ ] **Step 2: Run targeted test and verify RED**

```bash
npm test -- tests/unit/telegram-secret-store.test.ts
```

Expected: FAIL because the secret store does not exist.

- [ ] **Step 3: Implement minimal read-only store**

Use injected filesystem and safe-storage adapters. Persisted representation is base64 ciphertext only. Use `isAsyncEncryptionAvailable()` and `decryptStringAsync(Buffer.from(base64, 'base64'))`. On Linux check `getSelectedStorageBackend()` before accepting the store as protected.

```ts
export type TelegramSecretReadResult =
  | { state: 'missing' }
  | { state: 'protected'; token: string }
  | {
      state: 'unavailable'
      reason: 'encryption-unavailable' | 'unprotected-backend' | 'decrypt-failed'
    }
```

- [ ] **Step 4: Run targeted tests**

```bash
npm test -- tests/unit/telegram-secret-store.test.ts
npm run typecheck:electron
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main/telegram-secret-store.ts tests/unit/telegram-secret-store.test.ts
git commit -m "feat: add Telegram secret read boundary"
```

---

### Task 3: Worker Telegram bot service and persisted binding

**Files:**
- Create: `electron/worker/telegram-binding-repository.ts`
- Create: `electron/worker/telegram-bot-service.ts`
- Test: `tests/unit/telegram-bot-service.test.ts`
- Test: `tests/integration/telegram-binding-repository.test.ts`

**Interfaces:**
- Consumes: Prisma `Setting`, shared Telegram types, injected bot factory.
- Produces: `TelegramBotService` with `configure`, `bindCandidate`, `getState`, `getCandidate`, `stop`.
- Produces: repository `getBoundChatId(): Promise<string | null>` and `setBoundChatId(chatId: string): Promise<void>` using key `telegram.bound-chat`.

- [ ] **Step 1: Write failing service tests**

Use a fake bot adapter rather than Telegram network. Prove `configure(null)` is non-fatal, configured bot starts, stop is graceful, unbound message creates candidate and sends exactly one neutral acknowledgement, bind rejects mismatched chat, exact bind persists and clears candidate, restored binding survives service recreation, and foreign messages/callbacks receive no reply once bound.

```ts
expect(await service.bindCandidate('wrong')).toBe('candidate-mismatch')
expect(repository.saved).toEqual([])
expect(foreignReplies).toEqual([])
```

- [ ] **Step 2: Run service test and verify RED**

```bash
npm test -- tests/unit/telegram-bot-service.test.ts
```

Expected: FAIL because service/repository do not exist.

- [ ] **Step 3: Implement repository and service seam**

Keep grammY-specific context conversion behind the service factory. Do not expose raw grammY errors. Candidate metadata must be normalized to the shared DTO before publication.

```ts
export interface TelegramBotService {
  configure(token: string | null): Promise<void>
  bindCandidate(chatId: string): Promise<TelegramBindResult>
  getState(): TelegramRuntimeState
  getCandidate(): TelegramCandidate | null
  stop(): Promise<void>
}
```

- [ ] **Step 4: Run unit tests**

```bash
npm test -- tests/unit/telegram-bot-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add real Prisma repository integration test**

Create/delete `telegram.bound-chat` in test setup/teardown and verify JSON string storage roundtrip.

```bash
npm test -- tests/integration/telegram-binding-repository.test.ts
```

Expected: PASS with CI PostgreSQL.

- [ ] **Step 6: Commit**

```bash
git add electron/worker/telegram-binding-repository.ts electron/worker/telegram-bot-service.ts tests/unit/telegram-bot-service.test.ts tests/integration/telegram-binding-repository.test.ts
git commit -m "feat: add Telegram bot binding service"
```

---

### Task 4: Worker runtime integration and secret-redaction regression

**Files:**
- Modify: `electron/worker/worker-application.ts`
- Modify: `electron/worker/runtime.ts`
- Modify: `electron/worker/index.ts`
- Test: `tests/unit/worker-runtime.test.ts`
- Test: `tests/unit/worker-application.test.ts`
- Create: `tests/unit/telegram-secret-redaction.test.ts`

**Interfaces:**
- Consumes: typed worker control messages and `TelegramBotService`.
- Produces: safe Telegram state/candidate/bind-result events.

- [ ] **Step 1: Write failing runtime tests**

Prove `telegram-configure` reaches the service, `telegram-bind-candidate` returns a correlated result, and shutdown stops Telegram before `shutdown-complete`.

```ts
expect(events).toContainEqual({
  type: 'telegram-bind-result',
  requestId: 'r1',
  result: 'bound',
})
```

- [ ] **Step 2: Run targeted runtime/application tests and verify RED**

```bash
npm test -- tests/unit/worker-runtime.test.ts tests/unit/worker-application.test.ts
```

Expected: FAIL on new Telegram controls/lifecycle.

- [ ] **Step 3: Integrate service minimally**

`WorkerApplication` creates the binding repository/service from its existing Prisma client. `start()` does not require a token. `stop()` calls Telegram stop before Prisma disconnect. Runtime accepts the new controls with strict type guards.

- [ ] **Step 4: Add sentinel-token redaction test**

Use `token = 'SECRET_SENTINEL_3_1_1'`, force bot start/handler failures, serialize every published event/public error, and assert the sentinel is absent.

```ts
expect(JSON.stringify(events)).not.toContain('SECRET_SENTINEL_3_1_1')
```

- [ ] **Step 5: Run tests/typecheck**

```bash
npm test -- tests/unit/worker-runtime.test.ts tests/unit/worker-application.test.ts tests/unit/telegram-secret-redaction.test.ts
npm run typecheck:electron
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/worker tests/unit/worker-runtime.test.ts tests/unit/worker-application.test.ts tests/unit/telegram-secret-redaction.test.ts
git commit -m "feat: integrate Telegram with worker lifecycle"
```

---

### Task 5: Supervisor configuration replay and correlated worker requests

**Files:**
- Modify: `electron/main/worker-supervisor.ts`
- Modify: `electron/main/index.ts`
- Test: `tests/unit/worker-supervisor.test.ts`
- Create: `tests/unit/telegram-main-runtime.test.ts`

**Interfaces:**
- Consumes: `TelegramSecretStore`, typed worker process messages/events.
- Produces: supervisor methods `configureTelegram(token: string | null)` and `bindTelegramCandidate(chatId: string): Promise<TelegramBindResult>` or a focused adjacent main runtime with equivalent behavior.
- Guarantees: latest token is replayed to every replacement worker only in memory.

- [ ] **Step 1: Write failing supervisor/runtime tests**

Prove token is not present in spawn argv/env, current active worker receives configuration, replacement worker receives the same in-memory configuration after restart/ready, bind requests use unique `requestId`, and response correlation resolves the correct Promise.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- tests/unit/worker-supervisor.test.ts tests/unit/telegram-main-runtime.test.ts
```

Expected: FAIL because supervisor has no Telegram command path.

- [ ] **Step 3: Implement minimal command/replay path**

Do not log command payloads. If a worker is not currently available, binding must fail with a controlled application error rather than persist in main.

- [ ] **Step 4: Wire secret read during main bootstrap**

After Electron is ready, read the secret store and configure the supervisor with token or `null`. `unavailable` is represented as a safe Telegram secret state and does not fail global bootstrap.

- [ ] **Step 5: Run tests/typecheck**

```bash
npm test -- tests/unit/worker-supervisor.test.ts tests/unit/telegram-main-runtime.test.ts
npm run typecheck:electron
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/main/worker-supervisor.ts electron/main/index.ts tests/unit/worker-supervisor.test.ts tests/unit/telegram-main-runtime.test.ts
git commit -m "feat: bridge Telegram configuration to worker"
```

---

### Task 6: Trusted renderer IPC and Telegram boot-state projection

**Files:**
- Modify: `shared/ipc.ts`
- Modify: `electron/main/ipc-router.ts`
- Modify: `electron/preload/desktop-api.ts`
- Modify: `electron/main/infrastructure-bootstrap.ts`
- Test: `tests/unit/ipc-router.test.ts`
- Test: `tests/unit/preload-api.test.ts`
- Test: `tests/unit/infrastructure-bootstrap.test.ts`

**Interfaces:**
- Produces: `KufarDesktopApi.telegram.getState()` and `.bindCandidate(chatId)`.
- Consumes: safe main-held Telegram state and correlated bind service.

- [ ] **Step 1: Write failing IPC/preload tests**

Verify trusted renderer succeeds, untrusted renderer is rejected for both new channels, preload exposes only product operations, and no token/set-token method exists.

```ts
expect(api.telegram).toEqual(
  expect.objectContaining({
    getState: expect.any(Function),
    bindCandidate: expect.any(Function),
  }),
)
expect('setToken' in api.telegram).toBe(false)
```

- [ ] **Step 2: Write failing boot-state mapping tests**

Cover Telegram `not-configured → skipped`, `starting → running`, `waiting-for-binding/degraded → degraded`, and `ready → success` without changing global phase to error.

- [ ] **Step 3: Run targeted tests and verify RED**

```bash
npm test -- tests/unit/ipc-router.test.ts tests/unit/preload-api.test.ts tests/unit/infrastructure-bootstrap.test.ts
```

Expected: FAIL on missing Telegram API/state routing.

- [ ] **Step 4: Implement IPC/preload/state projection**

Reuse the existing trusted-renderer assertion for every new handler. Main updates its safe state from worker Telegram events and serves a DTO containing only runtime, bound chat id, candidate, and coarse secret state.

- [ ] **Step 5: Run targeted tests/typecheck**

```bash
npm test -- tests/unit/ipc-router.test.ts tests/unit/preload-api.test.ts tests/unit/infrastructure-bootstrap.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/ipc.ts electron/main/ipc-router.ts electron/preload/desktop-api.ts electron/main/infrastructure-bootstrap.ts tests/unit
git commit -m "feat: expose Telegram binding backend API"
```

---

### Task 7: Task lifecycle, full verification, review, merge

**Files:**
- Modify: `docs/tasks/3-1-1-bot-bootstrap.md`
- Modify: `docs/epics/3-1-telegram-transport.md`
- Modify generated docs-ops status files via refresh.

**Interfaces:**
- No new runtime interfaces.
- Produces: aligned documentation and release-plan evidence.

- [ ] **Step 1: Run full local verification**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: all PASS.

- [ ] **Step 2: Update task evidence/status**

Set `3.1.1` to `done` and `sync_state: aligned` only after implementation and verification. Keep epic `3.1` incomplete because `3.1.2` and `3.1.3` remain todo.

- [ ] **Step 3: Refresh/check generated docs**

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: PASS and generated rollups match source cards.

- [ ] **Step 4: Push final docs commit and open/update PR**

PR body must record RED evidence, GREEN verification, explicit scope exclusions, and the secret-redaction regression.

- [ ] **Step 5: Verify exact PR head in GitHub Actions**

Require the full repository verify workflow to be GREEN for the exact final HEAD before claiming completion.

- [ ] **Step 6: Review diff and review threads**

Inspect all changed files, submitted reviews, and inline comments. Resolve actionable issues and rerun exact-head CI after any change.

- [ ] **Step 7: Merge with exact expected head SHA**

Merge only after review and CI are clean. Confirm `main` points at the resulting merge commit.

## Self-review

- Spec coverage: secret boundary, worker lifecycle, candidate persistence rule, app-only binding, foreign-chat silence, missing-token behavior, redacted errors, typed IPC, boot projection, and restart replay each map to a task above.
- Placeholder scan: no implementation step delegates unspecified behavior; all out-of-scope work is explicitly assigned to later roadmap tasks rather than left as TODOs.
- Type consistency: `TelegramRuntimeState`, `TelegramCandidate`, and `TelegramBindResult` originate in `shared/telegram.ts` and are reused across worker, main, and preload contracts.
