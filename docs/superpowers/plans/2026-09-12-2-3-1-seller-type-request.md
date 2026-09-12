# 2.3.1 Seller Type Native Request — Implementation Plan

**Date:** 2026-09-12  
**Branch:** `feat/2.3.1-seller-type-request`  
**Base:** `main@0d0a301733f1f3151803c0fb93bbc7f02080e7ba`

## Goal

Promote seller type from an opaque URL marker to a typed canonical query field and send it as Kufar's confirmed native `cmp` request parameter for the two API mappings already supported by the project.

## Confirmed external contract

A bounded live recon was executed before production changes. GitHub Actions `probe-2-3-1-seller-type #3` (run id `34680955449`) exercised the current `search-api/v2` endpoint and current listing page.

Evidence:

- Page state defines the seller filter as `name: company_ad`, `url_name: cmp`, `type: bool`.
- `bez-posrednikov` / `cmp=0` / `cmp=false` select private sellers.
- `cmp=1` / `cmp=true` select companies.
- Electronics: baseline total 1256; `cmp=0` total 802 with 30/30 private ads; `cmp=1` total 454 with 30/30 company ads.
- Real estate: baseline total 12036; `cmp=0` total 816 with 30/30 private ads; `cmp=1` total 11222 with 30/30 company ads.

The temporary probe workflow is diagnostic only and must be deleted before final verification.

## Design

### Canonical model

Add:

```ts
export type SellerType = 'private' | 'company'
```

and change `CanonicalQuery.sellerType` to `SellerType | null`.

### Parse normalization

Seller semantics are consumed before `extraParams` are built:

- private path marker `bez-posrednikov` → `private`
- query `cmp=0|false` → `private`
- query `cmp=1|true` → `company`
- repeated equal encodings are accepted as one semantic value
- invalid values or conflicting path/query values raise `KufarUrlParseError` with stable code `invalid-seller-filter`
- `cmp` is never retained in `extraParams`

### Listing URL build

- private uses the existing canonical `bez-posrednikov` path marker
- company uses query parameter `cmp=1`
- `cmp` from `extraParams` is ignored/rejected by type-level construction path so the semantic field stays the single source of truth
- existing sort/extras determinism is preserved

### API URL build

Keep the two existing mapping predicates and relax only their old `sellerType === null` restriction. Add semantic request params after mapping:

- private → `cmp=0`
- company → `cmp=1`
- null → omit `cmp`

Do not broaden category/region/operation mapping support.

### Persisted compatibility

`Monitor.query` may contain historical `sellerType: 'bez-posrednikov'`. Update persisted-query parsing to normalize that one legacy value to `private`. Reject other unknown seller strings. No Prisma migration is needed because both `Monitor.query` and `Monitor.sellerType` already store JSON/string values.

## TDD sequence

1. Create task card and mark epic 2.3 in progress; refresh docs rollups so documentation checks do not mask test RED.
2. Add parser tests for private/company normalization, invalid/conflicting `cmp`, and absence of `cmp` from extras.
3. Add URL builder tests for listing round-trip and `cmp=0|1` in electronics + real-estate API URLs.
4. Add persisted-query compatibility test for legacy `bez-posrednikov` and rejection of unknown seller values.
5. Run canonical CI and capture RED at Unit tests with docs consistency already green.
6. Implement the minimum shared-type/parser/builder/persistence changes.
7. Run canonical CI and require full GREEN: audit, docs, unit tests, typecheck, lint, formatting, PostgreSQL integration, build, dev/prod smoke.
8. Update `docs/superpowers/specs/kufar-api-contract.md` with the confirmed `cmp` contract and task evidence.
9. Close task `2.3.1` as `done/aligned`; keep epic 2.3 in progress because `2.3.2` remains.
10. Refresh generated docs, delete all temporary recon/docs helper workflows, then run canonical CI again on the exact final HEAD.

## Files expected to change

- `shared/canonical-query.ts`
- `shared/kufar-url.ts`
- `electron/worker/monitor-config-persistence.ts`
- `tests/unit/url-parse.test.ts`
- `tests/unit/url-build.test.ts`
- `tests/unit/monitor-config-persistence.test.ts`
- `docs/tasks/2-3-1-seller-type-request.md`
- `docs/epics/2-3-seller-filter.md`
- `docs/superpowers/specs/kufar-api-contract.md`
- generated docs/status rollups

Temporary workflows used for recon/docs refresh must not appear in the final diff.

## Out of scope

- Seller blacklist / `SellerBlock` query and post-filter pipeline (`2.3.2`)
- UI controls for seller blacklist or seller type
- additional Kufar categories
- speculative `otype`, `ot`, or other historical parameters
- Prisma schema changes
