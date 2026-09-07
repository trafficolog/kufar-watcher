import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileKufarRawResponseJournal } from '../../electron/worker/kufar-raw-response-journal'

const SEARCH_URL = 'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040'
const DETAILS_URL = 'https://api.kufar.by/search-api/v2/listings/123'

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

  function advanceSnapshot(id: string, seconds: number): void {
    nextId = id
    currentTime = new Date(Date.UTC(2026, 8, 8, 10, 15, 30 + seconds))
  }

  it('records exact body bytes in a versioned envelope', async () => {
    const body = new TextEncoder().encode('{"items":[1]}\n')
    const journal = createJournal()

    const snapshot = await journal.record({
      requestUrl: SEARCH_URL,
      status: 200,
      body,
    })

    expect(snapshot).toEqual({
      version: 1,
      id: 'snapshot-1',
      endpoint: 'api.kufar.by/search-api/v2/search/rendered-paginated',
      requestUrl: SEARCH_URL,
      status: 200,
      capturedAt: '2026-09-08T10:15:30.000Z',
      bodyBase64: Buffer.from(body).toString('base64'),
    })

    await expect(journal.list(snapshot.endpoint)).resolves.toEqual([snapshot])
  })

  it('maps different query strings to the same endpoint bucket', async () => {
    const journal = createJournal()

    await journal.record({
      requestUrl: SEARCH_URL,
      status: 200,
      body: Uint8Array.of(1),
    })

    advanceSnapshot('snapshot-2', 1)

    await journal.record({
      requestUrl: 'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=1010',
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

  it('retains only the newest five snapshots per endpoint', async () => {
    const journal = createJournal(5)

    for (let index = 0; index < 6; index += 1) {
      advanceSnapshot(`snapshot-${index}`, index)
      await journal.record({
        requestUrl: SEARCH_URL,
        status: 200,
        body: Uint8Array.of(index),
      })
    }

    expect((await journal.list(SEARCH_URL)).map((item) => item.id)).toEqual([
      'snapshot-1',
      'snapshot-2',
      'snapshot-3',
      'snapshot-4',
      'snapshot-5',
    ])
  })

  it('keeps retention independent for different endpoint paths', async () => {
    const journal = createJournal(2)

    for (const [index, id] of ['a1', 'a2', 'a3'].entries()) {
      advanceSnapshot(id, index)
      await journal.record({ requestUrl: SEARCH_URL, status: 200, body: Uint8Array.of(index) })
    }

    advanceSnapshot('b1', 3)
    await journal.record({ requestUrl: DETAILS_URL, status: 200, body: Uint8Array.of(9) })

    expect((await journal.list(SEARCH_URL)).map((item) => item.id)).toEqual(['a2', 'a3'])
    expect((await journal.list(DETAILS_URL)).map((item) => item.id)).toEqual(['b1'])
  })

  it('lists snapshots written by a previous journal instance', async () => {
    await createJournal().record({ requestUrl: SEARCH_URL, status: 200, body: Uint8Array.of(1) })

    const restarted = new FileKufarRawResponseJournal({ rootDir })

    await expect(restarted.list(SEARCH_URL)).resolves.toMatchObject([
      {
        id: 'snapshot-1',
        endpoint: 'api.kufar.by/search-api/v2/search/rendered-paginated',
      },
    ])
  })

  it('exports exact original response bytes', async () => {
    const original = Uint8Array.from([0x7b, 0x0a, 0x20, 0x7d, 0x0a])
    const journal = createJournal()
    const snapshot = await journal.record({ requestUrl: SEARCH_URL, status: 200, body: original })
    const destination = join(rootDir, 'fixture.json')

    await journal.exportSnapshot(SEARCH_URL, snapshot.id, destination)

    expect(new Uint8Array(await readFile(destination))).toEqual(original)
  })

  it('rejects export of an unknown snapshot id', async () => {
    const journal = createJournal()

    await expect(
      journal.exportSnapshot(SEARCH_URL, 'missing', join(rootDir, 'fixture.json')),
    ).rejects.toThrow(/snapshot.*missing/i)
  })

  it('reports a malformed stored envelope as journal corruption', async () => {
    const journal = createJournal()
    await journal.record({ requestUrl: SEARCH_URL, status: 200, body: Uint8Array.of(1) })

    const [endpointDirName] = await readdir(rootDir)
    const endpointDir = join(rootDir, endpointDirName)
    const [snapshotFilename] = await readdir(endpointDir)
    await writeFile(join(endpointDir, snapshotFilename), '{broken', 'utf8')

    await expect(journal.list(SEARCH_URL)).rejects.toThrow(/invalid raw response snapshot/i)
  })
})
