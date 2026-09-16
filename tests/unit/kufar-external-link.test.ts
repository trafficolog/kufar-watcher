import { describe, expect, it } from 'vitest'
import { isAllowedKufarListingUrl } from '../../shared/kufar-external-link'

describe('external Kufar result navigation', () => {
  it.each([
    'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5',
    'https://re.kufar.by/l/minsk/kupit/kvartiru',
    'https://kufar.by/l/r~minsk/igry-i-pristavki',
  ])('permits a valid result URL %s', (url) => {
    expect(isAllowedKufarListingUrl(url)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'http://www.kufar.by/l/minsk',
    'https://kufar.by.evil.example/l/minsk',
    'https://evil.example/l/minsk',
    'https://user@kufar.by/l/minsk',
    'https://user:password@kufar.by/l/minsk',
    'https://www.kufar.by:444/l/minsk',
    'https://www.kufar.by.evil.example/l/minsk',
    'https://www.kufar.by/other',
    'https://www.kufar.by/l',
    '/l/minsk',
    'not a URL',
  ])('rejects untrusted external URL %s', (url) => {
    expect(isAllowedKufarListingUrl(url)).toBe(false)
  })
})
