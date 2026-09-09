import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  hasKufarListingNotFoundCode,
  KufarListingDetailParseError,
  parseKufarListingDescription,
} from '../../electron/worker/kufar-listing-detail'

const encoder = new TextEncoder()
const EXPECTED_DESCRIPTION = [
  'Помогу с оформлением на ваш аккаунт. ',
  'NHL 27 для PS5 и Xbox Series X/S',
  'Цифровая версия, не диск. ',
  '',
  'Самозанятая Прохорова Ирина Олеговна ',
  'УНП CE6716956',
].join('\n')

async function fixture(name: string): Promise<Uint8Array> {
  return readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url))
}

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

describe('Kufar listing detail contract', () => {
  it('returns only the full result.body from a captured detail response', async () => {
    const body = await fixture('2026-09-07-electronics-negotiable-detail.json')

    expect(parseKufarListingDescription(body)).toBe(EXPECTED_DESCRIPTION)
  })

  it('accepts null as a successfully loaded description', () => {
    expect(parseKufarListingDescription(json({ result: { body: null } }))).toBeNull()
  })

  it.each([
    { label: 'invalid JSON', body: encoder.encode('{') },
    { label: 'missing result', body: json({}) },
    { label: 'missing body', body: json({ result: {} }) },
    { label: 'numeric body', body: json({ result: { body: 42 } }) },
  ])('rejects malformed success payload: $label', ({ body }) => {
    expect(() => parseKufarListingDescription(body)).toThrow(KufarListingDetailParseError)
  })

  it('recognizes the captured ASR0006 listing-not-found payload', async () => {
    const body = await fixture('2026-09-07-electronics-detail-not-found.json')

    expect(hasKufarListingNotFoundCode(body)).toBe(true)
  })

  it.each([json({ error: { code: 'OTHER' } }), json({ error: {} }), json({}), encoder.encode('{')])(
    'rejects non-ASR0006 failure payloads',
    (body) => {
      expect(hasKufarListingNotFoundCode(body)).toBe(false)
    },
  )
})
