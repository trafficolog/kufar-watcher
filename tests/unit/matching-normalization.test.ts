import { describe, expect, it } from 'vitest'

import {
  normalizeMatchingText,
  tokenizeMatchingText,
} from '../../electron/worker/matching-normalization'

describe('matching text normalization', () => {
  it.each([
    ['  Ёлка\tНОВАЯ\n  ', 'елка новая'],
    ['PlayStation-4   PRO', 'playstation-4 pro'],
    ['СМЕШАННЫЙ iPhone ТЕКСТ', 'смешанный iphone текст'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeMatchingText(input)).toBe(expected)
  })
})

describe('matching text tokenization', () => {
  it('strips punctuation at token edges while preserving an internal hyphen', () => {
    expect(tokenizeMatchingText('«PlayStation-4», (Pro)!')).toEqual([
      'playstation-4',
      'playstation',
      '4',
      'pro',
    ])
  })

  it('keeps mixed scripts and digits in product-model tokens', () => {
    expect(tokenizeMatchingText('iPhone-15 Чехол')).toEqual(['iphone-15', 'iphone', '15', 'чехол'])
  })

  it('makes a hyphenated compound comparable with its spaced form', () => {
    const compound = tokenizeMatchingText('PlayStation-4 Pro')
    const spaced = tokenizeMatchingText('playstation 4 pro')

    expect(spaced).toEqual(['playstation', '4', 'pro'])
    expect(compound).toEqual(expect.arrayContaining(spaced))
  })

  it('drops punctuation-only tokens without dropping neighboring words', () => {
    expect(tokenizeMatchingText('... слово !!! «»')).toEqual(['слово'])
  })
})
