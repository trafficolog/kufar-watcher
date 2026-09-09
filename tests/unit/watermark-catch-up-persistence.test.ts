import { describe, expect, it, vi } from 'vitest'

import type { WatermarkCatchUpCheckpoint } from '../../shared/watermark'

interface CatchUpPersistenceModule {
  parsePersistedCatchUpCheckpoint(value: unknown): WatermarkCatchUpCheckpoint | null
}

async function loadModule(): Promise<CatchUpPersistenceModule> {
  const loaded = await vi.importActual('../../electron/worker/watermark-catch-up-persistence')
  return loaded as CatchUpPersistenceModule
}

const VALID_ROW = {
  resumeCursor: 'page-3',
  pendingBoundaryTime: new Date('2026-09-08T10:05:00.000Z'),
  pendingBoundaryIds: ['top-a', 'top-b'],
  pagesRead: 2,
  lastPage: 2,
  lastIndex: 4,
  lastListId: 'last-seen',
  lastListTime: new Date('2026-09-08T10:02:00.000Z'),
}

describe('parsePersistedCatchUpCheckpoint', () => {
  it('returns null when no checkpoint is persisted', async () => {
    const module = await loadModule()

    expect(module.parsePersistedCatchUpCheckpoint(null)).toBeNull()
  })

  it('maps a valid persisted row back to the domain checkpoint', async () => {
    const module = await loadModule()

    expect(module.parsePersistedCatchUpCheckpoint(VALID_ROW)).toEqual({
      resumeCursor: 'page-3',
      pendingWatermark: {
        boundaryTime: '2026-09-08T10:05:00.000Z',
        boundaryIds: ['top-a', 'top-b'],
      },
      pagesRead: 2,
      lastObservation: {
        page: 2,
        index: 4,
        listId: 'last-seen',
        listTime: '2026-09-08T10:02:00.000Z',
      },
    })
  })

  it('accepts an absent ordering observation only when all four columns are null', async () => {
    const module = await loadModule()

    expect(
      module.parsePersistedCatchUpCheckpoint({
        ...VALID_ROW,
        lastPage: null,
        lastIndex: null,
        lastListId: null,
        lastListTime: null,
      }),
    ).toMatchObject({ lastObservation: null })
  })

  it.each([
    ['non-string resume cursor', { ...VALID_ROW, resumeCursor: 42 }],
    ['malformed pending boundary ids', { ...VALID_ROW, pendingBoundaryIds: ['top-a', 42] }],
    ['non-positive page count', { ...VALID_ROW, pagesRead: 0 }],
    ['partial ordering observation', { ...VALID_ROW, lastListTime: null }],
    ['negative observation index', { ...VALID_ROW, lastIndex: -1 }],
    ['invalid pending boundary time', { ...VALID_ROW, pendingBoundaryTime: new Date('invalid') }],
    ['invalid observation time', { ...VALID_ROW, lastListTime: new Date('invalid') }],
  ])('rejects %s', async (_name, value) => {
    const module = await loadModule()

    expect(() => module.parsePersistedCatchUpCheckpoint(value)).toThrow(/checkpoint/i)
  })
})
