import type { PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { WatermarkTraversalResult } from '../../shared/watermark'
import type { ListingDescriptionResult } from './listing-description-cache'
import {
  commitMonitorRun,
  type MatchSelection,
  type SelectedListing,
} from './monitor-run-persistence'
import { traverseWatermark } from './watermark-traversal'

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
  ensureDescription(listing: Listing): Promise<ListingDescriptionResult>
}

export interface RunIncrementalMonitorInput {
  prisma: PrismaClient
  monitorId: number
  adapter: SourceAdapter
  maxPages: number
  selector?: CandidateSelector
  prefilter?: CandidatePrefilter
  descriptionLoader?: DescriptionLoader
  now?: () => Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseCanonicalQuery(value: unknown): CanonicalQuery {
  if (!isRecord(value)) throw new Error('Invalid persisted canonical query')

  if (
    typeof value.host !== 'string' ||
    !isNullableString(value.category) ||
    !isNullableString(value.query) ||
    !isNullableString(value.region) ||
    !isNullableString(value.sellerType) ||
    !isNullableString(value.sort) ||
    !isNullableString(value.operation) ||
    !isStringArray(value.pathFilters) ||
    !isRecord(value.extraParams)
  ) {
    throw new Error('Invalid persisted canonical query')
  }

  const extraParams: Record<string, string[]> = {}
  for (const [key, values] of Object.entries(value.extraParams)) {
    if (!isStringArray(values)) throw new Error('Invalid persisted canonical query')
    extraParams[key] = [...values]
  }

  return {
    host: value.host,
    category: value.category,
    query: value.query,
    region: value.region,
    sellerType: value.sellerType,
    sort: value.sort,
    operation: value.operation,
    pathFilters: [...value.pathFilters],
    extraParams,
  }
}

function parseBoundaryIds(value: unknown): string[] {
  if (!isStringArray(value)) {
    throw new Error('Invalid persisted cursor boundaryIds')
  }
  return [...value]
}

export async function runIncrementalMonitor({
  prisma,
  monitorId,
  adapter,
  maxPages,
  selector = acceptAllCandidateSelector,
  prefilter = acceptAllCandidatePrefilter,
  descriptionLoader,
  now = () => new Date(),
}: RunIncrementalMonitorInput): Promise<WatermarkTraversalResult> {
  const monitor = await prisma.monitor.findUniqueOrThrow({
    where: { id: monitorId },
    select: {
      query: true,
      searchInDescription: true,
      cursor: {
        select: {
          boundaryTime: true,
          boundaryIds: true,
          updatedAt: true,
        },
      },
    },
  })

  if (monitor.cursor === null || monitor.cursor.boundaryTime === null) {
    throw new ColdStartRequiredError(monitorId)
  }

  const query = parseCanonicalQuery(monitor.query)
  const previousWatermark = {
    boundaryTime: monitor.cursor.boundaryTime.toISOString(),
    boundaryIds: parseBoundaryIds(monitor.cursor.boundaryIds),
  }
  const expectedCursorUpdatedAt = monitor.cursor.updatedAt
  const startedAt = now()

  const traversal = await traverseWatermark({
    adapter,
    query,
    previousWatermark,
    maxPages,
  })

  const selected: SelectedListing[] = []
  for (const listing of traversal.newListings) {
    if (!(await prefilter.accept(listing))) continue

    let candidate = listing
    if (monitor.searchInDescription) {
      if (descriptionLoader === undefined) {
        throw new Error('Description loader is required when search in description is enabled')
      }

      const descriptionResult = await descriptionLoader.ensureDescription(listing)
      if (descriptionResult.kind === 'unavailable') continue

      candidate = {
        ...listing,
        description: descriptionResult.description,
      }
    }

    const selection = await selector.select(candidate)
    if (selection !== null) {
      selected.push({ listing: candidate, selection })
    }
  }

  const finishedAt = now()
  await commitMonitorRun(prisma, {
    monitorId,
    startedAt,
    finishedAt,
    expectedCursorUpdatedAt,
    candidates: traversal.newListings,
    selected,
    nextWatermark: traversal.nextWatermark,
  })

  return traversal
}
