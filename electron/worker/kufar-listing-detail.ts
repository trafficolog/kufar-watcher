const decoder = new TextDecoder()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(body))
  } catch {
    throw new KufarListingDetailParseError('Kufar listing detail is not valid JSON')
  }
}

export class KufarListingDetailParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KufarListingDetailParseError'
  }
}

export function parseKufarListingDescription(body: Uint8Array): string | null {
  const payload = decodeJson(body)

  if (!isRecord(payload) || !isRecord(payload.result) || !('body' in payload.result)) {
    throw new KufarListingDetailParseError('Kufar listing detail is missing result.body')
  }

  const description = payload.result.body
  if (typeof description !== 'string' && description !== null) {
    throw new KufarListingDetailParseError('Kufar listing detail result.body has invalid type')
  }

  return description
}

export function hasKufarListingNotFoundCode(body: Uint8Array): boolean {
  let payload: unknown

  try {
    payload = JSON.parse(decoder.decode(body))
  } catch {
    return false
  }

  return isRecord(payload) && isRecord(payload.error) && payload.error.code === 'ASR0006'
}
