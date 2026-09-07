# 1.1.1 URL → CanonicalQuery Design

**Status:** approved 2026-09-07

## Goal

Parse a public Kufar listing URL into a deterministic semantic `CanonicalQuery` without performing network requests and without leaking Kufar search-API request shape into the shared domain contract.

The parser is the product boundary for pasted monitor URLs: it must preserve user intent, reject non-Kufar/non-listing inputs explicitly, and retain unknown non-transport query parameters for later URL/API building.

## Contract

`shared/canonical-query.ts` owns the shared data contract:

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

The fields are semantic facts extracted from the pasted user URL. API-specific mappings such as `operation: "kupit"` → `typ=sell` are explicitly outside this task and belong to `1.1.2`.

## Accepted hosts and protocols

- Accept only `http:` and `https:` URLs.
- Accept `kufar.by` and any subdomain whose hostname ends with `.kufar.by`.
- Reject lookalike/foreign hosts such as `evilkufar.by`.
- `auto.kufar.by` is syntactically accepted by this parser. Scope/routing decisions belong to `1.1.3`.

## Listing-route grammar

A listing URL must have `/l` as its first path segment. Non-listing routes such as `/item/...` are rejected.

### Goods-style hosts

For `www.kufar.by`, `kufar.by`, and other non-real-estate Kufar hosts:

- `r~<value>` → `region`
- `q~<value>` → `query`
- `bez-posrednikov` → `sellerType: "bez-posrednikov"`
- first other path segment → `category`
- subsequent unrecognized path segments → `pathFilters` in source order

Examples:

- `/l/r~minsk/igry-i-pristavki/q~ps5` → region `minsk`, category `igry-i-pristavki`, query `ps5`
- `/l/elektronika` → category `elektronika`, region `null`

### Real-estate host

For `re.kufar.by` the observed user-route grammar is positional:

- first segment after `/l` → `region`
- operation segment `kupit` or `snyat` → `operation`
- next segment → `category`
- `bez-posrednikov` → seller marker
- remaining unrecognized path segments → `pathFilters`

Example:

`/l/minsk/kupit/kvartiru/1k` → region `minsk`, operation `kupit`, category `kvartiru`, pathFilters `["1k"]`.

The parser must not invent API semantics for unverified rental behavior.

## Query-string rules

- `sort` is recognized semantically and stored in `sort`.
- `cursor` and `size` are pagination/transport state and are discarded. A URL copied from page 2 must represent the same monitor identity as page 1.
- all other parameters, including observed `cur=USD`, are retained in `extraParams`.
- repeated unknown keys are retained as arrays in original value order.
- empty unknown values are retained as empty strings rather than dropped.

Recognized semantic parameters are not duplicated in `extraParams`.

## Errors

`shared/kufar-url.ts` exposes `KufarUrlParseError` with a stable `code`:

```ts
export type KufarUrlParseErrorCode =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'foreign-host'
  | 'not-listing-url'
```

Messages explain the human-readable reason; callers must be able to branch on `code` without parsing text.

## TDD evidence

The first code commit for this task contains only parser tests. It is intentionally RED before `shared/canonical-query.ts` and `shared/kufar-url.ts` exist. The RED result is verified from the CI run for that exact commit. Production implementation follows in a separate GREEN commit.

The task originally named `tests/unit/url-parse.spec.ts`, while the repository's Vitest config intentionally discovers `tests/**/*.test.ts`. To preserve existing test discovery rather than broaden global configuration for one task, the aligned test path is `tests/unit/url-parse.test.ts`.

## Non-goals

- no network requests;
- no category-existence/taxonomy validation;
- no conversion to search API parameters (`cat`, `rgn`, `gtsy`, `typ`, etc.);
- no source routing or Auto support decision;
- no cursor persistence;
- no normalization beyond URL decoding and the explicit semantics above.
