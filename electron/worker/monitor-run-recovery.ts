import type { PrismaClient } from '../../generated/prisma/client'
import { RUN_OUTCOME } from '../../shared/run-outcome'
import type { AcquireMonitorRunLease } from './monitor-run-lease'

export interface RecoverInterruptedMonitorRunsOptions {
  prisma: PrismaClient
  acquireMonitorRunLease: AcquireMonitorRunLease
}

async function recoverMonitorRows(prisma: PrismaClient, monitorId: number): Promise<void> {
  const recoveredAt = new Date()
  await prisma.$executeRaw`
    UPDATE "Run"
    SET
      "finishedAt" = ${recoveredAt}::timestamp,
      "durationMs" = LEAST(
        2147483647,
        GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (${recoveredAt}::timestamp - "startedAt")) * 1000)
        )
      )::integer,
      "outcome" = ${RUN_OUTCOME.INTERRUPTED}::text,
      "error" = 'Worker process interrupted before Run completion',
      "errorCategory" = 'internal',
      "errorCode" = 'worker-interrupted'
    WHERE "monitorId" = ${monitorId}
      AND "outcome" = ${RUN_OUTCOME.RUNNING}::text
      AND "finishedAt" IS NULL
  `
}

export async function recoverInterruptedMonitorRuns(
  options: RecoverInterruptedMonitorRunsOptions,
): Promise<void> {
  const candidates = await options.prisma.run.findMany({
    where: {
      outcome: RUN_OUTCOME.RUNNING,
      finishedAt: null,
    },
    distinct: ['monitorId'],
    select: { monitorId: true },
  })

  for (const { monitorId } of candidates) {
    const lease = await options.acquireMonitorRunLease(monitorId)
    if (!lease) continue

    let primaryError: unknown
    let failed = false
    try {
      await recoverMonitorRows(options.prisma, monitorId)
    } catch (error) {
      failed = true
      primaryError = error
    }

    try {
      await lease.release()
    } catch (releaseError) {
      if (!failed) throw releaseError
    }

    if (failed) throw primaryError
  }
}
