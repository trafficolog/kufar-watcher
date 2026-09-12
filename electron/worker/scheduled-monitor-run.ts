import type { PrismaClient } from '../../generated/prisma/client'
import { routeKufarQuery } from '../../shared/kufar-routing'
import { RUN_OUTCOME } from '../../shared/run-outcome'
import type { SourceAdapterRegistry } from '../../shared/source-adapter-registry'
import { DescriptionRequestBudgetExceededError } from './description-request-budget'
import type { DescriptionLoader } from './incremental-monitor-run'
import {
  KufarResilientSourceError,
  type SourceDegradationEvent,
  type SourceDegradationSink,
  type SourceFailureStage,
} from './kufar-resilient-source'
import { KufarSourceRequestError } from './kufar-source-request-error'
import { parsePersistedCanonicalQuery } from './monitor-config-persistence'
import { runMonitorCycle, type MonitorCycleResult } from './monitor-cycle'

export interface ScheduledMonitorRunExecutorOptions {
  prisma: PrismaClient
  createRunAdapters(onDegradation: SourceDegradationSink): SourceAdapterRegistry
  maxPages: number
  descriptionLoader: DescriptionLoader
  runCycle?: typeof runMonitorCycle
  onSourceDegradation?: (monitorId: number, event: SourceDegradationEvent) => void | Promise<void>
  onPauseRequired?: (monitorId: number, stage: SourceFailureStage) => void | Promise<void>
}

export interface SkippedOverlapMonitorRunResult {
  cycleKind: 'skipped-overlap'
}

export interface FailedNoRetryMonitorRunResult {
  cycleKind: 'failed-no-retry'
}

export interface PauseRequiredMonitorRunResult {
  cycleKind: 'pause-required'
}

export type ScheduledMonitorRunResult =
  | MonitorCycleResult
  | SkippedOverlapMonitorRunResult
  | FailedNoRetryMonitorRunResult
  | PauseRequiredMonitorRunResult
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

function sourceRequestFailureJournal(error: KufarSourceRequestError): RunFailureJournal {
  return {
    error: error.result.message,
    errorCategory: 'source',
    errorCode: error.result.code,
    httpStatus: error.result.status,
  }
}

function isRetryableSourceRequest(error: KufarSourceRequestError): boolean {
  return (
    error.result.code === 'network' ||
    error.result.code === 'timeout' ||
    error.result.code === 'http-5xx'
  )
}

function classifyRunFailure(error: unknown): RunFailureJournal {
  if (error instanceof DescriptionRequestBudgetExceededError) {
    return {
      error: 'Listing detail request budget exhausted',
      errorCategory: 'policy',
      errorCode: 'description-budget-exhausted',
      httpStatus: null,
    }
  }

  if (error instanceof KufarSourceRequestError) {
    return sourceRequestFailureJournal(error)
  }

  if (error instanceof KufarResilientSourceError) {
    if (error.fallbackCause instanceof KufarSourceRequestError) {
      return sourceRequestFailureJournal(error.fallbackCause)
    }
    if (error.primaryCause instanceof KufarSourceRequestError) {
      return sourceRequestFailureJournal(error.primaryCause)
    }
    return {
      error: `Kufar source failed at ${error.stage}`,
      errorCategory: 'source',
      errorCode: `resilient-${error.stage}`,
      httpStatus: null,
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
          outcome: RUN_OUTCOME.SKIPPED,
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
          outcome: RUN_OUTCOME.RUNNING,
        },
        select: { id: true },
      })
      let degradationRecorded = false
      const onDegradation: SourceDegradationSink = async (event) => {
        if (degradationRecorded) return

        await options.prisma.run.update({
          where: { id: journalRun.id },
          data: { degradedLevel: 'html-fallback' },
        })
        degradationRecorded = true
        await options.onSourceDegradation?.(monitorId, event)
      }
      const adapters = options.createRunAdapters(onDegradation)

      try {
        const monitor = await options.prisma.monitor.findUniqueOrThrow({
          where: { id: monitorId },
          select: { query: true },
        })
        const query = parsePersistedCanonicalQuery(monitor.query)
        const adapter = adapters.get(routeKufarQuery(query))

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
            outcome: RUN_OUTCOME.ERROR,
            seen: 0,
            matched: 0,
            ...journal,
          },
        })

        if (error instanceof DescriptionRequestBudgetExceededError) {
          return { cycleKind: 'failed-no-retry' }
        }

        if (error instanceof KufarResilientSourceError && error.action === 'pause-required') {
          await options.onPauseRequired?.(monitorId, error.stage)
          return { cycleKind: 'pause-required' }
        }

        if (error instanceof KufarSourceRequestError && !isRetryableSourceRequest(error)) {
          return { cycleKind: 'failed-no-retry' }
        }

        throw error
      }
    } finally {
      activeMonitorIds.delete(monitorId)
    }
  }
}
