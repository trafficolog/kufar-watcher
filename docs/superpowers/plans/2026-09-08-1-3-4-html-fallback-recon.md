# HTML Fallback Recon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish primary live evidence for search-page embedded structured state and pagination for both supported Kufar verticals before any HTML fallback production code is written.

**Architecture:** This plan implements only the recon gate from the approved 1.3.4 design. It captures dated source fixtures and contract evidence for Electronics and Real Estate, then either proves a structured HTML fallback is implementable without DOM scraping or records a hard contract blocker. A second implementation plan is written only after these exact carriers, JSON paths, and pagination semantics are known.

**Tech Stack:** Opera Browser Connector/manual browser source view for bounded live recon, GitHub repository fixtures/docs, GitHub Actions verify, npm 11.4.2 / Node 22 for docs consistency.

**Spec:** `docs/superpowers/specs/2026-09-08-1-3-4-html-fallback-design.md`

## Global Constraints

- Primary JSON API remains authoritative; recon must not turn HTML into the normal path.
- Do not use proxy, VPN, fingerprint/User-Agent spoofing, parallel probes, login, CAPTCHA bypass, or any other access-control bypass.
- Stop live probing on `429`; do not switch hosts/channels to work around it.
- Stop the affected live recon sequence on `403`; record it as unavailable evidence rather than retrying around access control.
- DOM/card scraping is Post-MVP and must not be used as evidence for 1.3.4.
- Only structured state embedded in raw search-page HTML qualifies.
- Do not decode or synthesize opaque cursors.
- Both Electronics and Real Estate must satisfy the gate before 1.3.4 can be marked complete.
- No production TypeScript is modified by this plan.
- Branch: `feat/1.3.4-html-fallback`; baseline design SHA `8409d6e2c0b401c64cc76abe0d321abe67c0c0e0`, whose verify run #348 is GREEN.

---

### Task 1: Capture Electronics search-page embedded-state evidence

**Files:**
- Create: `docs/recon/kufar-html-fallback-2026-09-08.md`
- Create when evidence exists: `tests/fixtures/kufar/2026-09-08-electronics-search-page-1-embedded.html`
- Create when page-2 evidence exists: `tests/fixtures/kufar/2026-09-08-electronics-search-page-2-embedded.html`

**Interfaces:**
- Consumes: public listing URL `https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5`; existing primary search contract and opaque cursor semantics from `docs/recon/kufar-electronics-2026-09-07.md`.
- Produces: exact script/state carrier, exact JSON path to search records, exact pagination object/path, and evidence whether the user-facing HTML route can represent the next-page request without interpreting the opaque token.

- [ ] **Step 1: Open the Electronics search page through the normal browser session**

Open exactly:

```text
https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5
```

Record final browser URL and whether the page loads normally. One navigation only; do not automate repeated requests.

- [ ] **Step 2: Inspect raw source for structured state**

Open the raw source for the same page (`view-source:` in the user browser). Search first for these literal markers because one is already confirmed on an Electronics detail page:

```text
__NEXT_DATA__
initialState
pagination
ads
```

Copy the complete structured-state `<script ...>...</script>` element that contains the search data. If no such element exists, record that exact negative result; do not inspect CSS selectors/cards as a substitute.

- [ ] **Step 3: Save a source-accurate page-1 fixture**

Create `tests/fixtures/kufar/2026-09-08-electronics-search-page-1-embedded.html` containing a minimal valid HTML wrapper plus the exact copied script element, without rewriting JSON values:

```html
<!doctype html>
<html>
  <body>
    <!-- exact live structured-state script element goes here unchanged -->
  </body>
</html>
```

The comment is an instruction for plan execution, not fixture content: replace it with the observed exact script element before committing. If no qualifying structured-state script exists, do not create a fake fixture.

- [ ] **Step 4: Determine the exact search payload path**

