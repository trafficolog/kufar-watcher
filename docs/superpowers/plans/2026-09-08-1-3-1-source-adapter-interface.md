# 1.3.1 SourceAdapter Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a database-agnostic shared `Listing` model, a category-neutral `SourceAdapter` pagination contract, and an injected registry keyed by `KufarAdapterKind`.

**Architecture:** Keep the new contract entirely in `shared/` so worker traversal, Electron lifecycle, Prisma, and concrete category adapters remain outside this task. Routing continues to determine `KufarAdapterKind`; the registry only maps that already-routed kind to a supplied adapter. Cursor values remain opaque strings and normalized monetary amounts remain exact decimal strings.

**Tech Stack:** TypeScript, Vitest, existing shared modules, existing GitHub Actions `verify` workflow.

**Spec:** `docs/superpowers/specs/2026-09-08-1-3-1-source-adapter-interface-design.md`

## Global Constraints

- `priceAmount` is `string | null`, not `number` and not Prisma `Decimal`.
- `listTime` is an ISO-8601 `string` in the shared contract.
- `raw` is JSON-compatible `JsonValue` and must not import Prisma JSON types.
- `firstSeenAt` is not part of normalized adapter output.
- `SourceAdapter` has no electronics- or real-estate-specific fields.
- Cursor is opaque `string | null`; this task does not define traversal page-count policy.
- Registry construction is injected; do not add a global singleton or production placeholder adapter classes.
- Do not implement real HTTP calls, API URL construction, payload parsing, concrete adapters, fallback, Prisma upsert, fixture capture, or full description loading.

---

### Task 1: Shared listing and adapter contracts plus injected registry

**Files:**
- Create: `tests/unit/source-adapter-registry.test.ts`
- Create: `tests/unit/source-adapter-types.test.ts`
- Create: `shared/listing.ts`
- Create: `shared/source-adapter.ts`
- Create: `shared/source-adapter-registry.ts`

**Interfaces:**
- Consumes: `CanonicalQuery` from `shared/canonical-query.ts`; `KufarAdapterKind` from `shared/kufar-routing.ts`.
- Produces:
  - `PriceKind = 'fixed' | 'negotiable' | 'free' | 'unknown'`
  - recursive JSON-safe `JsonValue`
  - `Listing`
  - `SourcePageRequest { query: CanonicalQuery; cursor: string | null }`
  - `SourcePage { listings: Listing[]; nextCursor: string | null }`
  - `SourceAdapter.fetchPage(request: SourcePageRequest): Promise<SourcePage>`
  - `SourceAdapterRegistry.get(kind: KufarAdapterKind): SourceAdapter`
  - `createSourceAdapterRegistry(adapters: Record<KufarAdapterKind, SourceAdapter>): SourceAdapterRegistry`

- [ ] **Step 1: Write the failing registry test**

Create `tests/unit/source-adapter-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createSourceAdapterRegistry } from '../../shared/source-adapter-registry'
import type { SourceAdapter } from '../../shared/source-adapter'

function stub(): SourceAdapter {
  return {
    async fetchPage() {
      return { listings: [], nextCursor: null }
    },
  }
}

describe('createSourceAdapterRegistry', () => {
  it('returns the injected electronics adapter', () => {
    const electronics = stub()
    const realEstate = stub()
    const registry = createSourceAdapterRegistry({ electronics, 'real-estate': realEstate })

    expect(registry.get('electronics')).toBe(electronics)
  })

  it('returns the injected real-estate adapter', () => {
    const electronics = stub()
    const realEstate = stub()
    const registry = createSourceAdapterRegistry({ electronics, 'real-estate': realEstate })

    expect(registry.get('real-estate')).toBe(realEstate)
  })
})
```

- [ ] **Step 2: Write the failing shared-contract test**

Create `tests/unit/source-adapter-types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { CanonicalQuery } from '../../shared/canonical-query'

const query: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: 'ps5',
  region: null,
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

const listing: Listing = {
  listId: '123',
  title: 'PlayStation 5',
  priceKind: 'fixed',
  priceAmount: '1299.90',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/123',
  region: 'Минск',
  accountId: null,
  isCompany: null,
  listTime: '2026-09-08T10:15:30.000Z',
  description: null,
  raw: { ad_id: 123, flags: ['featured'] },
}

function adapterFor(nextCursor: string | null): SourceAdapter {
  return {
    async fetchPage(request) {
      expect(request.query).toBe(query)
      return { listings: [listing], nextCursor }
    },
  }
}

describe('SourceAdapter shared contract', () => {
  it('allows electronics and real-estate stubs to implement the same contract', async () => {
    const electronics = adapterFor('opaque-next')
    const realEstate = adapterFor(null)

    await expect(electronics.fetchPage({ query, cursor: null })).resolves.toEqual({
      listings: [listing],
      nextCursor: 'opaque-next',
    })
    await expect(realEstate.fetchPage({ query, cursor: 'opaque-input' })).resolves.toEqual({
      listings: [listing],
      nextCursor: null,
    })
  })

  it('keeps exact decimal price and JSON-safe raw data in Listing', () => {
    expect(listing.priceAmount).toBe('1299.90')
    expect(listing.listTime).toBe('2026-09-08T10:15:30.000Z')
    expect(listing.raw).toEqual({ ad_id: 123, flags: ['featured'] })
  })
})
```

