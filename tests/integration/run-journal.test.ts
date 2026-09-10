import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

function executorFor(
  prisma: ReturnType<typeof createPrismaClient>,
  fetchPage: SourceAdapter['fetchPage'],
) {
  const adapter = { fetchPage } as SourceAdapter
  return createScheduledMonitorRunExecutor({
    prisma,
    adapters: createSourceAdapterRegistry({
      electronics: adapter,
      'real-estate': adapter,
    }),
    maxPages: 2,
    descriptionLoader: { ensureDescription: vi.fn() },
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

    await expect(executor(MONITOR_ID)).rejects.toBe(failure)

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
})