Parse the copied script JSON as data and identify the shortest exact property path whose value contains the search records. Verify that representative entries expose or losslessly contain the fields required by `normalizeElectronicsSearchPage`: `ad_id`, `list_time`, `subject`, `price_byn`, `currency`, `account_id`, `company_ad`, plus pagination needed for `nextCursor`.

Record the exact property path and observed carrier id/type in `docs/recon/kufar-html-fallback-2026-09-08.md`. Do not infer names from the detail-page path.

- [ ] **Step 5: Probe page 2 using only an observed user-facing pagination mechanism**

Use the page-1 HTML state/user URL to identify the actual next-page URL or parameterization. It is acceptable only when the mapping is explicitly present in the structured state or browser URL. Do not decode the primary API cursor to manufacture an HTML page number.

Open that exact next-page URL once. Capture the corresponding complete structured-state script into `tests/fixtures/kufar/2026-09-08-electronics-search-page-2-embedded.html`.

Verify page 2 contains a non-overlapping representative listing id and a next-page representation. If the HTML route exposes only page 1 or cannot map `SourcePageRequest.cursor` without interpreting opaque internals, record the vertical as `blocked: pagination contract unavailable`.

- [ ] **Step 6: Commit Electronics recon evidence**

Commit only observed evidence and the recon note:

```bash
git add docs/recon/kufar-html-fallback-2026-09-08.md tests/fixtures/kufar/2026-09-08-electronics-search-page-*-embedded.html
git commit -m "docs(1.3.4): capture electronics HTML fallback evidence"
```

When using GitHub-native execution, create the same files on the feature branch and use the same commit message.

---

### Task 2: Capture Real Estate search-page embedded-state evidence

**Files:**
- Modify: `docs/recon/kufar-html-fallback-2026-09-08.md`
- Create when evidence exists: `tests/fixtures/kufar/2026-09-08-realestate-search-page-1-embedded.html`
- Create when page-2 evidence exists: `tests/fixtures/kufar/2026-09-08-realestate-search-page-2-embedded.html`

**Interfaces:**
- Consumes: public listing URL `https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD`; existing primary Real Estate cursor evidence from `docs/recon/kufar-realestate-2026-09-07.md`.
- Produces: independently confirmed Real Estate carrier/path/pagination evidence; Electronics paths must not be copied across by assumption.

- [ ] **Step 1: Open the Real Estate search page once**

Open exactly:

```text
https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD
```

Record final URL and load result. If this request returns `403`, stop Real Estate live recon and record `blocked: access control`; do not retry through another channel.

- [ ] **Step 2: Inspect raw source for structured state**

Open raw source and search for:

```text
__NEXT_DATA__
initialState
pagination
ads
listing
```

Copy the complete structured-state script containing search results. Absence of structured state is a legitimate blocker and must be recorded rather than replaced by DOM parsing.

- [ ] **Step 3: Save the page-1 fixture and establish the exact payload path**

Save the exact script inside a minimal HTML wrapper as `tests/fixtures/kufar/2026-09-08-realestate-search-page-1-embedded.html`.

Verify the embedded records expose or losslessly contain the fields required by `normalizeRealEstateSearchPage`: `ad_id`, `list_time`, `subject`, price fields/currency, `account_id`, `company_ad`, relevant `ad_parameters`, and pagination. Record the exact carrier and property path independently of Electronics.

- [ ] **Step 4: Probe page 2 only through explicit structured/user-layer pagination**

Follow the exact next-page URL/parameters exposed by the page-1 browser URL or structured state. Capture the page-2 embedded script as `tests/fixtures/kufar/2026-09-08-realestate-search-page-2-embedded.html`.

Confirm a non-overlapping representative listing id and next-page representation. If `SourcePageRequest.cursor` cannot be honored without decoding/synthesizing pagination internals, record `blocked: pagination contract unavailable`.

- [ ] **Step 5: Commit Real Estate recon evidence**

```bash
git add docs/recon/kufar-html-fallback-2026-09-08.md tests/fixtures/kufar/2026-09-08-realestate-search-page-*-embedded.html
git commit -m "docs(1.3.4): capture real-estate HTML fallback evidence"
```

