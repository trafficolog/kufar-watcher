import type { CanonicalQuery } from './canonical-query'
import type { Listing } from './listing'

export interface SourcePageRequest {
  query: CanonicalQuery
  cursor: string | null
}

export interface SourcePage {
  listings: Listing[]
  nextCursor: string | null
}

export interface SourceAdapter {
  fetchPage(request: SourcePageRequest): Promise<SourcePage>
}
