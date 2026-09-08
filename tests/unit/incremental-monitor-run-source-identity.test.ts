import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { SourceAdapter } from '../../shared/source-adapter'

const dependencyMocks = vi.hoisted(() => ({
  traverseWatermark: vi.fn(),
  commitMonitorRun: vi.fn(),
}))

vi.mock('../../electron/worker/watermark-traversal', () => ({
  traverseWatermark: dependencyMocks.traverseWatermark,
}))

vi.mock('../../electron/worker/monitor-run-persistence', () => ({
  commitMonitorRun: dependencyMocks.commitMonitorRun,
}))

const QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: ['phones'],
  extraParams: { condition: ['used'] },
}

const SOURCE_URL = 'https://www.kufar.by/l/electronics?query=phone'

beforeEach(() => {
  dependencyMocks.traverseWatermark.mockReset()
  dependencyMocks.commitMonitorRun.mockReset()
  dependencyMocks.traverseWatermark.mockResolvedValue({
    newListings: [],
    nextWatermark: {
      boundaryTime: '2026-09-08T10:00:00.000Z',
      boundaryIds: ['known'],
    },
    pagesRead: 1,
    possibleMiss: false,
  })
  dependencyMocks.commitMonitorRun.mockResolvedValue(undefined)
})

describe('incremental monitor source identity', () => {
  it('passes the source identity loaded before traversal into the persistence commit', async () => {
    const { runIncrementalMonitor } = await import('../../electron/worker/incremental-monitor-run')
    const prisma = {
      monitor: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          sourceUrl: SOURCE_URL,
          query: QUERY,
          cursor: {
            boundaryTime: new Date('2026-09-08T10:00:00.000Z'),
            boundaryIds: ['known'],
          },
        }),
      },
    } as unknown as PrismaClient
    const adapter = { fetchPage: vi.fn() } as SourceAdapter

    await runIncrementalMonitor({ prisma, monitorId: 1_402, adapter, maxPages: 3 })

    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        expectedSource: {
          sourceUrl: SOURCE_URL,
          query: QUERY,
        },
      }),
    )
  })
})
