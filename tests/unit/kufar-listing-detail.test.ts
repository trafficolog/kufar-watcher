import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { KufarHttpResult } from '../../electron/worker/kufar-http-client'
import {
  isConfirmedKufarGone,
  KufarDetailNormalizationError,
  parseKufarFullDescription,
} from '../../electron/worker/kufar-listing-detail'

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url)))
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function httpFailure(status: number, body: Uint8Array): Extract<KufarHttpResult, { ok: false }> {
  return {
    ok: false,
    kind: 'permanent',
    code: 'http-4xx',
    status,
    body,
    attempts: 1,
    message: `HTTP ${status}`,
  }
}

async function expectedDescription(name: string): Promise<string> {
  const parsed = JSON.parse(new TextDecoder().decode(await fixtureBytes(name))) as {
    result: { body: string }
  }
  return parsed.result.body
}

describe('Kufar listing detail parser', () => {
  it('returns the full electronics description unchanged', async () => {
    const fixture = '2026-09-07-electronics-negotiable-detail.json'

    expect(parseKufarFullDescription(await fixtureBytes(fixture), '1082715190')).toBe(
      await expectedDescription(fixture),
    )
  })

  it('returns the full real-estate description unchanged', async () => {
    const fixture = '2026-09-07-realestate-item-1079260955-detail.json'

    expect(parseKufarFullDescription(await fixtureBytes(fixture), '1079260955')).toBe(
      await expectedDescription(fixture),
    )
  })

  it('accepts an empty full description because the contract requires a string, not non-empty text', () => {
    const body = encodeJson({ result: { ad_id: 42, list_id: 42, body: '' } })

    expect(parseKufarFullDescription(body, '42')).toBe('')
  })

  it.each([
    { label: 'invalid JSON', body: new TextEncoder().encode('{'), expectedPath: '$' },
    { label: 'missing result', body: encodeJson({}), expectedPath: 'result' },
    {
      label: 'non-string body',
      body: encodeJson({ result: { ad_id: 42, list_id: 42, body: null } }),
      expectedPath: 'result.body',
    },
    {
      label: 'mismatched ad_id',
      body: encodeJson({ result: { ad_id: 43, list_id: 42, body: 'text' } }),
      expectedPath: 'result.ad_id',
    },
    {
      label: 'mismatched list_id',
      body: encodeJson({ result: { ad_id: 42, list_id: '43', body: 'text' } }),
      expectedPath: 'result.list_id',
    },
  ])('rejects $label as detail contract drift', ({ body, expectedPath }) => {
    try {
      parseKufarFullDescription(body, '42')
      throw new Error('Expected detail normalization to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(KufarDetailNormalizationError)
      expect(error).toMatchObject({ path: expectedPath })
    }
  })

  it('recognizes the confirmed 404 + ASR0006 fixture as gone', async () => {
    const failure = httpFailure(
      404,
      await fixtureBytes('2026-09-07-electronics-detail-not-found.json'),
    )

    expect(isConfirmedKufarGone(failure)).toBe(true)
  })

  it.each([
    {
      label: 'other error code',
      status: 404,
      body: encodeJson({ error: { code: 'OTHER', http: { code: 404 } } }),
    },
    { label: 'malformed JSON', status: 404, body: new TextEncoder().encode('{') },
    {
      label: 'mismatched nested HTTP code',
      status: 404,
      body: encodeJson({ error: { code: 'ASR0006', http: { code: 410 } } }),
    },
    {
      label: 'same payload on non-404 response',
      status: 410,
      body: encodeJson({ error: { code: 'ASR0006', http: { code: 404 } } }),
    },
  ])('does not classify $label as gone', ({ status, body }) => {
    expect(isConfirmedKufarGone(httpFailure(status, body))).toBe(false)
  })
})
