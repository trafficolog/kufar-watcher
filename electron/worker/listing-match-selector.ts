import type { Listing } from '../../shared/listing'
import { matchListing, type ListingMatchField } from './listing-matcher'
import type { MatchSelection } from './monitor-run-persistence'

export interface PersistedKeywordRule {
  include: readonly string[]
  exclude: readonly string[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function parsePersistedKeywordRule(value: unknown): PersistedKeywordRule {
  const record = value as { include?: unknown; exclude?: unknown }
  return {
    include: isStringArray(record.include) ? [...record.include] : [],
    exclude: isStringArray(record.exclude) ? [...record.exclude] : [],
  }
}

export function createMatchingCandidateSelector(input: {
  rule: PersistedKeywordRule
  searchInDescription: boolean
}) {
  const fields: ListingMatchField[] = input.searchInDescription
    ? ['title', 'description']
    : ['title']

  return {
    async select(listing: Listing): Promise<MatchSelection | null> {
      const result = matchListing({
        include: input.rule.include,
        exclude: input.rule.exclude,
        document: {
          title: listing.title,
          description: listing.description ?? undefined,
        },
        fields,
      })

      if (!result.matched) return null

      const includeHits = result.hits.filter(({ kind }) => kind === 'include')
      return {
        matchedTerms: unique(includeHits.map(({ term }) => term)),
        matchedIn: unique(includeHits.map(({ field }) => field)),
        snippet: null,
      }
    },
  }
}
