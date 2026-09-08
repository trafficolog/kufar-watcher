import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { Watermark } from '../../shared/watermark'
import {
  canonicalQueryEquals,
  parsePersistedCanonicalQuery,
} from './monitor-config-persistence'
import { persistListings } from './monitor-run-persistence'

export interface ColdStartSourceSnapshot {
  sourceUrl: string
  query: CanonicalQuery
}

export type ColdStartCursorSnapshot =
  | { kind: 'missing' }
  | { kind: 'uninitialized'; updatedAt: Date }

export interface ColdStartPersistenceInput {
  monitorId: number
  startedAt: Date
  finishedAt: Date
  source: ColdStartSourceSnapshot
  expectedCursor: ColdStartCursorSnapshot
  listings: readonly Listing[]
  nextWatermark: Watermark
}

export class StaleColdStartError extends Error {
  constructor(readonly monitorId: number) {
    super(`Stale cold-start baseline for monitor ${monitorId}`)
    this.name = 'StaleColdStartError'
  }
}

async function assertCurrentColdStartState(
  tx: Prisma.TransactionClient,
  input: ColdStartPersistenceInput,
): Promise<void> {
  const lockedMonitors = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "Monitor"
    WHERE "id" = ${input.monitorId}
    FOR UPDATE
  `

  if (lockedMonitors.length !== 1) {
    throw new StaleColdStartError(input.monitorId)
  }

  const monitor = await tx.monitor.findUnique({
    where: { id: input.monitorId },
    select: { sourceUrl: true, query: true },
  })

  if (monitor === null) {
    throw new StaleColdStartError(input.monitorId)
  }

  const currentQuery = parsePersistedCanonicalQuery(monitor.query)
  if (
    monitor.sourceUrl !== input.source.sourceUrl ||
    !canonicalQueryEquals(currentQuery, input.source.query)
  ) {
    throw new StaleColdStartError(input.monitorId)
  }

  const cursor = await tx.monitorCursor.findUnique({
    where: { monitorId: input.monitorId },
    select: { boundaryTime: true, updatedAt: true },
  })

  if (input.expectedCursor.kind === 'missing') {
    if (cursor !== null) {
      throw new StaleColdStartError(input.monitorId)
    }
    return
  }

  if (
    cursor === null ||
    cursor.boundaryTime !== null ||
    cursor.updatedAt.getTime() !== input.expectedCursor.updatedAt.getTime()
  ) {
    throw new StaleColdStartError(input.monitorId)
  }
}

export async function persistColdStartBaselineTransaction(
  tx: Prisma.TransactionClient,
  input: ColdStartPersistenceInput,
): Promise<void> {
  await assertCurrentColdStartState(tx, input)
  await persistListings(tx, input.listings)

  const cursorData = {
    boundaryTime: new Date(input.nextWatermark.boundaryTime),
    boundaryIds: [...input.nextWatermark.boundaryIds],
    lastRunAt: input.finishedAt,
  }

  await tx.monitorCursor.upsert({
    where: { monitorId: input.monitorId },
    create: { monitorId: input.monitorId, ...cursorData },
    update: cursorData,
  })

  await tx.run.create({
    data: {
      monitorId: input.monitorId,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      outcome: 'success',
      seen: input.listings.length,
      matched: 0,
      error: null,
      httpStatus: null,
      degradedLevel: null,
    },
  })
}

export async function commitColdStartBaseline(
  prisma: PrismaClient,
  input: ColdStartPersistenceInput,
): Promise<void> {
  await prisma.$transaction((tx) => persistColdStartBaselineTransaction(tx, input))
}
