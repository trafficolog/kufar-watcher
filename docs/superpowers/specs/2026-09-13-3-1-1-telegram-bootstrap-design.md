# 3.1.1 Telegram bootstrap and chat binding — design

**Date:** 2026-09-13  
**Task:** `3.1.1` — Бот на grammY и привязка чата  
**Release slice:** `0.3.0`  
**Status:** approved

## Goal

Add a Telegram long-polling transport to the existing utility worker and establish one explicitly approved chat as the only authorized Telegram peer. A chat may become a candidate by messaging the bot, but it must not become bound until the user confirms that candidate from the desktop application boundary.

This task builds the backend contract only. The actual Telegram settings screen, token entry, token verification UI, Linux consent flow, and test-message button remain in `5.0.2`.

## Constraints

- Telegram networking belongs to the Electron `utilityProcess` worker; `main` must not run bot polling.
- No webhook and no external service.
- One user, one machine, one bound Telegram chat.
- A candidate chat is ephemeral and must never be persisted.
- The bound chat is persisted in Prisma `Setting`.
- Before binding, no monitoring content may be delivered to a candidate.
- After binding, messages and callback queries from any other chat are ignored silently.
- Bot token plaintext must not be stored in PostgreSQL, argv, environment variables, logs, journal events, or renderer state.
- Missing token is a normal `not-configured` state and must not fail worker startup.
- `3.1.2` owns reconnect policy. `3.1.3` owns rate-limited outgoing queueing. `3.2` owns notification formatting/delivery. `5.0.2` owns the settings UI and secret write/replace flow.

## Library choices

Use `grammy` `1.46.0` as a direct runtime dependency. For this personal desktop workload, use grammY built-in `bot.start()` long polling rather than runner/concurrent polling. Built-in long polling is sequential and predictable, and graceful shutdown is provided by `bot.stop()`.

Install `bot.catch(...)` so handler/polling errors are converted into controlled Telegram status/journal events rather than allowing grammY's default long-polling error handler to stop and rethrow the bot.

Electron `safeStorage` is main-process-only. On Electron 44 use the asynchronous API (`isAsyncEncryptionAvailable`, `encryptStringAsync`, `decryptStringAsync`); the synchronous API is deprecated and scheduled for removal in Electron 46.

## Architecture

### 1. Secret boundary in main

Create a `TelegramSecretStore` in `electron/main/telegram-secret-store.ts`.

The persistent file lives below `app.getPath('userData')` and contains only the encrypted token bytes encoded as base64. Plaintext exists only transiently in main memory while decrypting and while being sent to the worker.

The read-side contract for this task is:

```ts
export type TelegramSecretReadResult =
  | { state: 'missing' }
  | { state: 'protected'; token: string }
  | { state: 'unavailable'; reason: 'encryption-unavailable' | 'unprotected-backend' | 'decrypt-failed' }

export interface TelegramSecretStore {
  read(): Promise<TelegramSecretReadResult>
}
```

On Linux, `safeStorage.getSelectedStorageBackend() === 'basic_text'` is treated as `unprotected-backend`, even if Electron reports encryption available. `3.1.1` must not silently accept it as protected storage. The later `5.0.2` flow can add an explicit user-consent policy for degraded storage.

No secret write API is exposed to the renderer in this task.

### 2. Typed main↔worker secret handoff

Do not pass the Telegram token through worker argv or environment. Extend the typed worker control protocol with an in-memory configuration message:

```ts
export type WorkerControlMessage =
  | { type: 'shutdown' }
  | { type: 'telegram-configure'; token: string | null }
  | { type: 'telegram-bind-candidate'; requestId: string; chatId: string }
```

`token: null` means Telegram is not configured and polling stays stopped.

The worker must never echo the token back in any event.

The supervisor owns sending runtime commands to the currently active worker so a worker restart receives the currently resolved token again without persisting plaintext outside main memory.

### 3. Telegram worker service

Create a focused `TelegramBotService` owned by `WorkerApplication`, separate from scheduler/source runtime.

```ts
export type TelegramRuntimeState =
  | 'not-configured'
  | 'starting'
  | 'waiting-for-binding'
  | 'ready'
  | 'degraded'

export interface TelegramCandidate {
  chatId: string
  chatType: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown'
  displayName: string
  username?: string
}

export interface TelegramBotService {
  configure(token: string | null): Promise<void>
  bindCandidate(chatId: string): Promise<'bound' | 'candidate-mismatch' | 'no-candidate'>
  getState(): TelegramRuntimeState
  getCandidate(): TelegramCandidate | null
  stop(): Promise<void>
}
```

`configure(token)` stops any prior bot instance before starting a new one. `configure(null)` leaves the service in `not-configured`.

The grammY bot factory is injected so unit tests do not contact Telegram.

### 4. Candidate and binding rules

The persisted setting key is a single constant, `telegram.bound-chat`.

When no chat is bound:

