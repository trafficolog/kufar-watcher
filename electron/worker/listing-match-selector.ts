import type { Listing } from '../../shared/listing'
import { matchListing, type ListingMatchField } from './listing-matcher'
import type { MatchSelection } from './monitor-run-persistence'

export interface PersistedKeywordRule {
  include: readonly string[]
  exclude: readonly string[]
}

export class PersistedKeywordRuleError extends Error {
  constructor() {
    super('Invalid persisted keyword rule')
    this.name = 'PersistedKeywordRuleError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function parsePersistedKeywordRule(value: unknown): PersistedKeywordRule {
  if (isStringArray(value)) {
    return { include: [...value], exclude: [] }
  }

  if (!isRecord(value) || !isStringArray(value.include) || !isStringArray(value.exclude)) {
    throw new PersistedKeywordRuleError()
  }

  return {
    include: [...value.include],
    exclude: [...value.exclude],
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
