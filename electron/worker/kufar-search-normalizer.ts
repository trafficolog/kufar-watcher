import type { JsonValue, Listing } from '../../shared/listing'
import type { SourcePage } from '../../shared/source-adapter'

export type KufarNormalizationErrorCode =
  'invalid-json' | 'invalid-page' | 'missing-field' | 'invalid-field'

export class KufarNormalizationError extends Error {
  constructor(
    readonly code: KufarNormalizationErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'KufarNormalizationError'
  }
}

export type KufarSearchAd = Record<string, unknown>

export interface KufarNormalizedPrice {
  priceKind: Listing['priceKind']
  priceAmount: string | null
  currency: string | null
}

interface KufarSearchNormalizerOptions {
  fallbackUrl: (adId: number) => string
  normalizePrice: (ad: KufarSearchAd, path: string) => KufarNormalizedPrice
}

export function isRecord(value: unknown): value is KufarSearchAd {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: KufarSearchAd, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

export function missing(path: string): never {
  throw new KufarNormalizationError('missing-field', path, `Missing required Kufar field: ${path}`)
}

export function invalid(path: string, message: string): never {
  throw new KufarNormalizationError('invalid-field', path, message)
}

function required(record: KufarSearchAd, key: string, path: string): unknown {
  if (!hasOwn(record, key)) missing(path)
  return record[key]
}

export function requiredNonEmptyString(record: KufarSearchAd, key: string, path: string): string {
  const value = required(record, key, path)
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(path, `Expected non-empty string at ${path}`)
  }
  return value
}

function requiredBoolean(record: KufarSearchAd, key: string, path: string): boolean {
  const value = required(record, key, path)
  if (typeof value !== 'boolean') invalid(path, `Expected boolean at ${path}`)
  return value
}

function requiredAdId(record: KufarSearchAd, path: string): number {
  const value = required(record, 'ad_id', path)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(path, `Expected non-negative safe integer at ${path}`)
  }
  return value
}

function requiredListTime(record: KufarSearchAd, path: string): string {
  const value = requiredNonEmptyString(record, 'list_time', path)
  if (!Number.isFinite(Date.parse(value))) invalid(path, `Expected valid timestamp at ${path}`)
  return value
}

export function minorUnitsToDecimal(raw: string, path: string): string {
  if (!/^\d+$/.test(raw)) invalid(path, `Expected digit-only minor units at ${path}`)

  const padded = raw.padStart(3, '0')
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`
}

function isKufarHostname(hostname: string): boolean {
  return hostname === 'kufar.by' || hostname.endsWith('.kufar.by')
}

function listingUrl(
  ad: KufarSearchAd,
  adId: number,
  path: string,
  fallbackUrl: (adId: number) => string,
): string {
  if (!hasOwn(ad, 'ad_link')) return fallbackUrl(adId)

  const rawLink = ad.ad_link
  if (typeof rawLink !== 'string') invalid(path, `Expected Kufar URL string at ${path}`)

  let url: URL
  try {
    url = new URL(rawLink)
  } catch {
    invalid(path, `Expected valid Kufar URL at ${path}`)
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isKufarHostname(url.hostname)) {
    invalid(path, `Expected Kufar HTTP(S) URL at ${path}`)
  }

  return rawLink
}

function regionFrom(ad: KufarSearchAd): string | null {
  if (!Array.isArray(ad.ad_parameters)) return null

  const region = ad.ad_parameters.find(
    (parameter) => isRecord(parameter) && parameter.p === 'region',
  )
  return isRecord(region) && typeof region.vl === 'string' ? region.vl : null
}

function descriptionFrom(ad: KufarSearchAd): string | null {
  return typeof ad.body_short === 'string' ? ad.body_short : null
}

function normalizeAd(
  value: unknown,
  index: number,
  options: KufarSearchNormalizerOptions,
): Listing {
  const path = `ads[${index}]`
  if (!isRecord(value)) invalid(path, `Expected object at ${path}`)

  const adId = requiredAdId(value, `${path}.ad_id`)
  const title = requiredNonEmptyString(value, 'subject', `${path}.subject`)
  const listTime = requiredListTime(value, `${path}.list_time`)
  const accountId = requiredNonEmptyString(value, 'account_id', `${path}.account_id`)
  const isCompany = requiredBoolean(value, 'company_ad', `${path}.company_ad`)

  return {
    listId: String(adId),
    title,
    ...options.normalizePrice(value, path),
    url: listingUrl(value, adId, `${path}.ad_link`, options.fallbackUrl),
    region: regionFrom(value),
    accountId,
    isCompany,
    listTime,
    description: descriptionFrom(value),
    raw: value as JsonValue,
  }
}

function nextCursor(pages: unknown[]): string | null {
  const next = pages.find((page) => isRecord(page) && page.label === 'next')
  if (next === undefined) return null
  if (next.token === null) return null

  if (!isRecord(next) || typeof next.token !== 'string') {
    invalid('pagination.pages[next].token', 'Expected opaque next cursor string')
  }

  return next.token
}

export function normalizeKufarSearchPage(
  body: Uint8Array,
  options: KufarSearchNormalizerOptions,
): SourcePage {
  let parsed: unknown

  try {
    parsed = JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    throw new KufarNormalizationError('invalid-json', '$', 'Kufar response is not valid JSON')
  }

  if (!isRecord(parsed)) {
    throw new KufarNormalizationError('invalid-page', '$', 'Kufar response root must be an object')
  }

  const ads = required(parsed, 'ads', 'ads')
  if (!Array.isArray(ads)) invalid('ads', 'Expected Kufar ads array')

  if (!hasOwn(parsed, 'pagination')) missing('pagination.pages')
  const pagination = parsed.pagination
  if (!isRecord(pagination)) invalid('pagination', 'Expected Kufar pagination object')

  const pages = required(pagination, 'pages', 'pagination.pages')
  if (!Array.isArray(pages)) invalid('pagination.pages', 'Expected Kufar pagination pages array')

  return {
    listings: ads.map((ad, index) => normalizeAd(ad, index, options)),
    nextCursor: nextCursor(pages),
  }
}
