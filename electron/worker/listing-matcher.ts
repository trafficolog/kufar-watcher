import { tokenizeMatchingText } from './matching-normalization'
import { matchingTermCompiler } from './matching-term-compiler'

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

interface TokenizedField {
  field: ListingMatchField
  tokens: string[]
}

function collectHits(
  terms: readonly string[],
  kind: ListingMatchKind,
  fields: readonly TokenizedField[],
): ListingMatchHit[] {
  const hits: ListingMatchHit[] = []

  for (const term of terms) {
    const matches = matchingTermCompiler.compile(term)

    for (const { field, tokens } of fields) {
      if (tokens.some((token) => matches(token))) {
        hits.push({ term, field, kind })
      }
    }
  }

  return hits
}

export function matchListing(input: ListingMatchInput): ListingMatchResult {
  const fields = input.fields.flatMap((field): TokenizedField[] => {
    const value = input.document[field]
    return typeof value === 'string' ? [{ field, tokens: tokenizeMatchingText(value) }] : []
  })

  const includeHits = collectHits(input.include, 'include', fields)
  const excludeHits = collectHits(input.exclude, 'exclude', fields)

  return {
    matched: (input.include.length === 0 || includeHits.length > 0) && excludeHits.length === 0,
    hits: [...includeHits, ...excludeHits],
  }
}