1. A Telegram message records/updates the in-memory candidate.
2. The worker publishes a candidate event containing only safe metadata.
3. The candidate receives only a neutral acknowledgement such as `Запрос на привязку получен. Подтвердите привязку в приложении Kufar Monitor.`
4. Monitoring content is not sent by this task at all.
5. Candidate data is never written to `Setting`.

When the app asks to bind a candidate, the worker compares the requested `chatId` to the current in-memory candidate. Only an exact match is persisted using `Setting.upsert`. After persistence, the candidate is cleared and service state becomes `ready`.

On startup/configure, the service loads `telegram.bound-chat` from `Setting`, so a previously bound chat survives worker/application restarts.

When a chat is already bound, updates from any other chat are ignored with no response. The same rule applies to callback queries with a chat context.

### 5. Renderer-facing backend contract

Extend the product-level typed preload API now, without implementing the settings screen:

```ts
export interface TelegramDesktopState {
  runtime: TelegramRuntimeState
  boundChatId: string | null
  candidate: TelegramCandidate | null
  secret: 'missing' | 'protected' | 'unavailable'
}

telegram: {
  getState(): Promise<TelegramDesktopState>
  bindCandidate(chatId: string): Promise<'bound' | 'candidate-mismatch' | 'no-candidate'>
}
```

All IPC handlers reuse the existing trusted-renderer validation. `bindCandidate` must not accept a raw persistence value or arbitrary token; it is a product action and the worker revalidates the candidate before persistence.

Main keeps the latest Telegram state/candidate from typed worker events and correlates bind requests by `requestId` so renderer completion means the `Setting.upsert` actually completed.

### 6. Worker events

Add typed events for safe state only:

```ts
| { type: 'telegram-state'; state: TelegramRuntimeState; boundChatId: string | null }
| { type: 'telegram-candidate'; candidate: TelegramCandidate | null }
| { type: 'telegram-bind-result'; requestId: string; result: TelegramBindResult }
```

No event contains a token or raw grammY error object.

The existing boot `telegram` step maps `not-configured` to `skipped`, `starting` to `running`, `waiting-for-binding` to `degraded`, `ready` to `success`, and a controlled Telegram failure to `degraded`. Telegram configuration problems do not change the global boot phase to `error` because scheduler monitoring remains useful without notifications configured.

### 7. Error and logging policy

Never feed Telegram/grammY errors through generic serialization that may include request URLs, headers, or token-bearing values.

Map failures to fixed redacted messages/codes such as:

- `Telegram authentication failed`
- `Telegram polling failed`
- `Telegram update handler failed`
- `Telegram secret could not be decrypted`

Tests use a unique sentinel token and assert that no emitted journal event, status event, thrown public error, or renderer-facing DTO contains the sentinel.

### 8. Lifecycle

`WorkerApplication.start()` continues to recover runs and start scheduler exactly as today. Telegram is configured by a typed main→worker control message after the worker is spawned; absence/unavailability of a token produces `not-configured` without blocking scheduler readiness.

`WorkerApplication.stop()` stops Telegram before disconnecting shared resources and before worker shutdown acknowledgement is emitted.

Worker restarts are handled by the existing supervisor. The supervisor resends the currently resolved in-memory Telegram configuration to each new worker instance after it becomes ready. Reconnection behavior inside a running bot after network changes remains `3.1.2`.

## Testing strategy

Use TDD and no live Telegram requests in CI.

Unit/contract coverage must prove:

- missing secret returns a normal state and worker still reaches ready;
- Linux `basic_text` is reported as unavailable/unprotected;
- token is passed only by typed process message, never worker argv/env;
- configuring a fake bot starts long polling and graceful stop calls bot stop;
- candidate is in memory only and receives only the binding acknowledgement;
- binding requires an exact current candidate and persists only the bound chat;
- persisted bound chat is restored after service recreation;
- foreign chat messages/callbacks are silently ignored once bound;
- renderer IPC can read safe state and bind the current candidate through correlation;
- sentinel token never appears in journals/events/public DTOs.

Integration coverage should use the real Prisma `Setting` model against the existing PostgreSQL CI service where useful, while grammY transport remains fake.

## Explicitly out of scope

- reconnect/backoff policy after network changes (`3.1.2`);
- Telegram API rate-limited outbox (`3.1.3`);
- sending matched listings or message formatting (`3.2`);
- token input, validation request, secret write/replace UI, Linux consent UI, test-message button (`5.0.2`);
- webhooks;
- multi-user or multi-chat authorization;
- runner/concurrent update processing.

## Acceptance mapping

- **Bot accepts commands only from bound chat:** authorization guard is enforced in the worker service.
- **Candidate receives no findings before confirmation:** only neutral binding acknowledgement exists in this task; notification delivery is not connected yet.
- **Confirmation only from application:** persistence is reachable through trusted renderer IPC → main → typed worker command, never from Telegram updates.
- **Foreign chat ignored silently:** explicit guard with no reply.
- **Missing token does not crash worker:** `null` configuration is normal.
- **Token never enters logs:** secret boundary plus redacted error mapping and sentinel regression test.
