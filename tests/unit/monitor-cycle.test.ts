import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runMonitorCycle } from '../../electron/worker/monitor-cycle'
import type { PrismaClient } from '../../generated/prisma/client'
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

const MONITOR_ID = 1_403
const adapter = { fetchPage: vi.fn() } as SourceAdapter

function prismaWithCursor(boundaryTime: Date | null | 'missing'): PrismaClient {
  const cursor = boundaryTime === 'missing' ? null : { boundaryTime }
  return {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ cursor }),
    },
  } as unknown as PrismaClient
}

beforeEach(() => {
  dependencyMocks.runColdStartMonitor.mockReset().mockResolvedValue({
    baselineCount: 4,
    pagesRead: 2,
    nextWatermark: {
      boundaryTime: '2026-09-08T12:00:00.000Z',
      boundaryIds: ['a'],
    },
  })
  dependencyMocks.runIncrementalMonitor.mockReset().mockResolvedValue({
    kind: 'complete',
    newListings: [],
    nextWatermark: {
      boundaryTime: '2026-09-08T12:00:00.000Z',
      boundaryIds: ['a'],
    },
    pagesRead: 1,
    possibleMiss: false,
    checkpoint: null,
  })
})

describe('runMonitorCycle', () => {
  it.each(['missing', null] as const)('routes %s cursor state to cold start', async (state) => {
    const prisma = prismaWithCursor(state)

    const result = await runMonitorCycle({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 3,
    })

    expect(dependencyMocks.runColdStartMonitor).toHaveBeenCalledWith({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 3,
      now: undefined,
    })
    expect(dependencyMocks.runIncrementalMonitor).not.toHaveBeenCalled()
    expect(result).toMatchObject({ cycleKind: 'cold-start', baselineCount: 4 })
  })

  it('routes an initialized cursor to the existing incremental path', async () => {
    const prisma = prismaWithCursor(new Date('2026-09-08T11:59:00.000Z'))
    const selector = { select: vi.fn() }
    const now = vi.fn()

    const result = await runMonitorCycle({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 5,
      selector,
      now,
    })

    expect(dependencyMocks.runIncrementalMonitor).toHaveBeenCalledWith({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 5,
      selector,
      now,
    })
    expect(dependencyMocks.runColdStartMonitor).not.toHaveBeenCalled()
    expect(result).toMatchObject({ cycleKind: 'incremental', kind: 'complete', pagesRead: 1 })
  })

  it('forwards prefilter and description loader to the incremental path', async () => {
    const prisma = prismaWithCursor(new Date('2026-09-08T11:59:00.000Z'))
    const prefilter = { accept: vi.fn() }
    const descriptionLoader = { ensureDescription: vi.fn() }
    const policyAwareRunMonitorCycle = runMonitorCycle as unknown as (
      input: Parameters<typeof runMonitorCycle>[0] & {
        prefilter: typeof prefilter
        descriptionLoader: typeof descriptionLoader
      },
    ) => ReturnType<typeof runMonitorCycle>

    await policyAwareRunMonitorCycle({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 5,
      prefilter,
      descriptionLoader,
    })

    expect(dependencyMocks.runIncrementalMonitor).toHaveBeenCalledWith({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 5,
      selector: undefined,
      prefilter,
      descriptionLoader,
      now: undefined,
    })
  })

  it('forwards scheduled run identity and start time to cold start', async () => {
    const prisma = prismaWithCursor('missing')
    const startedAt = new Date('2026-09-10T11:00:00.000Z')
    const scheduledRunMonitorCycle = runMonitorCycle as unknown as (
      input: Parameters<typeof runMonitorCycle>[0] & { startedAt: Date },
    ) => ReturnType<typeof runMonitorCycle>

    await scheduledRunMonitorCycle({
      prisma,
      monitorId: MONITOR_ID,
      runId: 9001,
      startedAt,
      adapter,
      maxPages: 3,
    })

    expect(dependencyMocks.runColdStartMonitor).toHaveBeenCalledWith({
      prisma,
      monitorId: MONITOR_ID,
      runId: 9001,
      startedAt,
      adapter,
      maxPages: 3,
      now: undefined,
    })
  })

  it('forwards scheduled run identity and start time to incremental traversal', async () => {
    const prisma = prismaWithCursor(new Date('2026-09-08T11:59:00.000Z'))
    const startedAt = new Date('2026-09-10T11:00:00.000Z')
    const scheduledRunMonitorCycle = runMonitorCycle as unknown as (
      input: Parameters<typeof runMonitorCycle>[0] & { startedAt: Date },
    ) => ReturnType<typeof runMonitorCycle>

    await scheduledRunMonitorCycle({
      prisma,
      monitorId: MONITOR_ID,
      runId: 9001,
      startedAt,
      adapter,
      maxPages: 3,
    })

    expect(dependencyMocks.runIncrementalMonitor).toHaveBeenCalledWith({
      prisma,
      monitorId: MONITOR_ID,
      runId: 9001,
      startedAt,
      adapter,
      maxPages: 3,
      selector: undefined,
      now: undefined,
    })
  })
})
