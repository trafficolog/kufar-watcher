import type { PrismaClient } from '../../generated/prisma/client'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { WatermarkTraversalResult } from '../../shared/watermark'
import { runColdStartMonitor, type ColdStartMonitorRunResult } from './cold-start-monitor-run'
import { runIncrementalMonitor, type CandidateSelector } from './incremental-monitor-run'

export interface RunMonitorCycleInput {
  prisma: PrismaClient
  monitorId: number
  adapter: SourceAdapter
  maxPages: number
  selector?: CandidateSelector
  now?: () => Date
}

export type MonitorCycleResult =
  | ({ kind: 'cold-start' } & ColdStartMonitorRunResult)
  | ({ kind: 'incremental' } & WatermarkTraversalResult)

export async function runMonitorCycle({
  prisma,
  monitorId,
  adapter,
  maxPages,
  selector,
  now,
}: RunMonitorCycleInput): Promise<MonitorCycleResult> {
  const monitor = await prisma.monitor.findUniqueOrThrow({
    where: { id: monitorId },
    select: {
      cursor: {
        select: { boundaryTime: true },
      },
    },
  })

  if (monitor.cursor === null || monitor.cursor.boundaryTime === null) {
    const result = await runColdStartMonitor({
      prisma,
      monitorId,
      adapter,
      maxPages,
      now,
    })
    return { kind: 'cold-start', ...result }
  }

  const result = await runIncrementalMonitor({
    prisma,
    monitorId,
    adapter,
    maxPages,
    selector,
    now,
  })
  return { kind: 'incremental', ...result }
}
