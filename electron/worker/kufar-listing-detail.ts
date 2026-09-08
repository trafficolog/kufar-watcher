import type { KufarHttpResult } from './kufar-http-client'

export type KufarDetailNormalizationErrorCode = 'invalid-json' | 'invalid-detail' | 'id-mismatch'

export class KufarDetailNormalizationError extends Error {
  constructor(
    readonly code: KufarDetailNormalizationErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'KufarDetailNormalizationError'
  }
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function invalid(code: KufarDetailNormalizationErrorCode, path: string, message: string): never {
  throw new KufarDetailNormalizationError(code, path, message)
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    return invalid('invalid-json', '$', 'Kufar detail response is not valid JSON')
  }
}

function assertExpectedId(result: UnknownRecord, key: 'ad_id' | 'list_id', expectedListId: string) {
  if (!hasOwn(result, key)) return

  const value = result[key]
  const validValue =
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && value.length > 0)

  if (!validValue || String(value) !== expectedListId) {
    invalid('id-mismatch', `result.${key}`, `Kufar detail ${key} does not match requested listing`)
  }
}

export function parseKufarFullDescription(body: Uint8Array, expectedListId: string): string {
  const parsed = parseJson(body)
  if (!isRecord(parsed)) invalid('invalid-detail', '$', 'Kufar detail root must be an object')

  const result = parsed.result
  if (!isRecord(result)) invalid('invalid-detail', 'result', 'Kufar detail result must be an object')

  assertExpectedId(result, 'ad_id', expectedListId)
  assertExpectedId(result, 'list_id', expectedListId)

  if (typeof result.body !== 'string') {
    invalid('invalid-detail', 'result.body', 'Kufar detail body must be a string')
  }

  return result.body
}

export function isConfirmedKufarGone(
  failure: Extract<KufarHttpResult, { ok: false }>,
): boolean {
  if (failure.status !== 404 || !('body' in failure)) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(failure.body)) as unknown
  } catch {
    return false
  }

  if (!isRecord(parsed) || !isRecord(parsed.error) || parsed.error.code !== 'ASR0006') {
    return false
  }

  if (hasOwn(parsed.error, 'http')) {
    if (!isRecord(parsed.error.http) || parsed.error.http.code !== 404) return false
  }

  return true
}
