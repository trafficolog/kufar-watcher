import type { CanonicalQuery } from './canonical-query'

export type KufarUrlParseErrorCode =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'foreign-host'
  | 'not-listing-url'

export class KufarUrlParseError extends Error {
  readonly code: KufarUrlParseErrorCode

  constructor(code: KufarUrlParseErrorCode, message: string) {
    super(message)
    this.name = 'KufarUrlParseError'
    this.code = code
  }
}

const PAGINATION_PARAMS = new Set(['cursor', 'size'])
const REAL_ESTATE_OPERATIONS = new Set(['kupit', 'snyat'])
const SELLER_MARKER = 'bez-posrednikov'

interface PathSemantics {
  category: string | null
  query: string | null
  region: string | null
  sellerType: string | null
  operation: string | null
  pathFilters: string[]
}

function parseUrl(input: string): URL {
  try {
    return new URL(input)
  } catch {
    throw new KufarUrlParseError('invalid-url', 'The value is not a valid URL')
  }
}

function isKufarHostname(hostname: string): boolean {
  return hostname === 'kufar.by' || hostname.endsWith('.kufar.by')
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new KufarUrlParseError('invalid-url', 'The URL contains an invalid encoded path segment')
  }
}

function listingSegments(url: URL): string[] {
  const segments = url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodePathSegment)

  if (segments[0] !== 'l') {
    throw new KufarUrlParseError(
      'not-listing-url',
      'The Kufar URL does not point to a listing route',
    )
  }

  return segments.slice(1)
}

function emptyPathSemantics(): PathSemantics {
  return {
    category: null,
    query: null,
    region: null,
    sellerType: null,
    operation: null,
    pathFilters: [],
  }
}

function parseGoodsPath(segments: string[]): PathSemantics {
  const result = emptyPathSemantics()

  for (const segment of segments) {
    if (segment.startsWith('r~')) {
      result.region = segment.slice(2)
      continue
    }

    if (segment.startsWith('q~')) {
      result.query = segment.slice(2)
      continue
    }

    if (segment === SELLER_MARKER) {
      result.sellerType = SELLER_MARKER
      continue
    }

    if (result.category === null) {
      result.category = segment
      continue
    }

    result.pathFilters.push(segment)
  }

  return result
}

function parseRealEstatePath(segments: string[]): PathSemantics {
  const result = emptyPathSemantics()
  const [region, ...remaining] = segments

  result.region = region ?? null

  let categoryFound = false
  for (const segment of remaining) {
    if (result.operation === null && REAL_ESTATE_OPERATIONS.has(segment)) {
      result.operation = segment
      continue
    }

    if (segment === SELLER_MARKER) {
      result.sellerType = SELLER_MARKER
      continue
    }

    if (!categoryFound) {
      result.category = segment
      categoryFound = true
      continue
    }

    result.pathFilters.push(segment)
  }

  return result
}

function parseQueryParams(url: URL): {
  sort: string | null
  extraParams: Record<string, string[]>
} {
  let sort: string | null = null
  const extraParams: Record<string, string[]> = {}

  for (const [key, value] of url.searchParams) {
    if (PAGINATION_PARAMS.has(key)) {
      continue
    }

    if (key === 'sort') {
      sort ??= value
      continue
    }

    const existing = extraParams[key]
    if (existing === undefined) {
      extraParams[key] = [value]
    } else {
      existing.push(value)
    }
  }

  return { sort, extraParams }
}

export function parseKufarListingUrl(input: string): CanonicalQuery {
  const url = parseUrl(input)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new KufarUrlParseError(
      'unsupported-protocol',
      'Kufar listing URLs must use HTTP or HTTPS',
    )
  }

  if (!isKufarHostname(url.hostname)) {
    throw new KufarUrlParseError(
      'foreign-host',
      'The URL hostname is not kufar.by or a kufar.by subdomain',
    )
  }

  const segments = listingSegments(url)
  const path =
    url.hostname === 're.kufar.by' ? parseRealEstatePath(segments) : parseGoodsPath(segments)
  const queryParams = parseQueryParams(url)

  return {
    host: url.hostname,
    category: path.category,
    query: path.query,
    region: path.region,
    sellerType: path.sellerType,
    sort: queryParams.sort,
    operation: path.operation,
    pathFilters: path.pathFilters,
    extraParams: queryParams.extraParams,
  }
}
