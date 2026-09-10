import type { PrismaClient } from '../../generated/prisma/client'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { Watermark } from '../../shared/watermark'
import { type ColdStartCursorSnapshot, commitColdStartBaseline } from './cold-start-persistence'
import { traverseColdStartBaseline } from './cold-start-traversal'
import { parsePersistedCanonicalQuery } from './monitor-config-persistence'

export interface RunColdStartMonitorInput {
  prisma: PrismaClient
  monitorId: number
  runId?: number
  startedAt?: Date
  adapter: SourceAdapter
  maxPages: number
  now?: () => Date
}

export interface ColdStartMonitorRunResult {
  baselineCount: number
  pagesRead: number
  nextWatermark: Watermark
}

export class ColdStartNotRequiredError extends Error {
  constructor(readonly monitorId: number) {
    super(`Cold start is not required for monitor ${monitorId}`)
    this.name = 'ColdStartNotRequiredError'
  }
}

export async function runColdStartMonitor({
  prisma,
  monitorId,
  runId,
  startedAt: scheduledStartedAt,
  adapter,
  maxPages,
  now = () => new Date(),
}: RunColdStartMonitorInput): Promise<ColdStartMonitorRunResult> {
  const monitor = await prisma.monitor.findUniqueOrThrow({
    where: { id: monitorId },
    select: {
      sourceUrl: true,
      query: true,
      state: true,
      cursor: {
        select: {
          boundaryTime: true,
          updatedAt: true,
        },
      },
    },
  })

  if (monitor.cursor !== null && monitor.cursor.boundaryTime !== null) {
    throw new ColdStartNotRequiredError(monitorId)
  }

  const query = parsePersistedCanonicalQuery(monitor.query)
  const expectedCursor: ColdStartCursorSnapshot =
    monitor.cursor === null
      ? { kind: 'missing' }
      : { kind: 'uninitialized', updatedAt: monitor.cursor.updatedAt }
  const startedAt = scheduledStartedAt ?? now()

  const traversal = await traverseColdStartBaseline({
    adapter,
    query,
    maxPages,
    startedAt,
  })

  const finishedAt = now()
  await commitColdStartBaseline(prisma, {
    monitorId,
    ...(runId === undefined ? {} : { runId }),
    startedAt,
    finishedAt,
    source: {
      sourceUrl: monitor.sourceUrl,
      query,
      state: monitor.state,
    },
    expectedCursor,
    listings: traversal.listings,
    nextWatermark: traversal.nextWatermark,
  })

  return {
    baselineCount: traversal.baselineCount,
    pagesRead: traversal.pagesRead,
    nextWatermark: traversal.nextWatermark,
  }
}
