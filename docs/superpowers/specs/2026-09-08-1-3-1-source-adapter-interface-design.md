# Design — 1.3.1 SourceAdapter interface and registry

Date: 2026-09-08

## Context

Task `1.3.1` introduces the first common adapter contract for Kufar listing sources. The contract must hide category-specific response shapes from traversal code while staying small enough that the electronics and real-estate adapters can both implement it without forcing category-specific fields into the shared layer.

Existing inputs already provide:

- `CanonicalQuery` in `shared/canonical-query.ts`;
- `KufarAdapterKind = 'electronics' | 'real-estate'` and routing in `shared/kufar-routing.ts`;
- the persisted `Listing` shape in Prisma/domain documentation;
- the resilient Kufar HTTP client from task `1.2.2`.

Concrete adapter implementations, payload parsing, API URL construction, fixture capture, fallback, and persistence remain outside this task.

## Chosen approach

Use a pure shared contract plus an injected registry.

This keeps the common layer independent from the HTTP client, Prisma, Electron lifecycle, and concrete categories. A registry receives both adapters from its caller and exposes lookup by the already-routed `KufarAdapterKind`. No global singleton and no production placeholder adapter classes are introduced.

Rejected alternatives:

- an abstract base class would prematurely guess shared fetch/parsing behavior before either concrete adapter exists;
- a global singleton registry would create hidden initialization and HTTP-client dependencies without a current owner that needs them.

## Shared domain types

Create `shared/listing.ts`:

```ts
export type PriceKind = 'fixed' | 'negotiable' | 'free' | 'unknown'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface Listing {
  listId: string
  title: string
  priceKind: PriceKind
  priceAmount: string | null
  currency: string | null
  url: string
  region: string | null
  accountId: string | null
  isCompany: boolean | null
  listTime: string
  description: string | null
  raw: JsonValue
}
```

Decisions:

- `priceAmount` is an exact decimal string, not `number`, so the shared domain layer does not lose precision and does not depend on Prisma `Decimal`.
- `listTime` is an ISO-8601 string so the contract remains serialization-safe across process boundaries. Persistence converts it to Prisma `DateTime` later.
- `firstSeenAt` is not part of the normalized adapter output because persistence owns that timestamp on first upsert.
- `description` is present for compatibility with the domain model but concrete `1.3.x` adapters normally return `null`; full description loading belongs to epic `1.5`.
- `raw` is restricted to JSON-compatible values instead of importing Prisma JSON types or exposing `unknown`.

## Source adapter contract

Create `shared/source-adapter.ts`:

```ts
import type { CanonicalQuery } from './canonical-query'
import type { Listing } from './listing'

export interface SourcePageRequest {
  query: CanonicalQuery
  cursor: string | null
}

export interface SourcePage {
  listings: Listing[]
  nextCursor: string | null
}

export interface SourceAdapter {
  fetchPage(request: SourcePageRequest): Promise<SourcePage>
}
```

The cursor is deliberately opaque. Consumers can pass it back to the same adapter but must not interpret its format. The interface contains no electronics- or real-estate-specific fields and does not decide how many pages a traversal should fetch.

## Registry

Create `shared/source-adapter-registry.ts`:

```ts
import type { KufarAdapterKind } from './kufar-routing'
import type { SourceAdapter } from './source-adapter'

export interface SourceAdapterRegistry {
  get(kind: KufarAdapterKind): SourceAdapter
}

export function createSourceAdapterRegistry(
  adapters: Record<KufarAdapterKind, SourceAdapter>,
): SourceAdapterRegistry
```

The registry has one responsibility: return the adapter already selected by routing.

Normal consumer flow is:

```ts
const kind = routeKufarQuery(query)
const adapter = registry.get(kind)
const page = await adapter.fetchPage({ query, cursor })
```

Routing remains in `shared/kufar-routing.ts`; the registry does not parse URLs, inspect categories, build API URLs, or own HTTP dependencies.

Using `Record<KufarAdapterKind, SourceAdapter>` makes missing known adapters a compile-time configuration error for the normal typed construction path. No additional runtime error hierarchy is needed in this task.

## Error boundaries

Task `1.3.1` does not define normalization errors for platform payloads because no payload schema is parsed here. Required-field validation and category-specific normalization errors belong to tasks `1.3.2` and `1.3.3`, where the actual fixtures and field names are known.

The shared registry itself has no network or persistence failure modes.

## Testing

Add focused unit/contract tests:

- `tests/unit/source-adapter-registry.test.ts`
  - constructs electronics and real-estate stubs;
  - verifies `get('electronics')` returns the electronics stub;
  - verifies `get('real-estate')` returns the real-estate stub.
- `tests/unit/source-adapter-types.test.ts`
  - implements two minimal `SourceAdapter` stubs against the same interface;
  - exercises a representative `Listing` with exact-string price, ISO `listTime`, nullable fields and JSON-compatible `raw`;
  - verifies both stubs can return `SourcePage` values with opaque cursors.

TDD order is RED imports/stubs first, then the minimal shared types and registry.

Full repository verification remains the existing `verify` workflow: documentation consistency, unit tests, CI self-check, typecheck, lint, formatting, Postgres integration, build/output verification, and development/production launch smoke.

## Files and scope

Production files:

- `shared/listing.ts`
- `shared/source-adapter.ts`
- `shared/source-adapter-registry.ts`

Tests:

- `tests/unit/source-adapter-registry.test.ts`
- `tests/unit/source-adapter-types.test.ts`

After implementation, update `docs/tasks/1-3-1-adapter-interface.md` to `done/aligned` and refresh docs rollups. Epic `1.3` remains open with `1/4` tasks complete.

Explicitly out of scope:

- concrete electronics or real-estate production adapters;
- real HTTP calls or `KufarHttpClient` construction;
- `buildKufarApiUrl` integration;
- payload JSON parsing or normalization rules;
- pagination policy beyond carrying an opaque cursor;
- fixture capture;
- fallback/degradation;
- Prisma mapping/upsert;
- full description loading.
