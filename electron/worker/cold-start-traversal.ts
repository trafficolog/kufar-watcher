import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { Watermark } from '../../shared/watermark'
import {
  parseListingObservationEpoch,
  WatermarkOrderingError,
  type WatermarkOrderingObservation,
  WatermarkTraversalConfigError,
} from './watermark-traversal'

export interface TraverseColdStartBaselineInput {
  adapter: SourceAdapter
  query: CanonicalQuery
  maxPages: number
  startedAt: Date
}

export interface ColdStartTraversalResult {
  listings: Listing[]
  baselineCount: number
  pagesRead: number
  nextWatermark: Watermark
}

export class IncompleteColdStartBaselineError extends Error {
  constructor(
    readonly maxPages: number,
    readonly pagesRead: number,
  ) {
    super(`Cold-start baseline is incomplete after ${pagesRead} page(s)`)
    this.name = 'IncompleteColdStartBaselineError'
  }
}

interface OrderingState {
  observation: WatermarkOrderingObservation
  epoch: number
}

function assertMaxPages(maxPages: number): void {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new WatermarkTraversalConfigError('maxPages', maxPages)
  }
}

export async function traverseColdStartBaseline({
  adapter,
  query,
  maxPages,
  startedAt,
}: TraverseColdStartBaselineInput): Promise<ColdStartTraversalResult> {
  assertMaxPages(maxPages)

  const seenIds = new Set<string>()
  const listings: Listing[] = []
  const boundaryIds: string[] = []
  let boundaryEpoch: number | null = null
  let boundaryTime: string | null = null
  let previousObservation: OrderingState | null = null
  let cursor: string | null = null
  let pagesRead = 0

  while (pagesRead < maxPages) {
    const page = await adapter.fetchPage({ query, cursor })
    pagesRead += 1

    if (pagesRead === 1 && page.listings.length === 0) {
      return {
        listings: [],
        baselineCount: 0,
        pagesRead,
        nextWatermark: {
          boundaryTime: startedAt.toISOString(),
          boundaryIds: [],
        },
      }
    }

    let topTimeTieClosed = false

    for (const [index, current] of page.listings.entries()) {
      if (seenIds.has(current.listId)) continue
      seenIds.add(current.listId)
      listings.push(current)

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

      if (boundaryEpoch === null) {
        boundaryEpoch = epoch
        boundaryTime = current.listTime
        boundaryIds.push(current.listId)
        continue
      }

      if (epoch === boundaryEpoch) {
        boundaryIds.push(current.listId)
        continue
      }

      if (epoch < boundaryEpoch) {
        topTimeTieClosed = true
      }
    }

    if (boundaryEpoch !== null && (topTimeTieClosed || page.nextCursor === null)) {
      return {
        listings,
        baselineCount: listings.length,
        pagesRead,
        nextWatermark: {
          boundaryTime: boundaryTime as string,
          boundaryIds,
        },
      }
    }

    if (pagesRead === maxPages) {
      throw new IncompleteColdStartBaselineError(maxPages, pagesRead)
    }

    cursor = page.nextCursor
  }

  throw new Error('Cold-start traversal loop terminated unexpectedly')
}
