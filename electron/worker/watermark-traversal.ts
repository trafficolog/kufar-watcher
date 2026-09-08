import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { Watermark, WatermarkTraversalResult } from '../../shared/watermark'

export interface TraverseWatermarkInput {
  adapter: SourceAdapter
  query: CanonicalQuery
  previousWatermark: Watermark
  maxPages: number
}

export type WatermarkTraversalConfigField = 'maxPages' | 'previousWatermark.boundaryTime'

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

export class WatermarkOrderingError extends Error {
  constructor(
    readonly previous: WatermarkOrderingObservation,
    readonly current: WatermarkOrderingObservation,
  ) {
    super('Watermark traversal source order is not non-increasing')
    this.name = 'WatermarkOrderingError'
  }
}

function parsePreviousBoundary(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new WatermarkTraversalConfigError('previousWatermark.boundaryTime', value)
  }
  return parsed
}

function assertMaxPages(maxPages: number): void {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new WatermarkTraversalConfigError('maxPages', maxPages)
  }
}

export async function traverseWatermark({
  adapter,
  query,
  previousWatermark,
  maxPages,
}: TraverseWatermarkInput): Promise<WatermarkTraversalResult> {
  assertMaxPages(maxPages)
  const previousEpoch = parsePreviousBoundary(previousWatermark.boundaryTime)

  const previousIds = new Set(previousWatermark.boundaryIds)
  const seenIds = new Set<string>()
  const newListings: Listing[] = []
  const newlyObservedPreviousBoundaryIds: string[] = []
  const idsAtMaximum: string[] = []
  let maximumEpoch: number | null = null
  let maximumOriginalTime: string | null = null
  let cursor: string | null = null
  let pagesRead = 0
  let boundaryCrossed = false
  let previousObservation: { observation: WatermarkOrderingObservation; epoch: number } | null = null

  const completedWatermark = (): Watermark => {
    if (maximumEpoch === null || maximumEpoch < previousEpoch) {
      return previousWatermark
    }

    if (maximumEpoch === previousEpoch) {
      return {
        boundaryTime: previousWatermark.boundaryTime,
        boundaryIds: [
          ...new Set([...previousWatermark.boundaryIds, ...newlyObservedPreviousBoundaryIds]),
        ],
      }
    }

    return {
      boundaryTime: maximumOriginalTime as string,
      boundaryIds: idsAtMaximum,
    }
  }

  while (pagesRead < maxPages) {
    const page = await adapter.fetchPage({ query, cursor })
    pagesRead += 1

    for (const [index, current] of page.listings.entries()) {
      if (seenIds.has(current.listId)) continue
      seenIds.add(current.listId)

      const epoch = Date.parse(current.listTime)
      const observation: WatermarkOrderingObservation = {
        page: pagesRead,
        index,
        listId: current.listId,
        listTime: current.listTime,
      }

      if (previousObservation !== null && epoch > previousObservation.epoch) {
        throw new WatermarkOrderingError(previousObservation.observation, observation)
      }
      previousObservation = { observation, epoch }

      if (maximumEpoch === null || epoch > maximumEpoch) {
        maximumEpoch = epoch
        maximumOriginalTime = current.listTime
        idsAtMaximum.length = 0
        idsAtMaximum.push(current.listId)
      } else if (epoch === maximumEpoch) {
        idsAtMaximum.push(current.listId)
      }

      if (epoch > previousEpoch) {
        newListings.push(current)
        continue
      }

      if (epoch === previousEpoch) {
        if (!previousIds.has(current.listId)) {
          newListings.push(current)
          newlyObservedPreviousBoundaryIds.push(current.listId)
        }
        continue
      }

      boundaryCrossed = true
      break
    }

    if (boundaryCrossed || page.nextCursor === null) {
      return {
        newListings,
        nextWatermark: completedWatermark(),
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
      }
    }

    cursor = page.nextCursor
  }

  throw new Error('Watermark traversal loop terminated unexpectedly')
}
