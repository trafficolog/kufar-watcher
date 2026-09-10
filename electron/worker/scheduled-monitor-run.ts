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

export type ScheduledMonitorRunExecutor = (monitorId: number) => Promise<MonitorCycleResult>

export function createScheduledMonitorRunExecutor(
  options: ScheduledMonitorRunExecutorOptions,
): ScheduledMonitorRunExecutor {
  const runCycle = options.runCycle ?? runMonitorCycle

  return async (monitorId) => {
    const monitor = await options.prisma.monitor.findUniqueOrThrow({
      where: { id: monitorId },
      select: { query: true },
    })
    const query = parsePersistedCanonicalQuery(monitor.query)
    const adapter = options.adapters.get(routeKufarQuery(query))

    return runCycle({
      prisma: options.prisma,
      monitorId,
      adapter,
      maxPages: options.maxPages,
      descriptionLoader: options.descriptionLoader,
    })
  }
}
