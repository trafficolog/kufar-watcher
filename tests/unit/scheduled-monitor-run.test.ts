import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import { createScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import { createSourceAdapterRegistry } from '../../shared/source-adapter-registry'
import type { SourceAdapter } from '../../shared/source-adapter'

const persistedQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: null,
  region: null,
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

function executorDependencies() {
  const prisma = {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ query: persistedQuery }),
    },
  } as unknown as PrismaClient
  const electronicsAdapter = { fetchPage: vi.fn() } as unknown as SourceAdapter
  const realEstateAdapter = { fetchPage: vi.fn() } as unknown as SourceAdapter
  const adapters = createSourceAdapterRegistry({
    electronics: electronicsAdapter,
    'real-estate': realEstateAdapter,
  })
  const descriptionLoader = { ensureDescription: vi.fn() }

  return { prisma, electronicsAdapter, adapters, descriptionLoader }
}

describe('createScheduledMonitorRunExecutor', () => {
  it('routes the persisted monitor query and runs one existing monitor cycle', async () => {
    const { prisma, electronicsAdapter, adapters, descriptionLoader } = executorDependencies()
    const runInputs: unknown[] = []
    const runCycle = vi.fn(async (input: unknown) => {
      runInputs.push(input)
      return {
        cycleKind: 'cold-start' as const,
        baselineCount: 0,
        pagesRead: 1,
        nextWatermark: {
          boundaryTime: '2026-09-10T00:00:00.000Z',
          boundaryIds: ['listing-1'],
        },
      }
    })
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      adapters,
      maxPages: 5,
      descriptionLoader,
      runCycle: runCycle as never,
    })

    await executor(17)

    expect(prisma.monitor.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 17 },
      select: { query: true },
    })
    expect(runInputs).toEqual([
      expect.objectContaining({
        prisma,
        monitorId: 17,
        adapter: electronicsAdapter,
        maxPages: 5,
        descriptionLoader,
      }),
    ])
    expect(runCycle).toHaveBeenCalledTimes(1)
  })

  it.each([0, 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid page cap %s before a scheduled run can start',
    (maxPages) => {
      const { prisma, adapters, descriptionLoader } = executorDependencies()

      expect(() =>
        createScheduledMonitorRunExecutor({
          prisma,
          adapters,
          maxPages,
          descriptionLoader,
        }),
      ).toThrow(/page cap/i)
      expect(prisma.monitor.findUniqueOrThrow).not.toHaveBeenCalled()
    },
  )
})
