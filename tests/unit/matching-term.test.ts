import { describe, expect, it } from 'vitest'

import {
  matchingTermCompiler,
  type MatchingTermCompiler,
} from '../../electron/worker/matching-term-compiler'

function matchesWith(compiler: MatchingTermCompiler, term: string, token: string): boolean {
  return compiler.compile(term)(token)
}

describe('matching term compilation', () => {
  it('matches a literal term only against the exact normalized token', () => {
    const matches = matchingTermCompiler.compile('КОЛОНКА')

    expect(matches('колонка')).toBe(true)
    expect(matches('колонки')).toBe(false)
    expect(matches('моя-колонка')).toBe(false)
  })

  it('normalizes ё in a term through the shared matching normalization path', () => {
    const matches = matchingTermCompiler.compile('Ёлка')

    expect(matches('елка')).toBe(true)
    expect(matches('ёлка')).toBe(false)
  })

  it.each([
    ['(PS5)', 'ps5'],
    ['«PlayStation*»', 'playstation5'],
  ])('normalizes term edge punctuation symmetrically for %j', (term, token) => {
    const matches = matchingTermCompiler.compile(term)

    expect(matches(token)).toBe(true)
  })

  it('rejects a multiword term instead of compiling an always-false single-token predicate', () => {
    expect(() => matchingTermCompiler.compile('playstation 5')).toThrowError(/exactly one token/i)
  })

  it.each(['   ', '... !!!'])('rejects a term that is empty after normalization: %j', (term) => {
    expect(() => matchingTermCompiler.compile(term)).toThrowError(/exactly one token/i)
  })

  it('supports a trailing star across a whole token', () => {
    const matches = matchingTermCompiler.compile('playstation*')

    expect(matches('playstation')).toBe(true)
    expect(matches('playstation5')).toBe(true)
    expect(matches('playstationa')).toBe(true)
    expect(matches('xplaystation5')).toBe(false)
  })

  it('supports a leading star across a whole token', () => {
    const matches = matchingTermCompiler.compile('*pro')

    expect(matches('macpro')).toBe(true)
    expect(matches('pro')).toBe(true)
    expect(matches('macprobook')).toBe(false)
  })

  it('supports stars inside a term and multiple stars', () => {
    const matches = matchingTermCompiler.compile('play*station*pro')

    expect(matches('play5station4pro')).toBe(true)
    expect(matches('playstationpro')).toBe(true)
    expect(matches('xplay5station4pro')).toBe(false)
  })

  it.each([
    ['iphone(новый)*', 'iphone(новый)15', 'iphonenовый15'],
    ['v1.2*', 'v1.2pro', 'v1x2pro'],
    ['c++*', 'c++guide', 'cccguide'],
  ])('treats regex syntax in %s as literal text', (term, matchingToken, nonMatchingToken) => {
    const matches = matchingTermCompiler.compile(term)

    expect(matches(matchingToken)).toBe(true)
    expect(matches(nonMatchingToken)).toBe(false)
  })

  it('allows consumer code to substitute another compiler implementation', () => {
    const alternativeCompiler: MatchingTermCompiler = {
      compile(term) {
        return (normalizedToken) => normalizedToken === `[${term}]`
      },
    }

    expect(matchesWith(alternativeCompiler, 'custom', '[custom]')).toBe(true)
    expect(matchesWith(alternativeCompiler, 'custom', 'custom')).toBe(false)
    expect(matchesWith(matchingTermCompiler, 'КОЛОНКА', 'колонка')).toBe(true)
  })
})
