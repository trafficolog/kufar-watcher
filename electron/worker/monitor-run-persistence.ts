import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'
import type { WatermarkTraversalResult } from '../../shared/watermark'
import { listingCreateData, listingSearchUpdateData } from './listing-persistence-data'

export interface MatchSelection {
  matchedTerms: readonly string[]
  matchedIn: readonly string[]
  snippet: string | null
}

export interface SelectedListing {
  listing: Listing
  selection: MatchSelection
}

export interface MonitorRunPersistenceInput {
  monitorId: number
  startedAt: Date
  finishedAt: Date
  expectedCursorUpdatedAt: Date
  candidates: readonly Listing[]
  selected: readonly SelectedListing[]
  traversal: WatermarkTraversalResult
}

export class StaleMonitorRunError extends Error {
  constructor(readonly monitorId: number) {
    super(`Stale monitor run for monitor ${monitorId}: cursor revision changed`)
    this.name = 'StaleMonitorRunError'
  }
}

async function assertCurrentCursorRevision(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  const lockedMonitors = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "Monitor"
    WHERE "id" = ${input.monitorId}
    FOR UPDATE
  `

  if (lockedMonitors.length !== 1) {
    throw new StaleMonitorRunError(input.monitorId)
  }

  const cursor = await tx.monitorCursor.findUnique({
    where: { monitorId: input.monitorId },
    select: { updatedAt: true },
  })

  if (cursor === null || cursor.updatedAt.getTime() !== input.expectedCursorUpdatedAt.getTime()) {
    throw new StaleMonitorRunError(input.monitorId)
  }
}

export async function persistListings(
  tx: Prisma.TransactionClient,
  listings: readonly Listing[],
): Promise<void> {
  for (const listing of listings) {
    await tx.listing.upsert({
      where: { listId: listing.listId },
      create: listingCreateData(listing),
      update: listingSearchUpdateData(listing),
    })
  }
}

export async function persistListingsAndMatches(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  await persistListings(tx, input.candidates)

  for (const item of input.selected) {
    await tx.match.upsert({
      where: {
        monitorId_listingId: {
          monitorId: input.monitorId,
          listingId: item.listing.listId,
        },
      },
      create: {
        monitorId: input.monitorId,
        listingId: item.listing.listId,
        matchedTerms: [...item.selection.matchedTerms],
        matchedIn: [...item.selection.matchedIn],
        snippet: item.selection.snippet,
      },
      update: {},
    })
  }
}

export async function persistMonitorCursor(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  const commonData = { lastRunAt: input.finishedAt }

  if (input.traversal.kind === 'incomplete') {
    const { checkpoint } = input.traversal
    await tx.monitorCursor.update({
      where: { monitorId: input.monitorId },
      data: {
        ...commonData,
        catchupCursor: checkpoint.resumeCursor,
        catchupBoundaryTime: new Date(checkpoint.pendingWatermark.boundaryTime),
        catchupBoundaryIds: [...checkpoint.pendingWatermark.boundaryIds],
        catchupLastListTime:
          checkpoint.lastObservation === null
            ? null
            : new Date(checkpoint.lastObservation.listTime),
        catchupLastListId: checkpoint.lastObservation?.listId ?? null,
      },
    })
    return
  }

  await tx.monitorCursor.update({
    where: { monitorId: input.monitorId },
    data: {
      ...commonData,
      boundaryTime: new Date(input.traversal.nextWatermark.boundaryTime),
      boundaryIds: [...input.traversal.nextWatermark.boundaryIds],
      catchupCursor: null,
      catchupBoundaryTime: null,
      catchupBoundaryIds: [],
      catchupLastListTime: null,
      catchupLastListId: null,
    },
  })
}

export async function persistSuccessfulRun(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  const isCatchup = input.traversal.kind === 'incomplete'

  await tx.run.create({
    data: {
      monitorId: input.monitorId,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      outcome: isCatchup ? 'catchup' : 'success',
      seen: input.candidates.length,
      matched: input.selected.length,
      error: null,
      httpStatus: null,
      degradedLevel: isCatchup ? 'watermark-catchup' : null,
    },
  })
}

export async function persistMonitorRunTransaction(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  await assertCurrentCursorRevision(tx, input)
  await persistListingsAndMatches(tx, input)
  await persistMonitorCursor(tx, input)
  await persistSuccessfulRun(tx, input)
}

export async function commitMonitorRun(
  prisma: PrismaClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  await prisma.$transaction((tx) => persistMonitorRunTransaction(tx, input))
}
