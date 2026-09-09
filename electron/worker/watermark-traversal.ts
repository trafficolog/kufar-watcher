import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type {
  Watermark,
  WatermarkCatchUpCheckpoint,
  WatermarkCatchUpObservation,
  WatermarkTraversalResult,
} from '../../shared/watermark'

export interface TraverseWatermarkInput {
  adapter: SourceAdapter
  query: CanonicalQuery
  previousWatermark: Watermark
  maxPages: number
  checkpoint?: WatermarkCatchUpCheckpoint
}

export type WatermarkTraversalConfigField =
  | 'maxPages'
  | 'previousWatermark.boundaryTime'
  | 'checkpoint.pendingWatermark.boundaryTime'
  | 'checkpoint.pagesRead'
  | 'checkpoint.lastObservation.listTime'

export class WatermarkTraversalConfigError extends Error {
  constructor(
    readonly field: WatermarkTraversalConfigField,
    readonly value: unknown,
  ) {
    super(`Invalid watermark traversal input: ${field}`)
    this.name = 'WatermarkTraversalConfigError'
  }
}

export type WatermarkOrderingObservation = WatermarkCatchUpObservation

interface WatermarkOrderingState {
  observation: WatermarkOrderingObservation
  epoch: number
}

export class WatermarkOrderingError extends Error {
  constructor(
    readonly previous: WatermarkOrderingObservation,
    readonly current: WatermarkOrderingObservation,
  ) {
    super('Watermark traversal source order is not non-increasing')
    this.name = 'WatermarkOrderingError'
  }
}

export class WatermarkListingTimeError extends Error {
  constructor(readonly observation: WatermarkOrderingObservation) {
    super(`Invalid listing time for ${observation.listId}`)
    this.name = 'WatermarkListingTimeError'
  }
}

export class WatermarkCatchUpResumeError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super('Watermark catch-up cursor could not be resumed')
    this.name = 'WatermarkCatchUpResumeError'
    this.cause = cause
  }
}

function parseBoundary(value: string, field: WatermarkTraversalConfigField): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new WatermarkTraversalConfigError(field, value)
  }
  return parsed
}

function parsePreviousBoundary(value: string): number {
  return parseBoundary(value, 'previousWatermark.boundaryTime')
}

function assertMaxPages(maxPages: number): void {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new WatermarkTraversalConfigError('maxPages', maxPages)
  }
}

function assertCheckpoint(checkpoint: WatermarkCatchUpCheckpoint): void {
  if (!Number.isInteger(checkpoint.pagesRead) || checkpoint.pagesRead < 1) {
    throw new WatermarkTraversalConfigError('checkpoint.pagesRead', checkpoint.pagesRead)
  }

  parseBoundary(
    checkpoint.pendingWatermark.boundaryTime,
    'checkpoint.pendingWatermark.boundaryTime',
  )

  if (checkpoint.lastObservation !== null) {
    parseBoundary(checkpoint.lastObservation.listTime, 'checkpoint.lastObservation.listTime')
  }
}

export function parseListingTime(observation: WatermarkOrderingObservation): number {
  const epoch = Date.parse(observation.listTime)
  if (!Number.isFinite(epoch)) {
    throw new WatermarkListingTimeError(observation)
  }
  return epoch
}

function cloneWatermark(watermark: Watermark): Watermark {
  return {
    boundaryTime: watermark.boundaryTime,
    boundaryIds: [...watermark.boundaryIds],
  }
}

export async function traverseWatermark({
  adapter,
  query,
  previousWatermark,
  maxPages,
  checkpoint,
}: TraverseWatermarkInput): Promise<WatermarkTraversalResult> {
  assertMaxPages(maxPages)
  const previousEpoch = parsePreviousBoundary(previousWatermark.boundaryTime)
  if (checkpoint !== undefined) assertCheckpoint(checkpoint)

  const previousIds = new Set(previousWatermark.boundaryIds)
  const seenIds = new Set<string>()
  const newListings: Listing[] = []
  let pendingWatermark = cloneWatermark(checkpoint?.pendingWatermark ?? previousWatermark)
  let pendingEpoch = parseBoundary(
    pendingWatermark.boundaryTime,
    checkpoint === undefined
      ? 'previousWatermark.boundaryTime'
      : 'checkpoint.pendingWatermark.boundaryTime',
  )
  let cursor: string | null = checkpoint?.resumeCursor ?? null
  let pagesRead = 0
  const pageOffset = checkpoint?.pagesRead ?? 0
  let boundaryCrossed = false
  let previousObservation: WatermarkOrderingState | null = null

  if (checkpoint?.lastObservation !== null && checkpoint?.lastObservation !== undefined) {
    previousObservation = {
      observation: checkpoint.lastObservation,
      epoch: parseBoundary(
        checkpoint.lastObservation.listTime,
        'checkpoint.lastObservation.listTime',
      ),
    }
  }

  while (pagesRead < maxPages) {
    let page
    try {
      page = await adapter.fetchPage({ query, cursor })
    } catch (error) {
      if (checkpoint !== undefined) throw new WatermarkCatchUpResumeError(error)
      throw error
    }
    pagesRead += 1
    const observationPage = pageOffset + pagesRead

    for (const [index, current] of page.listings.entries()) {
      if (seenIds.has(current.listId)) continue
      seenIds.add(current.listId)

      const observation: WatermarkOrderingObservation = {
        page: observationPage,
        index,
        listId: current.listId,
        listTime: current.listTime,
      }
      const epoch = parseListingTime(observation)

      if (previousObservation !== null && epoch > previousObservation.epoch) {
        throw new WatermarkOrderingError(previousObservation.observation, observation)
      }
      previousObservation = { observation, epoch }

      if (epoch > pendingEpoch) {
        pendingEpoch = epoch
        pendingWatermark = {
          boundaryTime: current.listTime,
          boundaryIds: [current.listId],
        }
      } else if (epoch === pendingEpoch && !pendingWatermark.boundaryIds.includes(current.listId)) {
        pendingWatermark = {
          boundaryTime: pendingWatermark.boundaryTime,
          boundaryIds: [...pendingWatermark.boundaryIds, current.listId],
        }
      }

      if (epoch > previousEpoch) {
        newListings.push(current)
        continue
      }

      if (epoch === previousEpoch) {
        if (!previousIds.has(current.listId)) {
          newListings.push(current)
        }
        continue
      }

      boundaryCrossed = true
      break
    }

    if (boundaryCrossed || page.nextCursor === null) {
      return {
        newListings,
        nextWatermark: pendingWatermark,
        pagesRead,
        possibleMiss: false,
      }
    }

    if (pagesRead === maxPages) {
      return {
        newListings,
        nextWatermark: previousWatermark,
        pagesRead,
        possibleMiss: true,
        checkpoint: {
          resumeCursor: page.nextCursor,
          pendingWatermark,
          pagesRead: pageOffset + pagesRead,
          lastObservation: previousObservation?.observation ?? null,
        },
      }
    }

    cursor = page.nextCursor
  }

  throw new Error('Watermark traversal loop terminated unexpectedly')
}
