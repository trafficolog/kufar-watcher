import type { PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { WatermarkCatchupCheckpoint, WatermarkTraversalResult } from '../../shared/watermark'
import { DescriptionRequestBudget } from './description-request-budget'
import type { ListingDescriptionResult } from './listing-description-cache'
import {
  createMatchingCandidateSelector,
  parsePersistedKeywordRule,
} from './listing-match-selector'
import { parsePersistedCanonicalQuery } from './monitor-config-persistence'
import {
  commitMonitorRun,
  type MatchSelection,
  type SelectedListing,
} from './monitor-run-persistence'
import { traverseWatermark, WatermarkOrderingError } from './watermark-traversal'

export class ColdStartRequiredError extends Error {
  constructor(readonly monitorId: number) {
    super(`Cold start required for monitor ${monitorId}`)
    this.name = 'ColdStartRequiredError'
  }
}

export interface CandidateSelector {
  select(listing: Listing): Promise<MatchSelection | null>
}

export const acceptAllCandidateSelector: CandidateSelector = {
  async select() {
    return {
      matchedTerms: [],
      matchedIn: [],
      snippet: null,
    }
  },
}

export interface CandidatePrefilter {
  accept(listing: Listing): Promise<boolean>
}

export const acceptAllCandidatePrefilter: CandidatePrefilter = {
  async accept() {
    return true
  },
}

export interface DescriptionLoader {
  ensureDescription(
    listing: Listing,
    requestBudget: DescriptionRequestBudget,
  ): Promise<ListingDescriptionResult>
}

export interface RunIncrementalMonitorInput {
  prisma: PrismaClient
  monitorId: number
  runId?: number
  startedAt?: Date
  adapter: SourceAdapter
  maxPages: number
  selector?: CandidateSelector
  prefilter?: CandidatePrefilter
  descriptionLoader?: DescriptionLoader
  now?: () => Date
}

interface PersistedCatchupCursor {
  catchupCursor: string | null
  catchupBoundaryTime: Date | null
  catchupBoundaryIds: unknown
  catchupLastListTime: Date | null
  catchupLastListId: string | null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime())
}

function parseBoundaryIds(value: unknown): string[] {
  if (!isStringArray(value)) {
    throw new Error('Invalid persisted cursor boundaryIds')
  }
  return [...value]
}

function parseCatchupCheckpoint(
  cursor: PersistedCatchupCursor,
): WatermarkCatchupCheckpoint | undefined {
  const hasResumeCursor = cursor.catchupCursor !== null
  const hasBoundaryTime = cursor.catchupBoundaryTime !== null
  const hasLastListTime = cursor.catchupLastListTime !== null
  const hasLastListId = cursor.catchupLastListId !== null

  if (!hasResumeCursor) {
    if (
      hasBoundaryTime ||
      hasLastListTime ||
      hasLastListId ||
      !isStringArray(cursor.catchupBoundaryIds) ||
      cursor.catchupBoundaryIds.length !== 0
    ) {
      throw new Error('Invalid persisted cursor catch-up checkpoint')
    }
    return undefined
  }

  if (
    !hasBoundaryTime ||
    !isValidDate(cursor.catchupBoundaryTime as Date) ||
    !isStringArray(cursor.catchupBoundaryIds) ||
    hasLastListTime !== hasLastListId ||
    (hasLastListTime && !isValidDate(cursor.catchupLastListTime as Date))
  ) {
    throw new Error('Invalid persisted cursor catch-up checkpoint')
  }

  return {
    resumeCursor: cursor.catchupCursor as string,
    pendingWatermark: {
      boundaryTime: (cursor.catchupBoundaryTime as Date).toISOString(),
      boundaryIds: [...cursor.catchupBoundaryIds],
    },
    lastObservation:
      hasLastListTime && hasLastListId
        ? {
            listId: cursor.catchupLastListId as string,
            listTime: (cursor.catchupLastListTime as Date).toISOString(),
          }
        : null,
  }
}

