import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import { normalizeElectronicsSearchPage } from '../../electron/worker/kufar-electronics-normalizer'
import { normalizeRealEstateSearchPage } from '../../electron/worker/kufar-realestate-normalizer'

interface EmbeddedState {
  scriptId: '__NEXT_DATA__'
  value: unknown
}

interface EmbeddedStateError extends Error {
  code: 'missing-next-data' | 'invalid-next-data-json' | 'invalid-search-state'
  path: string
}

interface EmbeddedSearchStateModule {
  KufarEmbeddedStateError: new (...args: never[]) => EmbeddedStateError
  extractKufarEmbeddedState(html: Uint8Array): EmbeddedState
  kufarSearchPayloadFromEmbeddedState(state: unknown): Uint8Array
}

type MutableRecord = Record<string, unknown>

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url)))
}

async function loadModule(): Promise<EmbeddedSearchStateModule> {
  let loaded: unknown
  try {
    loaded = await vi.importActual('../../electron/worker/kufar-embedded-search-state')
  } catch {
    loaded = undefined
  }

  expect(loaded, 'embedded search-state module must exist').toBeTruthy()
  return loaded as EmbeddedSearchStateModule
}

function asRecord(value: unknown): MutableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected test fixture object')
  }
  return value as MutableRecord
}

function listingFrom(state: unknown): MutableRecord {
  const props = asRecord(asRecord(state).props)
  const initialState = asRecord(props.initialState)
  return asRecord(initialState.listing)
}

async function expectEmbeddedError(
  operation: (module: EmbeddedSearchStateModule) => unknown,
  code: EmbeddedStateError['code'],
  path: string,
): Promise<void> {
  const module = await loadModule()

  try {
    operation(module)
    throw new Error('Expected embedded-state operation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(module.KufarEmbeddedStateError)
    expect(error).toMatchObject({ code, path })
  }
}

describe('Kufar embedded search state', () => {
  it('extracts the confirmed __NEXT_DATA__ carrier and projects electronics page 1', async () => {
    const module = await loadModule()
    const embedded = module.extractKufarEmbeddedState(
      await fixtureBytes('2026-09-08-electronics-search-page-1-embedded.html'),
    )

    expect(embedded.scriptId).toBe('__NEXT_DATA__')
    const page = normalizeElectronicsSearchPage(
      module.kufarSearchPayloadFromEmbeddedState(embedded.value),
    )
    expect(page.listings[0]).toMatchObject({
      listId: '1084343116',
      title: 'PlayStation 5 Slim + 2 геймпада',
      priceAmount: '2100.00',
      currency: 'BYN',
    })
    expect(page.nextCursor).toBe(
      'eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTQzNjYifQ==',
    )
  })

  it('projects electronics page 2 without decoding its fresh cursor', async () => {
    const module = await loadModule()
    const embedded = module.extractKufarEmbeddedState(
      await fixtureBytes('2026-09-08-electronics-search-page-2-embedded.html'),
    )
    const listing = listingFrom(embedded.value)
    const pagination = listing.pagination

    expect(Array.isArray(pagination)).toBe(true)
    expect((pagination as MutableRecord[]).find(({ label }) => label === 'self')).toMatchObject({
      num: 2,
      token: null,
    })

    const page = normalizeElectronicsSearchPage(
      module.kufarSearchPayloadFromEmbeddedState(embedded.value),
    )
    expect(page.listings[0]?.listId).toBe('1084291401')
    expect(page.nextCursor).toBe(
      'eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MywicGl0IjoiMjk4MTQzNzkifQ==',
    )
  })

  it('projects both real-estate fixtures through the existing normalizer', async () => {
    const module = await loadModule()
    const first = module.extractKufarEmbeddedState(
      await fixtureBytes('2026-09-08-realestate-search-page-1-embedded.html'),
    )
    const second = module.extractKufarEmbeddedState(
      await fixtureBytes('2026-09-08-realestate-search-page-2-embedded.html'),
    )

    const page1 = normalizeRealEstateSearchPage(
      module.kufarSearchPayloadFromEmbeddedState(first.value),
    )
    const page2 = normalizeRealEstateSearchPage(
      module.kufarSearchPayloadFromEmbeddedState(second.value),
    )

    expect(page1.listings[0]).toMatchObject({
      listId: '1075499901',
      currency: 'BYN',
      isCompany: true,
    })
    expect(page2.listings[0]).toMatchObject({
      listId: '1083591450',
      priceAmount: '117080.00',
      currency: 'EUR',
    })
    expect(page1.nextCursor).not.toBeNull()
    expect(page2.nextCursor).not.toBeNull()
    expect(page2.nextCursor).not.toBe(page1.nextCursor)
  })

  it('rejects HTML without the confirmed __NEXT_DATA__ carrier', async () => {
    await expectEmbeddedError(
      ({ extractKufarEmbeddedState }) =>
        extractKufarEmbeddedState(new TextEncoder().encode('<html><body></body></html>')),
      'missing-next-data',
      '$',
    )
  })

  it('rejects malformed JSON inside __NEXT_DATA__', async () => {
    await expectEmbeddedError(
      ({ extractKufarEmbeddedState }) =>
        extractKufarEmbeddedState(
          new TextEncoder().encode(
            '<script id="__NEXT_DATA__" type="application/json">{bad}</script>',
          ),
        ),
      'invalid-next-data-json',
      '$',
    )
  })

  it('requires the confirmed props.initialState.listing path', async () => {
    await expectEmbeddedError(
      ({ kufarSearchPayloadFromEmbeddedState }) =>
        kufarSearchPayloadFromEmbeddedState({ props: { initialState: {} } }),
      'invalid-search-state',
      'props.initialState.listing',
    )
  })

  it('requires embedded listing.ads to be an array', async () => {
    await expectEmbeddedError(
      ({ kufarSearchPayloadFromEmbeddedState }) =>
        kufarSearchPayloadFromEmbeddedState({
          props: { initialState: { listing: { ads: {}, pagination: [] } } },
        }),
      'invalid-search-state',
      'props.initialState.listing.ads',
    )
  })

  it('requires embedded listing.pagination to be an array', async () => {
    await expectEmbeddedError(
      ({ kufarSearchPayloadFromEmbeddedState }) =>
        kufarSearchPayloadFromEmbeddedState({
          props: { initialState: { listing: { ads: [], pagination: {} } } },
        }),
      'invalid-search-state',
      'props.initialState.listing.pagination',
    )
  })
})
