import { describe, expect, it } from 'vitest'

import {
  canonicalQueryEquals,
  shouldResetMonitorCursor,
  type MonitorSourceIdentity,
} from '../../electron/worker/monitor-config-persistence'
import type { CanonicalQuery } from '../../shared/canonical-query'

function query(overrides: Partial<CanonicalQuery> = {}): CanonicalQuery {
  return {
    host: 'www.kufar.by',
    category: 'electronics',
    query: 'phone',
    region: 'minsk',
    sellerType: null,
    sort: 'lst.d',
    operation: null,
    pathFilters: ['phones', 'smartphones'],
    extraParams: {
      price: ['100', '500'],
      condition: ['used', 'new'],
    },
    ...overrides,
  }
}

function identity(overrides: Partial<MonitorSourceIdentity> = {}): MonitorSourceIdentity {
  return {
    sourceUrl: 'https://www.kufar.by/l/electronics?query=phone',
    query: query(),
    state: 'active',
    ...overrides,
  }
}

describe('canonicalQueryEquals', () => {
  it('ignores extraParams object key insertion order', () => {
    const left = query({
      extraParams: {
        price: ['100', '500'],
        condition: ['used', 'new'],
      },
    })
    const right = query({
      extraParams: {
        condition: ['used', 'new'],
        price: ['100', '500'],
      },
    })

    expect(canonicalQueryEquals(left, right)).toBe(true)
  })

  it('treats pathFilters order as significant', () => {
    expect(canonicalQueryEquals(query(), query({ pathFilters: ['smartphones', 'phones'] }))).toBe(
      false,
    )
  })

  it('treats extraParams value-array order as significant', () => {
    expect(
      canonicalQueryEquals(
        query(),
        query({
          extraParams: {
            price: ['500', '100'],
            condition: ['used', 'new'],
          },
        }),
      ),
    ).toBe(false)
  })

  it('compares all scalar canonical-query fields', () => {
    expect(canonicalQueryEquals(query(), query({ region: 'vitebsk' }))).toBe(false)
    expect(canonicalQueryEquals(query(), query({ sellerType: 'company' }))).toBe(false)
    expect(canonicalQueryEquals(query(), query({ sort: 'price' }))).toBe(false)
  })
})

describe('shouldResetMonitorCursor', () => {
  it('resets when sourceUrl changes', () => {
    expect(
      shouldResetMonitorCursor(identity(), identity({ sourceUrl: 'https://www.kufar.by/l/cars' })),
    ).toBe(true)
  })

  it('resets when canonical query changes', () => {
    expect(
      shouldResetMonitorCursor(identity(), identity({ query: query({ region: 'gomel' }) })),
    ).toBe(true)
  })

  it('resets when an archived monitor becomes active', () => {
    expect(
      shouldResetMonitorCursor(identity({ state: 'archived' }), identity({ state: 'active' })),
    ).toBe(true)
  })

  it('resets when an archived monitor becomes paused', () => {
    expect(
      shouldResetMonitorCursor(identity({ state: 'archived' }), identity({ state: 'paused' })),
    ).toBe(true)
  })

  it('preserves cursor when source identity is unchanged', () => {
    expect(shouldResetMonitorCursor(identity(), identity())).toBe(false)
  })

  it('does not reset for active to paused or paused to active alone', () => {
    expect(
      shouldResetMonitorCursor(identity({ state: 'active' }), identity({ state: 'paused' })),
    ).toBe(false)
    expect(
      shouldResetMonitorCursor(identity({ state: 'paused' }), identity({ state: 'active' })),
    ).toBe(false)
  })
})
