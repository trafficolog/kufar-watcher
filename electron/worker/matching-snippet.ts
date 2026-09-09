import type { ListingMatchField, ListingMatchHit } from './listing-matcher'

export interface MatchingSnippetInput {
  text: string
  field: ListingMatchField
  hits: readonly ListingMatchHit[]
  maxLength: number
}

export function extractMatchingSnippet(_input: MatchingSnippetInput): string | null {
  return null
}