When blocked before fixtures can be captured, commit the bounded negative evidence in the recon document only.

---

### Task 3: Update the authoritative contract and decide the recon gate

**Files:**
- Modify: `docs/superpowers/specs/kufar-api-contract.md`
- Modify: `docs/recon/kufar-html-fallback-2026-09-08.md`
- Create after a passing gate: `docs/superpowers/plans/2026-09-08-1-3-4-html-fallback.md`

**Interfaces:**
- Consumes: the exact Electronics and Real Estate evidence from Tasks 1-2.
- Produces: one explicit per-vertical gate result and, only when both pass, the full TDD implementation plan with concrete script ids, property paths, pagination mechanics, fixture filenames, types, tests, and commits.

- [ ] **Step 1: Write the evidence matrix**

Add a table to `docs/recon/kufar-html-fallback-2026-09-08.md` with these columns and one row per vertical:

```text
Vertical | Search URL | Carrier | Search payload path | Pagination path/mechanism | Page 2 proven | Required fields present | Gate
```

`Gate` must be exactly `pass` or a concrete `blocked: <reason>` derived from observed evidence.

- [ ] **Step 2: Update `kufar-api-contract.md` with only confirmed facts**

For each passing vertical, record:

- exact search URL used;
- exact structured script/state carrier;
- exact search payload property path;
- exact pagination path/mechanism;
- dated fixture names;
- whether embedded records are already primary-search shaped or require a lossless projection before the existing normalizer.

For blocked verticals, record the blocker and retain JSON API as the only confirmed traversal channel.

- [ ] **Step 3: Run docs consistency before any production plan**

Run:

```bash
npm run docs:ops:check
```

Expected: exit 0. In GitHub-native execution, push the docs commit and require the branch `verify` workflow for the exact SHA to finish GREEN before treating the recon result as accepted.

- [ ] **Step 4: Apply the hard gate**

Proceed to the production implementation plan only when both rows are `pass` and both page-2 semantics can satisfy `SourcePageRequest.cursor` without decoding or synthesizing the opaque cursor.

If either vertical is blocked, stop 1.3.4 implementation and report the exact evidence blocker. Do not weaken the approved scope to one vertical without a new explicit design decision.

- [ ] **Step 5: Write the second implementation plan when the gate passes**

Create `docs/superpowers/plans/2026-09-08-1-3-4-html-fallback.md` using `superpowers:writing-plans`. It must use the observed literal carrier/path/pagination values and contain separate RED→GREEN tasks for:

1. common `KufarSourceRequestError` hierarchy;
2. embedded-state extractor;
3. Electronics embedded-state decoder/fallback adapter;
4. Real Estate embedded-state decoder/fallback adapter;
5. `KufarResilientSource` policy matrix;
6. mandatory degradation-event publication;
7. task/contract/docs rollup and exact-SHA verification.

Do not write production code in the same commit as this plan.

- [ ] **Step 6: Commit the contract/recon gate**

```bash
git add docs/recon/kufar-html-fallback-2026-09-08.md docs/superpowers/specs/kufar-api-contract.md docs/superpowers/plans/2026-09-08-1-3-4-html-fallback.md
git commit -m "docs(1.3.4): lock HTML fallback search contract"
```

If the gate is blocked, omit the production implementation-plan path and commit only the recon/contract evidence with message:

```bash
git commit -m "docs(1.3.4): record HTML fallback blocker"
```

---

## Self-review checklist

- Every live probe is bounded and sequential.
- No DOM/card parsing appears as an accepted fallback source.
- No 429/403 workaround is permitted.
- Electronics and Real Estate evidence are independent.
- Page 2 is required; a page-1-only HTML state cannot satisfy traversal.
- Opaque cursors are never decoded or synthesized.
- Fixture contents are copied from observed structured state, not invented.
- `kufar-api-contract.md` is updated before production planning.
- No production code is touched by this recon plan.
