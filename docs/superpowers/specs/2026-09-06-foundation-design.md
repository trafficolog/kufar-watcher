# Foundation `0.1.0` — integration design

## Scope

This design integrates the delivery slice called **Foundation (`0.1.0`)** from `docs/ROADMAP.MD`:

- epic `0.1` — Electron shell: `0.1.1`, `0.1.2`, `0.1.3`;
- epic `0.2` — local Postgres: `0.2.1`, `0.2.2`, `0.2.3`;
- epic `0.3` — MVP schema only: `0.3.1`, `0.3.2`, `0.3.3`;
- epic `0.4` — docs-ops and CI: `0.4.1`, `0.4.2`.

Tasks `0.3.4`–`0.3.6` remain deferred exactly as the roadmap requires. They belong to later delivery slices and must not be pulled into Foundation.

## Architectural boundaries

The process model stays deliberately small:

```text
renderer (Nuxt 4 SPA)
  ↕ explicit contextBridge API
main (window, lifecycle, Docker supervisor, IPC routing)
  ↕ typed MessagePort contract
utilityProcess worker (scheduler placeholder only in Foundation)
```

`main` owns OS/Electron lifecycle and Docker because both are host concerns. The worker owns future background execution. The renderer only sees product-level methods and events; it never sees raw `ipcRenderer`, Prisma, Dockerode, filesystem paths, or Node APIs.

No Nitro/API layer is introduced. The renderer is static and is served in production through the existing standard custom scheme with SPA fallback.

## Shared contracts

A small `shared/` module is the single source of truth for cross-process data. Foundation needs only:

- boot state and boot-step results;
- worker lifecycle events;
- journal entries required to make failures visible;
- preload API types for `system.getBootState()`, `system.retryBoot()`, `system.openJournal()`, `system.exit()` and boot event subscription.

Future monitor/feed/settings APIs are not predeclared.

IPC uses explicit channel constants and runtime sender validation. Worker messages are discriminated unions so adding or changing a field causes compilation failures on both ends.

## Worker lifecycle

`main` starts the worker only after infrastructure bootstrap succeeds. Shutdown is cooperative:

1. main sends `shutdown`;
2. worker stops accepting new work and acknowledges when the current operation boundary is safe;
3. main closes the utility process;
4. a hard timeout is used only to avoid orphaned processes during application exit.

Unexpected exits are recorded in the in-memory Foundation journal and restarted at most three consecutive times. A fourth consecutive crash transitions boot/application state to fatal error instead of starting an infinite restart loop. A successful stable start resets the consecutive-crash counter.

Foundation does not implement tray behavior. Closing the BrowserWindow hides/destroys only the window-level UI state; it does not automatically terminate the worker. Explicit application quit performs graceful worker shutdown.

## Postgres and Docker

`docker-compose.yml` remains the operator/development representation of the database contract: PostgreSQL 16, named volume, `127.0.0.1` port binding, `pg_isready` healthcheck, credentials from environment.

Runtime startup is performed through Dockerode rather than shelling out to `docker compose`:

1. connect to Docker using platform transport (Windows named pipe, Linux socket, environment override allowed for development/tests);
2. ping daemon;
3. locate one project container by deterministic name;
4. create it if missing with PostgreSQL 16, named volume, loopback port binding and healthcheck;
5. start if stopped;
6. poll health with a bounded timeout;
7. apply Prisma migrations;
8. start the worker;
9. publish each state transition to renderer.

The supervisor is dependency-injected around a narrow Docker client adapter so unit tests do not require a real daemon. CI uses a PostgreSQL service for schema/integration tests; it does not test Docker Desktop itself.

## Database model

Foundation creates only the MVP-1 tables required by the data-model spec:

- `Monitor`;
- `MonitorCursor`;
- `Run`;
- `Listing`;
- `Match`;
- `Setting`.

`Listing.listId` is used as the primary key under the explicitly documented pre-recon assumption. Price is `priceKind` plus nullable `priceAmount`. Runtime cursor state stays in `MonitorCursor`. JSON-shaped source/query fields use Prisma `Json`.

The second migration adds only the hot-query indexes and integrity constraints required by the spec, including unique `(monitorId, listingId)` for `Match` and cascading relationships that prevent orphaned runtime records.

Seeds are deterministic synthetic fixtures, not scraped Kufar data. They create two monitors, listings and matches. The Foundation schema intentionally does **not** contain `Favorite` or `PriceSnapshot`; therefore the `0.3.3` phrase “one favorite with price history” cannot be satisfied without violating `0.3.1`, `0.3.5` and the roadmap. Foundation records this source conflict explicitly and defers favorite seed rows until slice `0.5.0`.

## Boot UI

`AppBootScreen.vue` is an overlay rather than a route. It consumes boot events and renders the canonical steps:

- Docker;
- database;
- migrations;
- scheduler;
- Telegram.

Docker/database/migrations/scheduler failures are fatal. Telegram missing is skipped/optional. Telegram network failure after configuration is degraded, not blocking. Foundation has no Telegram implementation yet, so the initial state is “not configured · skipped” and the UI contract is shaped now without inventing a Telegram service.

On fatal startup failure the screen exposes exactly three actions: retry, open journal, exit. Docker guidance is platform-specific. Successful bootstrap keeps the screen visible long enough to avoid a flash and then reveals the minimal renderer.

## Docs and CI

The canonical documentation archive is imported into the repository as source of truth together with `src/docs-ops/cli.ts`. Generated docs blocks/status files are updated only through docs-ops.

CI uses Node 22 and npm 11.6.0, a committed lockfile and `npm ci`. Required gates are:

1. dependency install;
2. Prisma generate;
3. unit tests;
4. integration tests against PostgreSQL 16;
5. renderer + Electron typecheck;
6. lint;
7. formatting check;
8. docs-ops check;
9. production build and smoke checks.

A deliberate negative docs-ops test validates that malformed task frontmatter is rejected. Ordinary CI does not contact Kufar.

## Security baseline

- `contextIsolation: true`;
- `nodeIntegration: false`;
- renderer sandbox enabled;
- no raw `ipcRenderer` in renderer;
- IPC sender validation for all renderer-originated handlers;
- navigation and window-open restrictions retained;
- CSP/local-only renderer resources retained;
- no secrets committed; database credentials come from `.env`/runtime generation;
- no native node-gyp dependencies are introduced.

## Verification boundary

Foundation is complete only when the current branch has a fresh green CI run and the relevant task cards/docs-ops output are aligned. Manual Electron/Docker acceptance items that cannot be truthfully executed inside GitHub Actions are documented as manual verification items rather than silently claimed.
