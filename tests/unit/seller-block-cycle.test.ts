import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runMonitorCycle } from '../../electron/worker/monitor-cycle'
import type { PrismaClient } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'

const dependencyMocks = vi.hoisted(() => ({
  runColdStartMonitor: vi.fn(),
  runIncrementalMonitor: vi.fn(),
}))

vi.mock('../../electron/worker/cold-start-monitor-run', () => ({
  runColdStartMonitor: dependencyMocks.runColdStartMonitor,
}))

vi.mock('../../electron/worker/incremental-monitor-run', () => ({
  runIncrementalMonitor: dependencyMocks.runIncrementalMonitor,
}))

const MONITOR_ID = 2_302
const adapter = { fetchPage: vi.fn() } as SourceAdapter

function makeListing(accountId: string | null, listId = `listing-${accountId ?? 'null'}`): Listing {
  return {
    listId,
    title: 'Seller blacklist candidate',
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: `https://www.kufar.by/item/${listId}`,
    region: 'minsk',
    accountId,
    isCompany: false,
    listTime: '2026-09-12T08:00:00.000Z',
    description: null,
    raw: { source: 'test' },
  }
}

function prismaWithCursor(
  boundaryTime: Date | null | 'missing',
  sellerBlocks: Array<{ accountId: string }> = [],
) {
  const cursor = boundaryTime === 'missing' ? null : { boundaryTime }
  const sellerBlockFindMany = vi.fn().mockResolvedValue(sellerBlocks)
  const prisma = {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ cursor }),
    },
    sellerBlock: {
      findMany: sellerBlockFindMany,
    },
  } as unknown as PrismaClient

  return { prisma, sellerBlockFindMany }
}

beforeEach(() => {
  dependencyMocks.runColdStartMonitor.mockReset().mockResolvedValue({
    baselineCount: 0,
    pagesRead: 1,
    nextWatermark: {
      boundaryTime: '2026-09-12T08:00:00.000Z',
      boundaryIds: ['baseline'],
    },
  })
  dependencyMocks.runIncrementalMonitor.mockReset().mockResolvedValue({
    kind: 'complete',
    newListings: [],
    nextWatermark: {
      boundaryTime: '2026-09-12T08:00:00.000Z',
      boundaryIds: ['incremental'],
    },
    pagesRead: 1,
    possibleMiss: false,
    checkpoint: null,
  })
})

describe('runMonitorCycle seller blacklist', () => {
  it('loads one SellerBlock snapshot and composes it before a caller prefilter', async () => {
    const { prisma, sellerBlockFindMany } = prismaWithCursor(
      new Date('2026-09-12T07:59:00.000Z'),
      [{ accountId: 'blocked-account' }],
    )
    const callerAccept = vi.fn(async (listing: Listing) => listing.listId !== 'caller-rejected')
    const callerPrefilter = { accept: callerAccept }

    await runMonitorCycle({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 3,
      prefilter: callerPrefilter,
    })

    expect(sellerBlockFindMany).toHaveBeenCalledTimes(1)
    expect(sellerBlockFindMany).toHaveBeenCalledWith({
      select: { accountId: true },
    })

    const effectivePrefilter = dependencyMocks.runIncrementalMonitor.mock.calls[0]?.[0]
      ?.prefilter as { accept(listing: Listing): Promise<boolean> } | undefined
    expect(effectivePrefilter).toBeDefined()

    await expect(effectivePrefilter?.accept(makeListing('blocked-account'))).resolves.toBe(false)
    expect(callerAccept).not.toHaveBeenCalled()

    await expect(effectivePrefilter?.accept(makeListing('allowed-account'))).resolves.toBe(true)
    await expect(effectivePrefilter?.accept(makeListing(null))).resolves.toBe(true)
    await expect(effectivePrefilter?.accept(makeListing('', 'empty-account'))).resolves.toBe(true)
    await expect(
      effectivePrefilter?.accept(makeListing('allowed-account', 'caller-rejected')),
    ).resolves.toBe(false)
  })

  it('refreshes the SellerBlock snapshot for every incremental cycle', async () => {
    const { prisma, sellerBlockFindMany } = prismaWithCursor(
      new Date('2026-09-12T07:59:00.000Z'),
    )
    sellerBlockFindMany
      .mockResolvedValueOnce([{ accountId: 'blocked-first' }])
      .mockResolvedValueOnce([{ accountId: 'blocked-second' }])

    await runMonitorCycle({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 })
    await runMonitorCycle({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 })

    expect(sellerBlockFindMany).toHaveBeenCalledTimes(2)

    const firstPrefilter = dependencyMocks.runIncrementalMonitor.mock.calls[0]?.[0]?.prefilter as
      | { accept(listing: Listing): Promise<boolean> }
      | undefined
    const secondPrefilter = dependencyMocks.runIncrementalMonitor.mock.calls[1]?.[0]?.prefilter as
      | { accept(listing: Listing): Promise<boolean> }
      | undefined
    expect(firstPrefilter).toBeDefined()
    expect(secondPrefilter).toBeDefined()

    await expect(firstPrefilter?.accept(makeListing('blocked-first'))).resolves.toBe(false)
    await expect(firstPrefilter?.accept(makeListing('blocked-second'))).resolves.toBe(true)
    await expect(secondPrefilter?.accept(makeListing('blocked-first'))).resolves.toBe(true)
    await expect(secondPrefilter?.accept(makeListing('blocked-second'))).resolves.toBe(false)
  })

  it.each(['missing', null] as const)('does not query SellerBlock during %s cold start', async (state) => {
    const { prisma, sellerBlockFindMany } = prismaWithCursor(state, [
      { accountId: 'irrelevant-during-baseline' },
    ])

    await runMonitorCycle({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 })

    expect(sellerBlockFindMany).not.toHaveBeenCalled()
    expect(dependencyMocks.runColdStartMonitor).toHaveBeenCalledTimes(1)
    expect(dependencyMocks.runIncrementalMonitor).not.toHaveBeenCalled()
  })
})