function isStaleCatchupCheckpointError(error: unknown): error is WatermarkOrderingError {
  return (
    error instanceof WatermarkOrderingError &&
    error.previous.page === 0 &&
    error.previous.index === -1
  )
}

async function traverseWithRecovery(input: {
  adapter: SourceAdapter
  query: CanonicalQuery
  previousWatermark: { boundaryTime: string; boundaryIds: string[] }
  maxPages: number
  checkpoint: WatermarkCatchupCheckpoint | undefined
}): Promise<WatermarkTraversalResult> {
  const common = {
    adapter: input.adapter,
    query: input.query,
    previousWatermark: input.previousWatermark,
    maxPages: input.maxPages,
  }

  if (input.checkpoint === undefined) {
    return traverseWatermark(common)
  }

  try {
    return await traverseWatermark({ ...common, checkpoint: input.checkpoint })
  } catch (error) {
    if (!isStaleCatchupCheckpointError(error)) throw error
    return traverseWatermark(common)
  }
}

export async function runIncrementalMonitor({
  prisma,
  monitorId,
  runId,
  startedAt: scheduledStartedAt,
  adapter,
  maxPages,
  selector,
  prefilter = acceptAllCandidatePrefilter,
  descriptionLoader,
  now = () => new Date(),
}: RunIncrementalMonitorInput): Promise<WatermarkTraversalResult> {
  const monitor = await prisma.monitor.findUniqueOrThrow({
    where: { id: monitorId },
    select: {
      query: true,
      keywords: true,
      searchInDescription: true,
      cursor: {
        select: {
          boundaryTime: true,
          boundaryIds: true,
          catchupCursor: true,
          catchupBoundaryTime: true,
          catchupBoundaryIds: true,
          catchupLastListTime: true,
          catchupLastListId: true,
          updatedAt: true,
        },
      },
    },
  })

  if (monitor.cursor === null || monitor.cursor.boundaryTime === null) {
    throw new ColdStartRequiredError(monitorId)
  }

  const query = parsePersistedCanonicalQuery(monitor.query)
  const persistedSelector =
    monitor.keywords === undefined
      ? acceptAllCandidateSelector
      : createMatchingCandidateSelector({
          rule: parsePersistedKeywordRule(monitor.keywords),
          searchInDescription: monitor.searchInDescription,
        })
  const candidateSelector = selector ?? persistedSelector
  const previousWatermark = {
    boundaryTime: monitor.cursor.boundaryTime.toISOString(),
    boundaryIds: parseBoundaryIds(monitor.cursor.boundaryIds),
  }
  const checkpoint = parseCatchupCheckpoint(monitor.cursor)
  const expectedCursorUpdatedAt = monitor.cursor.updatedAt
  const startedAt = scheduledStartedAt ?? now()

  const traversal = await traverseWithRecovery({
    adapter,
    query,
    previousWatermark,
    maxPages,
    checkpoint,
  })

  const descriptionRequestBudget = new DescriptionRequestBudget()
  const selected: SelectedListing[] = []
  for (const listing of traversal.newListings) {
    if (!(await prefilter.accept(listing))) continue

    let candidate = listing
    if (monitor.searchInDescription) {
      if (descriptionLoader === undefined) {
        throw new Error('Description loader is required when search in description is enabled')
      }

      const descriptionResult = await descriptionLoader.ensureDescription(
        listing,
        descriptionRequestBudget,
      )
      if (descriptionResult.kind === 'unavailable') continue

      candidate = {
        ...listing,
        description: descriptionResult.description,
      }
    }

    const selection = await candidateSelector.select(candidate)
    if (selection !== null) {
      selected.push({ listing: candidate, selection })
    }
  }

  const finishedAt = now()
  await commitMonitorRun(prisma, {
    monitorId,
    ...(runId === undefined ? {} : { runId }),
    startedAt,
    finishedAt,
    expectedCursorUpdatedAt,
    candidates: traversal.newListings,
    selected,
    traversal,
  })

  return traversal
}
