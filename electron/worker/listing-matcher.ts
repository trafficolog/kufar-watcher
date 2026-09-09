export type ListingMatchField = 'title' | 'description'
export type ListingMatchKind = 'include' | 'exclude'

export interface ListingMatchHit {
  term: string
  field: ListingMatchField
  kind: ListingMatchKind
}

export interface ListingMatchDocument {
  title: string
  description?: string
}

export interface ListingMatchInput {
  include: readonly string[]
  exclude: readonly string[]
  document: ListingMatchDocument
  fields: readonly ListingMatchField[]
}

export interface ListingMatchResult {
  matched: boolean
  hits: ListingMatchHit[]
}

export function matchListing(_input: ListingMatchInput): ListingMatchResult {
  return { matched: false, hits: [] }
}