- [ ] **Step 3: Run the two new tests and verify RED**

Run:

```bash
npx vitest run tests/unit/source-adapter-registry.test.ts tests/unit/source-adapter-types.test.ts
```

Expected: FAIL because `shared/source-adapter-registry.ts`, `shared/source-adapter.ts`, and `shared/listing.ts` do not exist. Existing test suites must remain unaffected.

- [ ] **Step 4: Commit the RED tests**

```bash
git add tests/unit/source-adapter-registry.test.ts tests/unit/source-adapter-types.test.ts
git commit -m "test(1.3.1): define source adapter contract"
```

- [ ] **Step 5: Implement the normalized listing types**

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

- [ ] **Step 6: Implement the category-neutral adapter contract**

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

- [ ] **Step 7: Implement the injected registry**

Create `shared/source-adapter-registry.ts`:

```ts
import type { KufarAdapterKind } from './kufar-routing'
import type { SourceAdapter } from './source-adapter'

export interface SourceAdapterRegistry {
  get(kind: KufarAdapterKind): SourceAdapter
}

export function createSourceAdapterRegistry(
  adapters: Record<KufarAdapterKind, SourceAdapter>,
): SourceAdapterRegistry {
  return {
    get(kind) {
      return adapters[kind]
    },
  }
}
```

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/source-adapter-registry.test.ts tests/unit/source-adapter-types.test.ts
```

Expected: PASS, four tests total.

- [ ] **Step 9: Run typecheck, lint, and formatting checks for the new contract**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
```

Expected: all commands exit 0.

- [ ] **Step 10: Commit the GREEN implementation**

```bash
git add shared/listing.ts shared/source-adapter.ts shared/source-adapter-registry.ts
git commit -m "feat(1.3.1): add source adapter contract"
```

---

### Task 2: Align task documentation and verify the branch

**Files:**
- Modify: `docs/tasks/1-3-1-adapter-interface.md`
- Generated by docs tooling as applicable: `docs/epics/1-3-source-adapters.md`, `docs/phases/1-kufar-core.md`, `docs/operations/status/*`

**Interfaces:**
- Consumes: completed Task 1 contracts and registry.
- Produces: task `1.3.1` marked `done/aligned`; epic `1.3` rollup at `1/4` and still open.

- [ ] **Step 1: Update the source task card**

Set frontmatter in `docs/tasks/1-3-1-adapter-interface.md` to:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-08
```

Mark all three acceptance criteria `[x]` and add a short `## Результат — 2026-09-08` section stating:

```markdown
- Общий `Listing` и `SourceAdapter` не содержат категорийных или Prisma-зависимых типов.
- Registry выбирает injected adapter по `KufarAdapterKind`, полученному из существующего routing слоя.
- Electronics и real-estate stubs компилируются и работают через один контракт; конкретные adapters остаются задачами `1.3.2` и `1.3.3`.
```

- [ ] **Step 2: Refresh generated documentation**

Run:

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: both commands exit 0; epic `1.3` remains `todo/drifted` with `done: 1` of 4 tasks.

- [ ] **Step 3: Commit documentation alignment**

```bash
git add docs/tasks/1-3-1-adapter-interface.md docs/epics/1-3-source-adapters.md docs/phases docs/operations/status
git commit -m "docs(1.3.1): align source adapter interface"
```

- [ ] **Step 4: Run full repository verification on the committed docs SHA**

Run the same pipeline represented by `.github/workflows/verify.yml`, with the GitHub Actions run as the authoritative environment proof:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run docs:ops:check
```

Then confirm the branch `verify` workflow completes successfully, including Postgres compose integration, Electron sandbox preparation, build/output verification, development launch smoke, and production launch smoke.

Expected: zero failing tests/checks.

- [ ] **Step 5: Final scope review**

Compare the task branch with its `main` base and confirm only these categories changed:

```text
docs/superpowers/specs/2026-09-08-1-3-1-source-adapter-interface-design.md
docs/superpowers/plans/2026-09-08-1-3-1-source-adapter-interface.md
shared/listing.ts
shared/source-adapter.ts
shared/source-adapter-registry.ts
tests/unit/source-adapter-registry.test.ts
tests/unit/source-adapter-types.test.ts
docs/tasks/1-3-1-adapter-interface.md
generated epic/phase/status docs
```

There must be no concrete adapter implementation, HTTP call, Prisma schema change, fixture capture, fallback, or traversal/runtime wiring in this branch.
