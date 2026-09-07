import { describe, expect, it } from 'vitest'
import {
  KufarUrlParseError,
  parseKufarListingUrl,
  type KufarUrlParseErrorCode,
} from '../../shared/kufar-url'

function expectParseError(input: string, code: KufarUrlParseErrorCode): void {
  try {
    parseKufarListingUrl(input)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(KufarUrlParseError)
    expect((error as KufarUrlParseError).code).toBe(code)
    expect((error as Error).message.length).toBeGreaterThan(0)
    return
  }

  throw new Error(`Expected ${code} for ${input}`)
}

describe('parseKufarListingUrl', () => {
  it('parses a goods listing with region, category, search query, and sort', () => {
    const result = parseKufarListingUrl(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?sort=lst.d',
    )

    expect(result).toEqual({
      host: 'www.kufar.by',
      category: 'igry-i-pristavki',
      query: 'ps5',
      region: 'minsk',
      sellerType: null,
      sort: 'lst.d',
      operation: null,
      pathFilters: [],
      extraParams: {},
    })
  })

  it('parses a goods listing without a region and preserves unknown parameters', () => {
    const result = parseKufarListingUrl('https://www.kufar.by/l/elektronika?cur=BYN')

    expect(result).toEqual({
      host: 'www.kufar.by',
      category: 'elektronika',
      query: null,
      region: null,
      sellerType: null,
      sort: null,
      operation: null,
      pathFilters: [],
      extraParams: { cur: ['BYN'] },
    })
  })

  it('parses the observed real-estate route semantics and seller marker', () => {
    const result = parseKufarListingUrl(
      'https://re.kufar.by/l/minsk/kupit/kvartiru/1k/bez-posrednikov?cur=USD',
    )

    expect(result).toEqual({
      host: 're.kufar.by',
      category: 'kvartiru',
      query: null,
      region: 'minsk',
      sellerType: 'bez-posrednikov',
      sort: null,
      operation: 'kupit',
      pathFilters: ['1k'],
      extraParams: { cur: ['USD'] },
    })
  })

  it('drops pagination state while preserving repeated unknown parameter values', () => {
    const result = parseKufarListingUrl(
      'https://re.kufar.by/l/minsk/kupit/kvartiru?cursor=opaque-token&size=30&cur=USD&feature=a&feature=b&empty=',
    )

    expect(result.extraParams).toEqual({
      cur: ['USD'],
      feature: ['a', 'b'],
      empty: [''],
    })
    expect(result.extraParams).not.toHaveProperty('cursor')
    expect(result.extraParams).not.toHaveProperty('size')
  })

  it('accepts an Auto listing syntactically and leaves scope decisions to routing', () => {
    const result = parseKufarListingUrl('https://auto.kufar.by/l/avtomobili?source=copy')

    expect(result.host).toBe('auto.kufar.by')
    expect(result.category).toBe('avtomobili')
    expect(result.extraParams).toEqual({ source: ['copy'] })
  })

  it('decodes semantic path segments', () => {
    const result = parseKufarListingUrl(
      'https://www.kufar.by/l/r~%D0%BC%D0%B8%D0%BD%D1%81%D0%BA/%D1%82%D0%B5%D1%81%D1%82/q~play%20station',
    )

    expect(result.region).toBe('минск')
    expect(result.category).toBe('тест')
    expect(result.query).toBe('play station')
  })

  it('rejects malformed input with a stable error code', () => {
    expectParseError('not a URL', 'invalid-url')
  })

  it('rejects unsupported protocols with a stable error code', () => {
    expectParseError('ftp://www.kufar.by/l/elektronika', 'unsupported-protocol')
  })

  it('rejects foreign and lookalike hosts with a stable error code', () => {
    expectParseError('https://example.com/l/elektronika', 'foreign-host')
    expectParseError('https://evilkufar.by/l/elektronika', 'foreign-host')
  })

  it('rejects non-listing Kufar routes with a stable error code', () => {
    expectParseError('https://www.kufar.by/item/1082715190', 'not-listing-url')
  })
})
