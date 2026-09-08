import { isRecord } from './kufar-search-normalizer'

export type KufarEmbeddedStateErrorCode =
  'missing-next-data' | 'invalid-next-data-json' | 'invalid-search-state'

export class KufarEmbeddedStateError extends Error {
  constructor(
    readonly code: KufarEmbeddedStateErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'KufarEmbeddedStateError'
  }
}

export interface EmbeddedState {
  scriptId: '__NEXT_DATA__'
  value: unknown
}

const NEXT_DATA_OPEN = '<script id="__NEXT_DATA__" type="application/json">'
const SCRIPT_CLOSE = '</script>'

function invalidSearchState(path: string, message: string): never {
  throw new KufarEmbeddedStateError('invalid-search-state', path, message)
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalidSearchState(path, `Expected object at ${path}`)
  return value
}

export function extractKufarEmbeddedState(html: Uint8Array): EmbeddedState {
  const source = new TextDecoder().decode(html)
  const openIndex = source.indexOf(NEXT_DATA_OPEN)
  if (openIndex < 0) {
    throw new KufarEmbeddedStateError(
      'missing-next-data',
      '$',
      'Kufar HTML does not contain the confirmed __NEXT_DATA__ carrier',
    )
  }

  const contentStart = openIndex + NEXT_DATA_OPEN.length
  const closeIndex = source.indexOf(SCRIPT_CLOSE, contentStart)
  if (closeIndex < 0) {
    throw new KufarEmbeddedStateError(
      'missing-next-data',
      '$',
      'Kufar __NEXT_DATA__ carrier is not closed',
    )
  }

  let value: unknown
  try {
    value = JSON.parse(source.slice(contentStart, closeIndex)) as unknown
  } catch {
    throw new KufarEmbeddedStateError(
      'invalid-next-data-json',
      '$',
      'Kufar __NEXT_DATA__ value is not valid JSON',
    )
  }

  return {
    scriptId: '__NEXT_DATA__',
    value,
  }
}

export function kufarSearchPayloadFromEmbeddedState(state: unknown): Uint8Array {
  const root = requiredRecord(state, 'props.initialState.listing')
  const props = requiredRecord(root.props, 'props.initialState.listing')
  const initialState = requiredRecord(props.initialState, 'props.initialState.listing')
  const listing = requiredRecord(initialState.listing, 'props.initialState.listing')

  if (!Array.isArray(listing.ads)) {
    invalidSearchState('props.initialState.listing.ads', 'Expected embedded Kufar ads array')
  }
  if (!Array.isArray(listing.pagination)) {
    invalidSearchState(
      'props.initialState.listing.pagination',
      'Expected embedded Kufar pagination array',
    )
  }

  const payload: Record<string, unknown> = {
    ads: listing.ads,
    pagination: { pages: listing.pagination },
  }

  if (Object.prototype.hasOwnProperty.call(listing, 'total')) {
    payload.total = listing.total
  }

  return new TextEncoder().encode(JSON.stringify(payload))
}
