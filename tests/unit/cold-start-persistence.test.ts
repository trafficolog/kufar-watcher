import { describe, expect, it, vi } from 'vitest'

import {
  persistColdStartBaselineTransaction,
  StaleColdStartError,
  type ColdStartPersistenceInput,
} from '../../electron/worker/cold-start-persistence'
import type { Prisma } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'

const MONITOR_ID = 1_403
const SOURCE_URL = 'https://www.kufar.by/l/electronics?query=phone'
const QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: ['phones'],
  extraParams: {},
}
const STARTED_AT = new Date('2026-09-08T12:00:00.000Z')
const FINISHED_AT = new Date('2026-09-08T12:00:02.000Z')
const CURSOR_UPDATED_AT = new Date('2026-09-08T11:55:00.000Z')

const LISTING: Listing = {
  listId: 'baseline-a',
  title: 'Baseline A',
  priceKind: 'fixed',
  priceAmount: '100.00',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/baseline-a',
  region: 'minsk',
  accountId: null,
  isCompany: false,
  listTime: '2026-09-08T11:59:00.000Z',
  description: null,
  raw: { fixture: 'baseline-a' },
}

function input(
  overrides: Partial<ColdStartPersistenceInput> = {},
): ColdStartPersistenceInput {
  return {
    monitorId: MONITOR_ID,
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    source: { sourceUrl: SOURCE_URL, query: QUERY },
    expectedCursor: { kind: 'missing' },
    listings: [LISTING],
    nextWatermark: {
      boundaryTime: LISTING.listTime,
      boundaryIds: [LISTING.listId],
    },
    ...overrides,
  }
}

function makeTx(options: {
  sourceUrl?: string
  query?: unknown
  cursor?: { boundaryTime: Date | null; updatedAt: Date } | null
} = {}) {
  const queryRaw = vi.fn().mockResolvedValue([{ id: MONITOR_ID }])
  const monitorFindUnique = vi.fn().mockResolvedValue({
    sourceUrl: options.sourceUrl ?? SOURCE_URL,
    query: options.query ?? QUERY,
  })
  const cursorFindUnique = vi.fn().mockResolvedValue(options.cursor ?? null)
  const listingUpsert = vi.fn().mockResolvedValue(undefined)
  const cursorUpsert = vi.fn().mockResolvedValue(undefined)
  const runCreate = vi.fn().mockResolvedValue(undefined)

  const tx = {
    $queryRaw: queryRaw,
    monitor: { findUnique: monitorFindUnique },
    monitorCursor: { findUnique: cursorFindUnique, upsert: cursorUpsert },
    listing: { upsert: listingUpsert },
    run: { create: runCreate },
  } as unknown as Prisma.TransactionClient

  return {
    tx,
    queryRaw,
    monitorFindUnique,
    cursorFindUnique,
    listingUpsert,
    cursorUpsert,
    runCreate,
  }
}

async function expectNoWrites(mocks: ReturnType<typeof makeTx>): Promise<void> {
  expect(mocks.listingUpsert).not.toHaveBeenCalled()
  expect(mocks.cursorUpsert).not.toHaveBeenCalled()
  expect(mocks.runCreate).not.toHaveBeenCalled()
}

describe('persistColdStartBaselineTransaction', () => {
  it('writes listings, cursor, and a matched=0 success run after preconditions pass', async () => {
    const mocks = makeTx()

    await persistColdStartBaselineTransaction(mocks.tx, input())

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    expect(mocks.listingUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.cursorUpsert).toHaveBeenCalledWith({
      where: { monitorId: MONITOR_ID },
      create: {
        monitorId: MONITOR_ID,
        boundaryTime: new Date(LISTING.listTime),
        boundaryIds: [LISTING.listId],
        lastRunAt: FINISHED_AT,
      },
      update: {
        boundaryTime: new Date(LISTING.listTime),
        boundaryIds: [LISTING.listId],
        lastRunAt: FINISHED_AT,
      },
    })
    expect(mocks.runCreate).toHaveBeenCalledWith({
      data: {
        monitorId: MONITOR_ID,
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        outcome: 'success',
        seen: 1,
        matched: 0,
        error: null,
        httpStatus: null,
        degradedLevel: null,
      },
    })
  })

  it('accepts the same existing uninitialized cursor revision', async () => {
    const mocks = makeTx({
      cursor: { boundaryTime: null, updatedAt: CURSOR_UPDATED_AT },
    })

    await expect(
      persistColdStartBaselineTransaction(
        mocks.tx,
        input({
          expectedCursor: { kind: 'uninitialized', updatedAt: CURSOR_UPDATED_AT },
        }),
      ),
    ).resolves.toBeUndefined()
  })

  it('rejects changed source identity before any baseline write', async () => {
    const mocks = makeTx({ sourceUrl: 'https://www.kufar.by/l/cars' })

    await expect(persistColdStartBaselineTransaction(mocks.tx, input())).rejects.toBeInstanceOf(
      StaleColdStartError,
    )

    await expectNoWrites(mocks)
  })

  it('rejects a competing cursor initialization before any baseline write', async () => {
    const mocks = makeTx({
      cursor: {
        boundaryTime: new Date('2026-09-08T11:59:00.000Z'),
        updatedAt: CURSOR_UPDATED_AT,
      },
    })

    await expect(persistColdStartBaselineTransaction(mocks.tx, input())).rejects.toBeInstanceOf(
      StaleColdStartError,
    )

    await expectNoWrites(mocks)
  })

  it('rejects a changed uninitialized cursor revision before any baseline write', async () => {
    const mocks = makeTx({
      cursor: {
        boundaryTime: null,
        updatedAt: new Date(CURSOR_UPDATED_AT.getTime() + 1_000),
      },
    })

    await expect(
      persistColdStartBaselineTransaction(
        mocks.tx,
        input({
          expectedCursor: { kind: 'uninitialized', updatedAt: CURSOR_UPDATED_AT },
        }),
      ),
    ).rejects.toBeInstanceOf(StaleColdStartError)

    await expectNoWrites(mocks)
  })
})
