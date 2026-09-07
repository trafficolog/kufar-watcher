import { describe, expect, it } from 'vitest'
import { parseKufarListingUrl } from '../../shared/kufar-url'
import { KufarRoutingError, routeKufarQuery } from '../../shared/kufar-routing'

describe('routeKufarQuery', () => {
  it.each([
    'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5',
    'https://kufar.by/l/igry-i-pristavki',
  ])('routes the confirmed electronics category for %s', (input) => {
    expect(routeKufarQuery(parseKufarListingUrl(input))).toBe('electronics')
  })

  it('routes the confirmed real-estate category', () => {
    const query = parseKufarListingUrl('https://re.kufar.by/l/minsk/kupit/kvartiru')

    expect(routeKufarQuery(query)).toBe('real-estate')
  })

  it('rejects Auto as an explicit out-of-scope category', () => {
    const query = parseKufarListingUrl('https://auto.kufar.by/l/avtomobili')

    expect(() => routeKufarQuery(query)).toThrowError(KufarRoutingError)

    try {
      routeKufarQuery(query)
    } catch (error: unknown) {
      const routingError = error as KufarRoutingError
      expect(routingError.code).toBe('out-of-scope-category')
      expect(routingError.message).toMatch(/auto/i)
    }
  })

  it.each([
    'https://www.kufar.by/l/elektronika',
    'https://travel.kufar.by/l/apartments',
    'https://re.kufar.by/l/minsk/kupit/doma',
  ])('rejects an unknown or unsupported category for %s', (input) => {
    const query = parseKufarListingUrl(input)

    expect(() => routeKufarQuery(query)).toThrowError(KufarRoutingError)

    try {
      routeKufarQuery(query)
    } catch (error: unknown) {
      expect((error as KufarRoutingError).code).toBe('unknown-category')
    }
  })
})
