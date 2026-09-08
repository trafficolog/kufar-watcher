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
  const page = await adapter.fetchPage({ query, cursor: null })

  const previousIds = new Set(previousWatermark.boundaryIds)
  const newListings: Listing[] = []
  const newlyObservedPreviousBoundaryIds: string[] = []
  const idsAtMaximum: string[] = []
  let maximumEpoch: number | null = null
  let maximumOriginalTime: string | null = null

  for (const current of page.listings) {
    const epoch = Date.parse(current.listTime)

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
        if (!newlyObservedPreviousBoundaryIds.includes(current.listId)) {
          newlyObservedPreviousBoundaryIds.push(current.listId)
        }
      }
      continue
    }

    break
  }

  let nextWatermark: Watermark

  if (maximumEpoch === null || maximumEpoch < previousEpoch) {
    nextWatermark = previousWatermark
  } else if (maximumEpoch === previousEpoch) {
    nextWatermark = {
      boundaryTime: previousWatermark.boundaryTime,
      boundaryIds: [
        ...new Set([...previousWatermark.boundaryIds, ...newlyObservedPreviousBoundaryIds]),
      ],
    }
  } else {
    nextWatermark = {
      boundaryTime: maximumOriginalTime as string,
      boundaryIds: idsAtMaximum,
    }
  }

  return {
    newListings,
    nextWatermark,
    pagesRead: 1,
    possibleMiss: false,
  }
}
