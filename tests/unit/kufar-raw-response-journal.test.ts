import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileKufarRawResponseJournal } from '../../electron/worker/kufar-raw-response-journal'

describe('FileKufarRawResponseJournal', () => {
  let rootDir: string
  let currentTime: Date
  let nextId: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kufar-raw-journal-'))
    currentTime = new Date('2026-09-08T10:15:30.000Z')
    nextId = 'snapshot-1'
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  function createJournal(retention = 5): FileKufarRawResponseJournal {
    return new FileKufarRawResponseJournal({
      rootDir,
      retention,
      now: () => currentTime,
      createId: () => nextId,
    })
  }

  it('records exact body bytes in a versioned envelope', async () => {
    const body = new TextEncoder().encode('{"items":[1]}\n')
    const journal = createJournal()

    const snapshot = await journal.record({
      requestUrl:
        'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040',
      status: 200,
      body,
    })

    expect(snapshot).toEqual({
      version: 1,
      id: 'snapshot-1',
      endpoint: 'api.kufar.by/search-api/v2/search/rendered-paginated',
      requestUrl:
        'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040',
      status: 200,
      capturedAt: '2026-09-08T10:15:30.000Z',
      bodyBase64: Buffer.from(body).toString('base64'),
    })

    await expect(journal.list(snapshot.endpoint)).resolves.toEqual([snapshot])
  })

  it('maps different query strings to the same endpoint bucket', async () => {
    const journal = createJournal()

    await journal.record({
      requestUrl:
        'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040',
      status: 200,
      body: Uint8Array.of(1),
    })

    nextId = 'snapshot-2'
    currentTime = new Date('2026-09-08T10:15:31.000Z')

    await journal.record({
      requestUrl:
        'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=1010',
      status: 200,
      body: Uint8Array.of(2),
    })

    const snapshots = await journal.list(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated?anything=else',
    )

    expect(snapshots.map((item) => item.id)).toEqual(['snapshot-1', 'snapshot-2'])
    expect(new Set(snapshots.map((item) => item.endpoint))).toEqual(
      new Set(['api.kufar.by/search-api/v2/search/rendered-paginated']),
    )
  })
})
