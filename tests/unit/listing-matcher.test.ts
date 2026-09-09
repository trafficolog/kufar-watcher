import { describe, expect, it } from 'vitest'

import { matchListing } from '../../electron/worker/listing-matcher'

describe('listing matcher', () => {
  it('passes when both include and exclude are empty', () => {
    expect(
      matchListing({
        include: [],
        exclude: [],
        document: { title: 'Любое объявление' },
        fields: ['title'],
      }),
    ).toEqual({ matched: true, hits: [] })
  })

  it('treats an empty include as open while still evaluating exclude', () => {
    expect(
      matchListing({
        include: [],
        exclude: ['ремонт'],
        document: { title: 'Телефон без ремонта' },
        fields: ['title'],
      }),
    ).toEqual({
      matched: false,
      hits: [{ term: 'ремонт', field: 'title', kind: 'exclude' }],
    })
  })

  it('requires at least one include hit when include is non-empty', () => {
    expect(
      matchListing({
        include: ['iphone', 'pixel'],
        exclude: [],
        document: { title: 'Google Pixel 9 Pro' },
        fields: ['title'],
      }),
    ).toEqual({
      matched: true,
      hits: [{ term: 'pixel', field: 'title', kind: 'include' }],
    })

    expect(
      matchListing({
        include: ['iphone', 'pixel'],
        exclude: [],
        document: { title: 'Samsung Galaxy S26' },
        fields: ['title'],
      }),
    ).toEqual({ matched: false, hits: [] })
  })

  it('gives exclude priority over a successful include', () => {
    expect(
      matchListing({
        include: ['pixel*'],
        exclude: ['разбит'],
        document: { title: 'Pixel9 Pro разбит экран' },
        fields: ['title'],
      }),
    ).toEqual({
      matched: false,
      hits: [
        { term: 'pixel*', field: 'title', kind: 'include' },
        { term: 'разбит', field: 'title', kind: 'exclude' },
      ],
    })
  })

  it('uses the shared normalization and matching-term compiler for title tokens', () => {
    expect(
      matchListing({
        include: ['ЁЛКА', 'playstation*'],
        exclude: [],
        document: { title: 'Продам ёлку и PlayStation-5' },
        fields: ['title'],
      }),
    ).toEqual({
      matched: true,
      hits: [{ term: 'playstation*', field: 'title', kind: 'include' }],
    })
  })

  it('does not search description when description is not an active field', () => {
    expect(
      matchListing({
        include: ['редкий'],
        exclude: [],
        document: {
          title: 'Обычное объявление',
          description: 'Здесь есть редкий термин',
        },
        fields: ['title'],
      }),
    ).toEqual({ matched: false, hits: [] })
  })

  it('reports each term field and kind only once even if several tokens match', () => {
    expect(
      matchListing({
        include: ['pixel*'],
        exclude: [],
        document: { title: 'Pixel Pixel9 PixelPro' },
        fields: ['title'],
      }),
    ).toEqual({
      matched: true,
      hits: [{ term: 'pixel*', field: 'title', kind: 'include' }],
    })
  })
})
