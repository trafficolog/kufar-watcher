import { describe, expect, it } from 'vitest'

import { compileMatchingTerm } from '../../electron/worker/matching-term'

describe('matching term compilation', () => {
  it('matches a literal term only against the exact normalized token', () => {
    const matches = compileMatchingTerm('КОЛОНКА')

    expect(matches('колонка')).toBe(true)
    expect(matches('колонки')).toBe(false)
    expect(matches('моя-колонка')).toBe(false)
  })

  it('normalizes ё in a term through the shared matching normalization path', () => {
    const matches = compileMatchingTerm('Ёлка')

    expect(matches('елка')).toBe(true)
    expect(matches('ёлка')).toBe(false)
  })

  it('supports a trailing star across a whole token', () => {
    const matches = compileMatchingTerm('playstation*')

    expect(matches('playstation')).toBe(true)
    expect(matches('playstation5')).toBe(true)
    expect(matches('playstationa')).toBe(true)
    expect(matches('xplaystation5')).toBe(false)
  })

  it('supports a leading star across a whole token', () => {
    const matches = compileMatchingTerm('*pro')

    expect(matches('macpro')).toBe(true)
    expect(matches('pro')).toBe(true)
    expect(matches('macprobook')).toBe(false)
  })

  it('supports stars inside a term and multiple stars', () => {
    const matches = compileMatchingTerm('play*station*pro')

    expect(matches('play5station4pro')).toBe(true)
    expect(matches('playstationpro')).toBe(true)
    expect(matches('xplay5station4pro')).toBe(false)
  })

  it.each([
    ['iphone(новый)*', 'iphone(новый)15', 'iphonenовый15'],
    ['v1.2*', 'v1.2pro', 'v1x2pro'],
    ['c++*', 'c++guide', 'cccguide'],
  ])('treats regex syntax in %s as literal text', (term, matchingToken, nonMatchingToken) => {
    const matches = compileMatchingTerm(term)

    expect(matches(matchingToken)).toBe(true)
    expect(matches(nonMatchingToken)).toBe(false)
  })
})
