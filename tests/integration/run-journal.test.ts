import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SourceDegradationEvent } from '../../electron/worker/kufar-resilient-source'
import { KufarSourceRequestError } from '../../electron/worker/kufar-source-request-error'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import { createScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import type { SourceAdapter } from '../../shared/source-adapter'
import { createSourceAdapterRegistry } from '../../shared/source-adapter-registry'

const integration = process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip
const MONITOR_ID = 916_001
const QUERY = {
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
const degradationEvent: SourceDegradationEvent = {
  kind: 'source-degraded',
  channel: 'html-fallback',
  primaryFailureCode: 'network',
  primaryStatus: null,
}

function executorFor(
  prisma: ReturnType<typeof createPrismaClient>,
  fetchPage: SourceAdapter['fetchPage'],
  runCycle?: Parameters<typeof createScheduledMonitorRunExecutor>[0]['runCycle'],
) {
  const adapter = { fetchPage } as SourceAdapter
  const adapters = createSourceAdapterRegistry({
    electronics: adapter,
    'real-estate': adapter,
  })
  return createScheduledMonitorRunExecutor({
    prisma,
    createRunAdapters: () => adapters,
    maxPages: 2,
    descriptionLoader: { ensureDescription: vi.fn() },
    runCycle,
  })
}

integration('scheduled Run journal', () => {
  let prisma: ReturnType<typeof createPrismaClient>

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  beforeEach(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'run-journal-integration',
        sourceUrl: 'https://fixtures.invalid/run-journal',
        query: QUERY,
        intervalSec: 60,
        keywords: [],
      },
    })
  })

  afterAll(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.$disconnect()
  })

  it('finalizes an empty scheduled traversal as one success row with matched=0', async () => {
    const executor = executorFor(
      prisma,
      vi.fn().mockResolvedValue({ listings: [], nextCursor: null }),
    )

    const result = await executor(MONITOR_ID)

    expect(result).toMatchObject({ cycleKind: 'cold-start', baselineCount: 0, pagesRead: 1 })
    const runs = await prisma.run.findMany({ where: { monitorId: MONITOR_ID } })
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      outcome: 'success',
      seen: 0,
      matched: 0,
      error: null,
      errorCategory: null,
      errorCode: null,
      httpStatus: null,
      degradedLevel: null,
    })
    expect(runs[0]?.finishedAt).not.toBeNull()
    expect(runs[0]?.durationMs).not.toBeNull()
    expect(runs[0]?.durationMs ?? -1).toBeGreaterThanOrEqual(0)
  })

  it('persists html-fallback on the same successful scheduled Run', async () => {
    const onSourceDegradation = vi.fn()
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      createRunAdapters(sink) {
        const adapter = {
          async fetchPage() {
            await sink(degradationEvent)
            await sink(degradationEvent)
            return { listings: [], nextCursor: null }
          },
        } as SourceAdapter
        return createSourceAdapterRegistry({
          electronics: adapter,
          'real-estate': adapter,
        })
      },
      maxPages: 2,
      descriptionLoader: { ensureDescription: vi.fn() },
      onSourceDegradation,
    })

    const result = await executor(MONITOR_ID)

    expect(result).toMatchObject({ cycleKind: 'cold-start', baselineCount: 0, pagesRead: 1 })
    const runs = await prisma.run.findMany({ where: { monitorId: MONITOR_ID } })
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      outcome: 'success',
      seen: 0,
      matched: 0,
      degradedLevel: 'html-fallback',
    })
    expect(runs[0]?.finishedAt).not.toBeNull()
    expect(runs[0]?.durationMs ?? -1).toBeGreaterThanOrEqual(0)
    expect(onSourceDegradation).toHaveBeenCalledOnce()
    expect(onSourceDegradation).toHaveBeenCalledWith(MONITOR_ID, degradationEvent)
  })

  it('finalizes a source failure on the same row without persisting secret text', async () => {
    const failure = new KufarSourceRequestError('request failed with token=integration-secret', {
      ok: false,
      kind: 'permanent',
      code: 'http-4xx',
      status: 403,
      attempts: 1,
      message: 'Kufar returned permanent HTTP 403',
    })
    const executor = executorFor(prisma, vi.fn().mockRejectedValue(failure))

    await expect(executor(MONITOR_ID)).resolves.toEqual({ cycleKind: 'failed-no-retry' })

    const runs = await prisma.run.findMany({ where: { monitorId: MONITOR_ID } })
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      outcome: 'error',
      seen: 0,
      matched: 0,
      error: 'Kufar returned permanent HTTP 403',
      errorCategory: 'source',
      errorCode: 'http-4xx',
      httpStatus: 403,
      degradedLevel: null,
    })
    expect(JSON.stringify(runs[0])).not.toContain('integration-secret')
  })

  it('keeps the persisted interval unchanged across ten consecutive retryable failures', async () => {
    const failure = new KufarSourceRequestError('temporary source failure', {
      ok: false,
      kind: 'temporary',
      code: 'network',
      status: null,
      attempts: 3,
      message: 'Kufar network request failed after bounded retries',
    })
    const fetchPage = vi.fn().mockRejectedValue(failure)
    const executor = executorFor(prisma, fetchPage)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(executor(MONITOR_ID)).rejects.toBe(failure)
    }

    expect(fetchPage).toHaveBeenCalledTimes(10)
    const monitor = await prisma.monitor.findUniqueOrThrow({
      where: { id: MONITOR_ID },
      select: { intervalSec: true },
    })
    expect(monitor.intervalSec).toBe(60)

    const runs = await prisma.run.findMany({
      where: { monitorId: MONITOR_ID },
      orderBy: { id: 'asc' },
    })
    expect(runs).toHaveLength(10)
    expect(
      runs.every(({ outcome, errorCode }) => outcome === 'error' && errorCode === 'network'),
    ).toBe(true)
  })

  it('persists an overlapping trigger as skipped beside the single successful traversal', async () => {
    let releaseFirst!: () => void
    let firstEntered!: () => void
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve
    })
    const fetchPage = vi.fn(async () => {
      firstEntered()
      await release
      return { listings: [], nextCursor: null }
    })
    const executor = executorFor(prisma, fetchPage)

    const first = executor(MONITOR_ID)
    await entered
    const overlap = await executor(MONITOR_ID)
    releaseFirst()
    await first

    expect(overlap).toEqual({ cycleKind: 'skipped-overlap' })
    expect(fetchPage).toHaveBeenCalledTimes(1)
    const runs = await prisma.run.findMany({
      where: { monitorId: MONITOR_ID },
      orderBy: { id: 'asc' },
    })
    expect(runs).toHaveLength(2)
    expect(runs.map(({ outcome }) => outcome)).toEqual(['success', 'skipped'])
  })

  it('prevents overlap across independent executor and database contexts', async () => {
    const secondPrisma = createPrismaClient()
    await secondPrisma.$connect()
    let releaseFirst!: () => void
    let firstEntered!: () => void
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve
    })
    const runCycle = vi.fn(async () => {
      if (runCycle.mock.calls.length === 1) {
        firstEntered()
        await release
      }
      return {
        cycleKind: 'cold-start' as const,
        baselineCount: 0,
        pagesRead: 1,
        nextWatermark: null,
      }
    })
    const fetchPage = vi.fn().mockResolvedValue({ listings: [], nextCursor: null })
    const firstExecutor = executorFor(prisma, fetchPage, runCycle)
    const secondExecutor = executorFor(secondPrisma, fetchPage, runCycle)
    const first = firstExecutor(MONITOR_ID)
    await entered

    try {
      await expect(secondExecutor(MONITOR_ID)).resolves.toEqual({
        cycleKind: 'skipped-overlap',
      })
      expect(runCycle).toHaveBeenCalledTimes(1)
      expect(fetchPage).not.toHaveBeenCalled()
    } finally {
      releaseFirst()
      await first
      await secondPrisma.$disconnect()
    }

    const runs = await prisma.run.findMany({
      where: { monitorId: MONITOR_ID },
      orderBy: { id: 'asc' },
    })
    expect(runs).toHaveLength(2)
    expect(runs.map(({ outcome }) => outcome).sort()).toEqual(['skipped', 'success'])
  })
})
