# CanonicalQuery URL Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, deterministic Kufar listing-URL parser that returns the approved `CanonicalQuery` contract and preserves unknown non-transport query parameters.

**Architecture:** Keep the shared data contract in `shared/canonical-query.ts` and URL/error behavior in `shared/kufar-url.ts`. The parser uses the platform `URL`/`URLSearchParams` APIs only, branches on the real-estate hostname for its observed positional route grammar, and leaves API parameter mapping to `1.1.2`.

**Tech Stack:** TypeScript 6 strict mode, Node URL API, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-07-1-1-1-canonical-query-design.md`

## Global Constraints

- No network requests in this task.
- Keep `CanonicalQuery` independent of Kufar search-API request parameters.
- Preserve unknown query parameters and repeated values.
- Discard only pagination transport state `cursor` and `size`.
- Accept only Kufar hostnames and `http`/`https` protocols.
- Keep TDD visible as a tests-only RED commit followed by implementation.
- Do not modify Electron process boundaries, Prisma, UI, or dependencies.

---

### Task 1: Lock parser behavior with RED tests

**Files:**
- Create: `tests/unit/url-parse.test.ts`

**Interfaces:**
- Consumes: planned `parseKufarListingUrl(input: string): CanonicalQuery` and `KufarUrlParseError` from `shared/kufar-url.ts`.
- Produces: executable behavior contract for goods URLs, real-estate URLs, unknown params, transport stripping, and explicit errors.

- [ ] **Step 1: Write the failing tests**

Cover these exact behaviors:

```ts
parseKufarListingUrl(
  'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?sort=lst.d',
)
```

must return region `minsk`, category `igry-i-pristavki`, query `ps5`, sort `lst.d`, and empty extras.

```ts
parseKufarListingUrl('https://www.kufar.by/l/elektronika?cur=BYN')
```

must keep `cur: ['BYN']`, with `region: null`.

```ts
parseKufarListingUrl(
  'https://re.kufar.by/l/minsk/kupit/kvartiru/1k/bez-posrednikov?cur=USD',
)
```

must return `region: 'minsk'`, `operation: 'kupit'`, `category: 'kvartiru'`, `pathFilters: ['1k']`, seller marker, and preserved currency parameter.

A page-2 URL containing `cursor`, `size`, and repeated `feature=a&feature=b` must omit `cursor`/`size` and preserve `feature: ['a', 'b']`.

`auto.kufar.by/l/avtomobili` must parse syntactically. Foreign hosts, non-http(s) protocols, malformed input, and `/item/...` must throw `KufarUrlParseError` with the expected stable code.

- [ ] **Step 2: Commit tests only**

Commit message:

```text
test(1.1.1): define canonical URL parser behavior
```

- [ ] **Step 3: Verify RED on that exact commit**

Run through CI (or locally when available):

```bash
npm test -- tests/unit/url-parse.test.ts
```

Expected: FAIL because `shared/kufar-url.ts` is not implemented yet. The failure must be attributable to the missing feature, not malformed test syntax.

---

### Task 2: Implement the minimal shared parser

**Files:**
- Create: `shared/canonical-query.ts`
- Create: `shared/kufar-url.ts`
- Test: `tests/unit/url-parse.test.ts`

**Interfaces:**
- Produces: `CanonicalQuery`, `KufarUrlParseErrorCode`, `KufarUrlParseError`, `parseKufarListingUrl(input: string)`.

- [ ] **Step 1: Add the shared CanonicalQuery type**

```ts
export interface CanonicalQuery {
  host: string
  category: string | null
  query: string | null
  region: string | null
  sellerType: string | null
  sort: string | null
  operation: string | null
  pathFilters: string[]
  extraParams: Record<string, string[]>
}
```

- [ ] **Step 2: Add stable parser errors**

Implement the exact codes from the design spec and keep the error `name` equal to `KufarUrlParseError`.

- [ ] **Step 3: Implement validation and route parsing**

Use `new URL(input)` inside `try/catch`. Validate protocol first, hostname second, and `/l` route third. Decode individual path segments. Parse `re.kufar.by` positionally; parse other accepted Kufar hosts using `r~`, `q~`, seller marker, category, then path filters.

- [ ] **Step 4: Implement query-string extraction**

Recognize `sort`; skip `cursor` and `size`; collect every other key in `Record<string, string[]>` while preserving repeated-value order.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/unit/url-parse.test.ts
npm test
npm run typecheck
npm run lint
npm run format:check
```

Expected: all commands PASS.

- [ ] **Step 6: Commit implementation**

Commit message:

```text
feat(1.1.1): parse Kufar listing URLs
```

---

### Task 3: Align task metadata and verify the branch

**Files:**
- Modify: `docs/tasks/1-1-1-url-parse.md`
- Modify generated files under `docs/operations/status/` through docs-ops only.

**Interfaces:**
- Consumes: green parser implementation and tests.
- Produces: task `done / aligned`, generated status rollups, reviewable PR.

- [ ] **Step 1: Mark acceptance complete only after tests pass**

Set task status to `done`, sync state to `aligned`, review date to `2026-09-07`, and check all four acceptance boxes. Record the RED and GREEN commit/run evidence.

- [ ] **Step 2: Refresh and check operational docs**

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Parent epic `1.1` remains governed by child rollup and must not be marked done merely because `1.1.1` completes.

- [ ] **Step 3: Run full verification**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run docs:ops:check
npm run build
```

Use the repository CI as authoritative verification for PostgreSQL integration and both Electron smoke paths.

- [ ] **Step 4: Review diff against `main`**

Expected functional scope: one shared contract, one pure parser, one parser test file, approved spec/plan, task/status docs. No dependencies, Prisma, UI, HTTP client, adapter, or Kufar network changes.

- [ ] **Step 5: Open PR and merge only after green CI and review**

PR title:

```text
1.1.1: parse listing URLs into CanonicalQuery
```

Do not tag a release for this task; tags are created only at delivery-slice boundaries under `docs/RELEASING.md`.
