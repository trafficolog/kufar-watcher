import { describe, expect, it } from 'vitest'

import { matchListing } from '../../electron/worker/listing-matcher'
import { tokenizeMatchingTextWithSpans } from '../../electron/worker/matching-normalization'
import { extractMatchingSnippet } from '../../electron/worker/matching-snippet'

describe('matching token spans', () => {
  it('maps normalized and hyphen-expanded tokens back to the original text', () => {
    expect(tokenizeMatchingTextWithSpans('  Продам,   PlayStation-5!  сегодня. ')).toEqual([
      { value: 'продам', start: 2, end: 8 },
      { value: 'playstation-5', start: 12, end: 25 },
      { value: 'playstation', start: 12, end: 23 },
      { value: '5', start: 24, end: 25 },
      { value: 'сегодня', start: 28, end: 35 },
    ])
  })
})

describe('listing matcher hit positions', () => {
  it('returns the source span of the first matching token for a term and field', () => {
    expect(
      matchListing({
        include: ['pixel*'],
        exclude: [],
        document: { title: 'Новый Pixel-9 и PixelPro' },
        fields: ['title'],
      }),
    ).toEqual({
      matched: true,
      hits: [{ term: 'pixel*', field: 'title', kind: 'include', start: 6, end: 13 }],
    })
  })
})

describe('matching snippet extraction', () => {
  it('does not duplicate a short title that already fits the limit', () => {
    expect(
      extractMatchingSnippet({
        text: 'Google Pixel 9 Pro',
        field: 'title',
        hits: [{ term: 'pixel', field: 'title', kind: 'include', start: 7, end: 12 }],
        maxLength: 40,
      }),
    ).toBeNull()
  })

  it('truncates only the right side when the first match is near the beginning', () => {
    const snippet = extractMatchingSnippet({
      text: 'Pixel 9 Pro в отличном состоянии без царапин и сколов',
      field: 'title',
      hits: [{ term: 'pixel*', field: 'title', kind: 'include', start: 0, end: 5 }],
      maxLength: 28,
    })

    expect(snippet).not.toBeNull()
    expect(snippet?.startsWith('Pixel')).toBe(true)
    expect(snippet?.startsWith('…')).toBe(false)
    expect(snippet?.endsWith('…')).toBe(true)
    expect(snippet?.length).toBeLessThanOrEqual(28)
  })

  it('marks truncation on both sides for a match in the middle', () => {
    const text = 'Продам почти новый смартфон Google Pixel 9 Pro в полном комплекте сегодня'
    const start = text.indexOf('Pixel')
    const snippet = extractMatchingSnippet({
      text,
      field: 'title',
      hits: [{ term: 'pixel', field: 'title', kind: 'include', start, end: start + 5 }],
      maxLength: 32,
    })

    expect(snippet?.startsWith('…')).toBe(true)
    expect(snippet?.endsWith('…')).toBe(true)
    expect(snippet).toContain('Pixel')
    expect(snippet?.length).toBeLessThanOrEqual(32)
  })

  it('truncates only the left side when the first match is near the end', () => {
    const text = 'Срочно продам смартфон в полном комплекте Google Pixel'
    const start = text.indexOf('Pixel')
    const snippet = extractMatchingSnippet({
      text,
      field: 'title',
      hits: [{ term: 'pixel', field: 'title', kind: 'include', start, end: start + 5 }],
      maxLength: 30,
    })

    expect(snippet?.startsWith('…')).toBe(true)
    expect(snippet?.endsWith('Pixel')).toBe(true)
    expect(snippet?.endsWith('…')).toBe(false)
    expect(snippet?.length).toBeLessThanOrEqual(30)
  })

  it('uses the earliest include hit in the field rather than rule order', () => {
    const text =
      'Pixel в начале длинного заголовка с дополнительными словами, а модель iPhone упомянута заметно позже'
    const pixelStart = text.indexOf('Pixel')
    const iphoneStart = text.indexOf('iPhone')
    const snippet = extractMatchingSnippet({
      text,
      field: 'title',
      hits: [
        {
          term: 'iphone',
          field: 'title',
          kind: 'include',
          start: iphoneStart,
          end: iphoneStart + 6,
        },
        { term: 'pixel', field: 'title', kind: 'include', start: pixelStart, end: pixelStart + 5 },
      ],
      maxLength: 26,
    })

    expect(snippet).toContain('Pixel')
    expect(snippet).not.toContain('iPhone')
  })

  it('cuts only at whitespace boundaries and preserves original casing and punctuation', () => {
    const text = 'Очень хороший Google Pixel 9 Pro, полный комплект и гарантия магазина'
    const start = text.indexOf('Pixel')
    const snippet = extractMatchingSnippet({
      text,
      field: 'title',
      hits: [{ term: 'pixel*', field: 'title', kind: 'include', start, end: start + 5 }],
      maxLength: 34,
    })

    expect(snippet).toContain('Pixel 9 Pro,')
    expect(snippet).not.toMatch(/…\S/u)
    expect(snippet).not.toMatch(/\S…$/u)
    expect(snippet?.length).toBeLessThanOrEqual(34)
  })
})
