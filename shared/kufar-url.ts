import type { CanonicalQuery, SellerType } from './canonical-query'

export type KufarUrlParseErrorCode =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'foreign-host'
  | 'not-listing-url'
  | 'invalid-seller-filter'

export class KufarUrlParseError extends Error {
  readonly code: KufarUrlParseErrorCode

  constructor(code: KufarUrlParseErrorCode, message: string) {
    super(message)
    this.name = 'KufarUrlParseError'
    this.code = code
  }
}

export type KufarUrlBuildErrorCode = 'unsupported-api-mapping'

export class KufarUrlBuildError extends Error {
  readonly code: KufarUrlBuildErrorCode

  constructor(code: KufarUrlBuildErrorCode, message: string) {
    super(message)
    this.name = 'KufarUrlBuildError'
    this.code = code
  }
}

const PAGINATION_PARAMS = new Set(['cursor', 'size'])
const REAL_ESTATE_OPERATIONS = new Set(['kupit', 'snyat'])
const SELLER_MARKER = 'bez-posrednikov'
const SELLER_PARAM = 'cmp'
const API_SEARCH_URL = 'https://api.kufar.by/search-api/v2/search/rendered-paginated'

interface PathSemantics {
  category: string | null
  query: string | null
  region: string | null
  sellerType: SellerType | null
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

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment)
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
      result.sellerType = 'private'
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
  const [first, ...remaining] = segments

  if (first !== undefined && REAL_ESTATE_OPERATIONS.has(first)) {
    result.operation = first
  } else {
    result.region = first ?? null
  }

  let categoryFound = false
  for (const segment of remaining) {
    if (result.operation === null && REAL_ESTATE_OPERATIONS.has(segment)) {
      result.operation = segment
      continue
    }

    if (segment === SELLER_MARKER) {
      result.sellerType = 'private'
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

function parseSellerParam(value: string): SellerType {
  if (value === '0' || value === 'false') return 'private'
  if (value === '1' || value === 'true') return 'company'

  throw new KufarUrlParseError(
    'invalid-seller-filter',
    `Unsupported Kufar seller filter value: ${value}`,
  )
}

function mergeSellerType(current: SellerType | null, next: SellerType): SellerType {
  if (current !== null && current !== next) {
    throw new KufarUrlParseError(
      'invalid-seller-filter',
      'Kufar URL contains conflicting seller filter values',
    )
  }

  return next
}

function parseQueryParams(url: URL): {
  sort: string | null
  sellerType: SellerType | null
  extraParams: Record<string, string[]>
} {
  let sort: string | null = null
  let sellerType: SellerType | null = null
  const extraParams: Record<string, string[]> = {}

  for (const [key, value] of url.searchParams) {
    if (PAGINATION_PARAMS.has(key)) {
      continue
    }

    if (key === 'sort') {
      sort ??= value
      continue
    }

    if (key === SELLER_PARAM) {
      sellerType = mergeSellerType(sellerType, parseSellerParam(value))
      continue
    }

    const existing = extraParams[key]
    if (existing === undefined) {
      extraParams[key] = [value]
    } else {
      existing.push(value)
    }
  }

  return { sort, sellerType, extraParams }
}

function buildListingPath(query: CanonicalQuery): string {
  const segments = ['l']

  if (query.host === 're.kufar.by') {
    if (query.region !== null) segments.push(query.region)
    if (query.operation !== null) segments.push(query.operation)
    if (query.category !== null) segments.push(query.category)
    segments.push(...query.pathFilters)
    if (query.sellerType === 'private') segments.push(SELLER_MARKER)
  } else {
    if (query.region !== null) segments.push(`r~${query.region}`)
    if (query.category !== null) segments.push(query.category)
    segments.push(...query.pathFilters)
    if (query.sellerType === 'private') segments.push(SELLER_MARKER)
    if (query.query !== null) segments.push(`q~${query.query}`)
  }

  return `/${segments.map(encodePathSegment).join('/')}`
}

function appendSortedParams(searchParams: URLSearchParams, params: Record<string, string[]>): void {
  for (const key of Object.keys(params).sort()) {
    for (const value of params[key] ?? []) {
      searchParams.append(key, value)
    }
  }
}

function canonicalExtras(query: CanonicalQuery): Record<string, string[]> {
  const result: Record<string, string[]> = {}

  for (const [key, values] of Object.entries(query.extraParams)) {
    if (!PAGINATION_PARAMS.has(key) && key !== 'sort' && key !== SELLER_PARAM) {
      result[key] = [...values]
    }
  }

  return result
}

function sellerApiParams(sellerType: SellerType | null): Record<string, string[]> {
  if (sellerType === null) return {}
  return { [SELLER_PARAM]: [sellerType === 'private' ? '0' : '1'] }
}

function confirmedApiParams(query: CanonicalQuery): Record<string, string[]> {
  if (
    query.host !== 're.kufar.by' &&
    query.host !== 'auto.kufar.by' &&
    query.category === 'igry-i-pristavki' &&
    query.region === 'minsk' &&
    query.operation === null &&
    query.pathFilters.length === 0
  ) {
    return {
      ...canonicalExtras(query),
      ...sellerApiParams(query.sellerType),
      cat: ['5040'],
      lang: ['ru'],
      ...(query.query === null ? {} : { query: [query.query] }),
      rgn: ['7'],
      sort: ['lst.d'],
    }
  }

  if (
    query.host === 're.kufar.by' &&
    query.category === 'kvartiru' &&
    query.region === 'minsk' &&
    query.operation === 'kupit' &&
    query.query === null &&
    query.pathFilters.length === 0
  ) {
    return {
      ...canonicalExtras(query),
      ...sellerApiParams(query.sellerType),
      cat: ['1010'],
      gtsy: ['country-belarus~province-minsk~locality-minsk'],
      lang: ['ru'],
      sort: ['lst.d'],
      typ: ['sell'],
    }
  }

  throw new KufarUrlBuildError(
    'unsupported-api-mapping',
    'CanonicalQuery contains Kufar API semantics that are not confirmed by the current contract',
  )
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
  const sellerType =
    queryParams.sellerType === null
      ? path.sellerType
      : mergeSellerType(path.sellerType, queryParams.sellerType)

  return {
    host: url.hostname,
    category: path.category,
    query: path.query,
    region: path.region,
    sellerType,
    sort: queryParams.sort,
    operation: path.operation,
    pathFilters: path.pathFilters,
    extraParams: queryParams.extraParams,
  }
}

export function buildKufarListingUrl(query: CanonicalQuery): string {
  const url = new URL(`https://${query.host}`)
  url.pathname = buildListingPath(query)

  if (query.sort !== null) {
    url.searchParams.append('sort', query.sort)
  }
  if (query.sellerType === 'company') {
    url.searchParams.append(SELLER_PARAM, '1')
  }
  appendSortedParams(url.searchParams, canonicalExtras(query))

  return url.toString()
}

export function buildKufarApiUrl(query: CanonicalQuery): string {
  const url = new URL(API_SEARCH_URL)
  appendSortedParams(url.searchParams, confirmedApiParams(query))
  return url.toString()
}
