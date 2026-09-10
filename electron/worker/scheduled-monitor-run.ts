import type { PrismaClient } from '../../generated/prisma/client'
import { routeKufarQuery } from '../../shared/kufar-routing'
import type { SourceAdapterRegistry } from '../../shared/source-adapter-registry'
import type { DescriptionLoader } from './incremental-monitor-run'
import { parsePersistedCanonicalQuery } from './monitor-config-persistence'
import { runMonitorCycle, type MonitorCycleResult } from './monitor-cycle'

export interface ScheduledMonitorRunExecutorOptions {
  prisma: PrismaClient
  adapters: SourceAdapterRegistry
  maxPages: number
  descriptionLoader: DescriptionLoader
  runCycle?: typeof runMonitorCycle
}

export interface SkippedOverlapMonitorRunResult {
  cycleKind: 'skipped-overlap'
}

export type ScheduledMonitorRunResult = MonitorCycleResult | SkippedOverlapMonitorRunResult
export type ScheduledMonitorRunExecutor = (monitorId: number) => Promise<ScheduledMonitorRunResult>

function assertMonitorPageCap(maxPages: number): void {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error(`Invalid monitor page cap: ${maxPages}`)
  }
}

export function createScheduledMonitorRunExecutor(
  options: ScheduledMonitorRunExecutorOptions,
): ScheduledMonitorRunExecutor {
  assertMonitorPageCap(options.maxPages)
  const runCycle = options.runCycle ?? runMonitorCycle
  const activeMonitorIds = new Set<number>()

  return async (monitorId) => {
    if (activeMonitorIds.has(monitorId)) {
      const recordedAt = new Date()
      await options.prisma.run.create({
        data: {
          monitorId,
          startedAt: recordedAt,
          finishedAt: recordedAt,
          outcome: 'skipped',
          seen: 0,
          matched: 0,
          error: null,
          httpStatus: null,
          degradedLevel: null,
        },
      })
      return { cycleKind: 'skipped-overlap' }
    }

    activeMonitorIds.add(monitorId)
    try {
      const startedAt = new Date()
      const journalRun = await options.prisma.run.create({
        data: {
          monitorId,
          startedAt,
          outcome: 'running',
        },
        select: { id: true },
      })
      const monitor = await options.prisma.monitor.findUniqueOrThrow({
        where: { id: monitorId },
        select: { query: true },
      })
      const query = parsePersistedCanonicalQuery(monitor.query)
      const adapter = options.adapters.get(routeKufarQuery(query))

      return await runCycle({
        prisma: options.prisma,
        monitorId,
        runId: journalRun.id,
        adapter,
        maxPages: options.maxPages,
        descriptionLoader: options.descriptionLoader,
      })
    } finally {
      activeMonitorIds.delete(monitorId)
    }
  }
}
