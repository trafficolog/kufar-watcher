import { describe, expect, it } from 'vitest'
import {
  buildKufarApiUrl,
  buildKufarListingUrl,
  KufarUrlBuildError,
  parseKufarListingUrl,
} from '../../shared/kufar-url'

const ROUND_TRIP_URLS = [
  'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?sort=lst.d',
  'https://www.kufar.by/l/elektronika?cur=BYN',
  'https://re.kufar.by/l/minsk/kupit/kvartiru/1k/bez-posrednikov?cur=USD',
  'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?cmp=1&sort=lst.d',
  'https://re.kufar.by/l/minsk/kupit/kvartiru?cursor=opaque-token&size=30&cur=USD&feature=a&feature=b&empty=',
  'https://auto.kufar.by/l/avtomobili?source=copy',
  'https://www.kufar.by/l/r~%D0%BC%D0%B8%D0%BD%D1%81%D0%BA/%D1%82%D0%B5%D1%81%D1%82/q~play%20station',
]

describe('buildKufarListingUrl', () => {
  it.each(ROUND_TRIP_URLS)('round-trips listing semantics for %s', (input) => {
    const canonical = parseKufarListingUrl(input)
    const rebuilt = buildKufarListingUrl(canonical)

    expect(parseKufarListingUrl(rebuilt)).toEqual(canonical)
  })

  it('uses a deterministic path and query-parameter order', () => {
    const canonical = parseKufarListingUrl(
      'https://www.kufar.by/l/igry-i-pristavki/q~ps5/r~minsk?z=last&a=one&a=two&sort=lst.d',
    )

    expect(buildKufarListingUrl(canonical)).toBe(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?sort=lst.d&a=one&a=two&z=last',
    )
  })

  it('uses the private path marker and cmp=1 for company as the canonical site encodings', () => {
    const baseline = parseKufarListingUrl(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?sort=lst.d',
    )

    expect(buildKufarListingUrl({ ...baseline, sellerType: 'private' })).toBe(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/bez-posrednikov/q~ps5?sort=lst.d',
    )
    expect(buildKufarListingUrl({ ...baseline, sellerType: 'company' })).toBe(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?sort=lst.d&cmp=1',
    )
  })
})

describe('buildKufarApiUrl', () => {
  it('builds the confirmed electronics API request deterministically', () => {
    const canonical = parseKufarListingUrl(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?sort=price',
    )

    expect(buildKufarApiUrl(canonical)).toBe(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040&lang=ru&query=ps5&rgn=7&sort=lst.d',
    )
  })

  it('adds the confirmed native seller filter to electronics API requests', () => {
    const privateQuery = parseKufarListingUrl(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/bez-posrednikov/q~ps5',
    )
    const companyQuery = parseKufarListingUrl(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?cmp=1',
    )

    expect(buildKufarApiUrl(privateQuery)).toBe(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040&cmp=0&lang=ru&query=ps5&rgn=7&sort=lst.d',
    )
    expect(buildKufarApiUrl(companyQuery)).toBe(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040&cmp=1&lang=ru&query=ps5&rgn=7&sort=lst.d',
    )
  })

  it('builds the confirmed real-estate API request and preserves opaque extras', () => {
    const canonical = parseKufarListingUrl(
      'https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD&feature=b&feature=a',
    )

    expect(buildKufarApiUrl(canonical)).toBe(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=1010&cur=USD&feature=b&feature=a&gtsy=country-belarus%7Eprovince-minsk%7Elocality-minsk&lang=ru&sort=lst.d&typ=sell',
    )
  })

  it('adds the confirmed native seller filter to real-estate API requests', () => {
    const privateQuery = parseKufarListingUrl(
      'https://re.kufar.by/l/minsk/kupit/kvartiru/bez-posrednikov',
    )
    const companyQuery = parseKufarListingUrl(
      'https://re.kufar.by/l/minsk/kupit/kvartiru?cmp=true',
    )

    expect(buildKufarApiUrl(privateQuery)).toBe(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=1010&cmp=0&gtsy=country-belarus%7Eprovince-minsk%7Elocality-minsk&lang=ru&sort=lst.d&typ=sell',
    )
    expect(buildKufarApiUrl(companyQuery)).toBe(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=1010&cmp=1&gtsy=country-belarus%7Eprovince-minsk%7Elocality-minsk&lang=ru&sort=lst.d&typ=sell',
    )
  })

  it.each([
    'https://auto.kufar.by/l/avtomobili',
    'https://www.kufar.by/l/elektronika',
    'https://re.kufar.by/l/minsk/snyat/kvartiru',
    'https://re.kufar.by/l/minsk/kupit/kvartiru/1k',
  ])('rejects API semantics without a confirmed mapping for %s', (input) => {
    const canonical = parseKufarListingUrl(input)

    expect(() => buildKufarApiUrl(canonical)).toThrowError(KufarUrlBuildError)

    try {
      buildKufarApiUrl(canonical)
    } catch (error: unknown) {
      expect((error as KufarUrlBuildError).code).toBe('unsupported-api-mapping')
    }
  })
})
