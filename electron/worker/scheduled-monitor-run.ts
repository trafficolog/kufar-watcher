import type { PrismaClient } from '../../generated/prisma/client'
import { routeKufarQuery } from '../../shared/kufar-routing'
import type { SourceAdapterRegistry } from '../../shared/source-adapter-registry'
import type { DescriptionLoader } from './incremental-monitor-run'
import { KufarSourceRequestError } from './kufar-source-request-error'
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

interface RunFailureJournal {
  error: string
  errorCategory: string
  errorCode: string
  httpStatus: number | null
}

function assertMonitorPageCap(maxPages: number): void {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error(`Invalid monitor page cap: ${maxPages}`)
  }
}

function classifyRunFailure(error: unknown): RunFailureJournal {
  if (error instanceof KufarSourceRequestError) {
    return {
      error: error.result.message,
      errorCategory: 'source',
      errorCode: error.result.code,
      httpStatus: error.result.status,
    }
  }

  return {
    error: 'Unexpected monitor run failure',
    errorCategory: 'internal',
    errorCode: 'unexpected',
    httpStatus: null,
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

      try {
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
          startedAt,
          adapter,
          maxPages: options.maxPages,
          descriptionLoader: options.descriptionLoader,
        })
      } catch (error) {
        const finishedAt = new Date()
        const journal = classifyRunFailure(error)
        await options.prisma.run.update({
          where: { id: journalRun.id },
          data: {
            finishedAt,
            durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
            outcome: 'error',
            seen: 0,
            matched: 0,
            ...journal,
            degradedLevel: null,
          },
        })
        throw error
      }
    } finally {
      activeMonitorIds.delete(monitorId)
    }
  }
}
