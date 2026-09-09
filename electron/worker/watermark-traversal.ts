import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type {
  Watermark,
  WatermarkCatchupCheckpoint,
  WatermarkTraversalResult,
} from '../../shared/watermark'

export interface TraverseWatermarkInput {
  adapter: SourceAdapter
  query: CanonicalQuery
  previousWatermark: Watermark
  maxPages: number
  checkpoint?: WatermarkCatchupCheckpoint
}

export type WatermarkTraversalConfigField =
  'maxPages' | 'previousWatermark.boundaryTime' | 'checkpoint.pendingWatermark.boundaryTime'

export class WatermarkTraversalConfigError extends Error {
  constructor(
    readonly field: WatermarkTraversalConfigField,
    readonly value: unknown,
  ) {
    super(`Invalid watermark traversal input: ${field}`)
    this.name = 'WatermarkTraversalConfigError'
  }
}

export interface WatermarkOrderingObservation {
  page: number
  index: number
  listId: string
  listTime: string
}

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
    super(`Invalid listing listTime for ${observation.listId}`)
    this.name = 'WatermarkListingTimeError'
  }
}

export function parseListingObservationEpoch(observation: WatermarkOrderingObservation): number {
  const parsed = Date.parse(observation.listTime)
  if (!Number.isFinite(parsed)) {
    throw new WatermarkListingTimeError(observation)
  }
  return parsed
}

function parseBoundary(
  field: Exclude<WatermarkTraversalConfigField, 'maxPages'>,
  value: string,
): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new WatermarkTraversalConfigError(field, value)
  }
  return parsed
}

function assertMaxPages(maxPages: number): void {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new WatermarkTraversalConfigError('maxPages', maxPages)
  }
}

function checkpointOrderingState(
  checkpoint: WatermarkCatchupCheckpoint | undefined,
): WatermarkOrderingState | null {
  if (checkpoint?.lastObservation === null || checkpoint?.lastObservation === undefined) {
    return null
  }

  const observation: WatermarkOrderingObservation = {
    page: 0,
    index: -1,
    listId: checkpoint.lastObservation.listId,
    listTime: checkpoint.lastObservation.listTime,
  }
  return {
    observation,
    epoch: parseListingObservationEpoch(observation),
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
  const previousEpoch = parseBoundary(
    'previousWatermark.boundaryTime',
    previousWatermark.boundaryTime,
  )

  const previousIds = new Set(previousWatermark.boundaryIds)
  const seenIds = new Set<string>()
  const newListings: Listing[] = []
  const idsAtMaximum: string[] = checkpoint ? [...checkpoint.pendingWatermark.boundaryIds] : []
  let maximumEpoch: number | null = checkpoint
    ? parseBoundary(
        'checkpoint.pendingWatermark.boundaryTime',
        checkpoint.pendingWatermark.boundaryTime,
      )
    : null
  let maximumOriginalTime: string | null = checkpoint?.pendingWatermark.boundaryTime ?? null
  let cursor: string | null = checkpoint?.resumeCursor ?? null
  let pagesRead = 0
  let boundaryCrossed = false
  let previousObservation = checkpointOrderingState(checkpoint)

  const accumulatedWatermark = (): Watermark => {
    if (maximumEpoch === null || maximumEpoch < previousEpoch) {
      return previousWatermark
    }

    if (maximumEpoch === previousEpoch) {
      return {
        boundaryTime: previousWatermark.boundaryTime,
        boundaryIds: [...new Set([...previousWatermark.boundaryIds, ...idsAtMaximum])],
      }
    }

    return {
      boundaryTime: maximumOriginalTime as string,
      boundaryIds: [...new Set(idsAtMaximum)],
    }
  }

  while (pagesRead < maxPages) {
    const page = await adapter.fetchPage({ query, cursor })
    pagesRead += 1

    for (const [index, current] of page.listings.entries()) {
      if (seenIds.has(current.listId)) continue
      seenIds.add(current.listId)

      const observation: WatermarkOrderingObservation = {
        page: pagesRead,
        index,
        listId: current.listId,
        listTime: current.listTime,
      }
      const epoch = parseListingObservationEpoch(observation)

      if (previousObservation !== null && epoch > previousObservation.epoch) {
        throw new WatermarkOrderingError(previousObservation.observation, observation)
      }
      previousObservation = { observation, epoch }

      if (maximumEpoch === null || epoch > maximumEpoch) {
        maximumEpoch = epoch
        maximumOriginalTime = current.listTime
        idsAtMaximum.length = 0
        idsAtMaximum.push(current.listId)
      } else if (epoch === maximumEpoch && !idsAtMaximum.includes(current.listId)) {
        idsAtMaximum.push(current.listId)
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
        kind: 'complete',
        newListings,
        nextWatermark: accumulatedWatermark(),
        pagesRead,
        possibleMiss: false,
        checkpoint: null,
      }
    }

    if (pagesRead === maxPages) {
      const pendingWatermark = accumulatedWatermark()
      const lastObservation = previousObservation
        ? {
            listId: previousObservation.observation.listId,
            listTime: previousObservation.observation.listTime,
          }
        : null

      return {
        kind: 'incomplete',
        newListings,
        nextWatermark: previousWatermark,
        pagesRead,
        possibleMiss: true,
        checkpoint: {
          resumeCursor: page.nextCursor,
          pendingWatermark,
          lastObservation,
        },
      }
    }

    cursor = page.nextCursor
  }

  throw new Error('Watermark traversal loop terminated unexpectedly')
}
