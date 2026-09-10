import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import { createScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import { KufarSourceRequestError } from '../../electron/worker/kufar-source-request-error'
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

const coldStartResult = {
  cycleKind: 'cold-start' as const,
  baselineCount: 0,
  pagesRead: 1,
  nextWatermark: {
    boundaryTime: '2026-09-10T00:00:00.000Z',
    boundaryIds: ['listing-1'],
  },
}

function executorDependencies() {
  const runCreate = vi.fn().mockResolvedValue({ id: 9001 })
  const runUpdate = vi.fn().mockResolvedValue(undefined)
  const prisma = {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ query: persistedQuery }),
    },
    run: {
      create: runCreate,
      update: runUpdate,
    },
  } as unknown as PrismaClient
  const electronicsAdapter = { fetchPage: vi.fn() } as unknown as SourceAdapter
  const realEstateAdapter = { fetchPage: vi.fn() } as unknown as SourceAdapter
  const adapters = createSourceAdapterRegistry({
    electronics: electronicsAdapter,
    'real-estate': realEstateAdapter,
  })
  const descriptionLoader = { ensureDescription: vi.fn() }

  return { prisma, runCreate, runUpdate, electronicsAdapter, adapters, descriptionLoader }
}

describe('createScheduledMonitorRunExecutor', () => {
  it('routes the persisted monitor query and runs one existing monitor cycle', async () => {
    const { prisma, electronicsAdapter, adapters, descriptionLoader } = executorDependencies()
    const runInputs: unknown[] = []
    const runCycle = vi.fn(async (input: unknown) => {
      runInputs.push(input)
      return coldStartResult
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

  it('creates a running journal entry before the scheduled cycle starts', async () => {
    const { prisma, adapters, descriptionLoader } = executorDependencies()
    let releaseCycle!: () => void
    let cycleEntered!: () => void
    const cycleRelease = new Promise<void>((resolve) => {
      releaseCycle = resolve
    })
    const cycleStarted = new Promise<void>((resolve) => {
      cycleEntered = resolve
    })
    const runCycle = vi.fn(async () => {
      cycleEntered()
      await cycleRelease
      return coldStartResult
    })
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      adapters,
      maxPages: 5,
      descriptionLoader,
      runCycle: runCycle as never,
    })

    const execution = executor(17)
    await cycleStarted

    expect(prisma.run.create).toHaveBeenCalledWith({
      data: {
        monitorId: 17,
        startedAt: expect.any(Date),
        outcome: 'running',
      },
      select: { id: true },
    })
    expect(runCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId: 17,
        runId: 9001,
      }),
    )

    releaseCycle()
    await execution
  })

  it('skips a concurrent trigger for the same monitor and records the overlap', async () => {
    const { prisma, adapters, descriptionLoader } = executorDependencies()
    let releaseFirst!: () => void
    let firstEntered!: () => void
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      firstEntered = resolve
    })
    let cycleCalls = 0
    const runCycle = vi.fn(async () => {
      cycleCalls += 1
      if (cycleCalls === 1) {
        firstEntered()
        await firstRelease
      }
      return coldStartResult
    })
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      adapters,
      maxPages: 5,
      descriptionLoader,
      runCycle: runCycle as never,
    })

    const firstRun = executor(17)
    await firstStarted
    const secondResult = await executor(17)
    releaseFirst()
    await firstRun

    expect(secondResult).toEqual({ cycleKind: 'skipped-overlap' })
    expect(runCycle).toHaveBeenCalledTimes(1)
    expect(prisma.run.create).toHaveBeenCalledWith({
      data: {
        monitorId: 17,
        startedAt: expect.any(Date),
        finishedAt: expect.any(Date),
        outcome: 'skipped',
        seen: 0,
        matched: 0,
        error: null,
        httpStatus: null,
        degradedLevel: null,
      },
    })
  })

  it('releases the monitor lock when a scheduled run fails', async () => {
    const { prisma, adapters, descriptionLoader } = executorDependencies()
    let cycleCalls = 0
    const runCycle = vi.fn(async () => {
      cycleCalls += 1
      if (cycleCalls === 1) throw new Error('cycle failed')
      return coldStartResult
    })
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      adapters,
      maxPages: 5,
      descriptionLoader,
      runCycle: runCycle as never,
    })

    await expect(executor(17)).rejects.toThrow('cycle failed')
    await expect(executor(17)).resolves.toEqual(coldStartResult)

    expect(runCycle).toHaveBeenCalledTimes(2)
  })

  it('records a structured safe source failure on the running journal row', async () => {
    const { prisma, runUpdate, adapters, descriptionLoader } = executorDependencies()
    const failure = new KufarSourceRequestError(
      'request https://www.kufar.by/search?token=top-secret failed',
      {
        ok: false,
        kind: 'permanent',
        code: 'http-4xx',
        status: 403,
        attempts: 1,
        message: 'Kufar returned permanent HTTP 403',
      },
    )
    const runCycle = vi.fn().mockRejectedValue(failure)
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      adapters,
      maxPages: 5,
      descriptionLoader,
      runCycle: runCycle as never,
    })

    await expect(executor(17)).rejects.toBe(failure)

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 9001 },
      data: {
        finishedAt: expect.any(Date),
        durationMs: expect.any(Number),
        outcome: 'error',
        seen: 0,
        matched: 0,
        error: 'Kufar returned permanent HTTP 403',
        errorCategory: 'source',
        errorCode: 'http-4xx',
        httpStatus: 403,
        degradedLevel: null,
      },
    })
    expect(JSON.stringify(runUpdate.mock.calls)).not.toContain('top-secret')
  })

  it('sanitizes unexpected failures before writing them to the journal', async () => {
    const { prisma, runUpdate, adapters, descriptionLoader } = executorDependencies()
    const failure = new Error('DATABASE_URL=postgres://secret-password token=secret-token')
    const runCycle = vi.fn().mockRejectedValue(failure)
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      adapters,
      maxPages: 5,
      descriptionLoader,
      runCycle: runCycle as never,
    })

    await expect(executor(17)).rejects.toBe(failure)

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 9001 },
      data: {
        finishedAt: expect.any(Date),
        durationMs: expect.any(Number),
        outcome: 'error',
        seen: 0,
        matched: 0,
        error: 'Unexpected monitor run failure',
        errorCategory: 'internal',
        errorCode: 'unexpected',
        httpStatus: null,
        degradedLevel: null,
      },
    })
    const persisted = JSON.stringify(runUpdate.mock.calls)
    expect(persisted).not.toContain('secret-password')
    expect(persisted).not.toContain('secret-token')
  })

  it('does not serialize scheduled runs for different monitors', async () => {
    const { prisma, adapters, descriptionLoader } = executorDependencies()
    let releaseFirst!: () => void
    let firstEntered!: () => void
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      firstEntered = resolve
    })
    const completed: number[] = []
    const runCycle = vi.fn(async (input: { monitorId: number }) => {
      if (input.monitorId === 17) {
        firstEntered()
        await firstRelease
      }
      completed.push(input.monitorId)
      return coldStartResult
    })
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      adapters,
      maxPages: 5,
      descriptionLoader,
      runCycle: runCycle as never,
    })

    const firstRun = executor(17)
    await firstStarted
    await executor(18)

    expect(completed).toEqual([18])

    releaseFirst()
    await firstRun
    expect(completed).toEqual([18, 17])
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
