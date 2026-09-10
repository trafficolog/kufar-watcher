import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { rawResponseJournalArg, rawResponseJournalDir } from '../electron/main/worker-storage'
import { DEFAULT_MONITOR_MAX_PAGES, readWorkerConfig } from '../electron/worker/config'

describe('raw response journal worker storage config', () => {
  it('derives the journal directory from the supplied Electron userData path', () => {
    expect(rawResponseJournalDir('/profile/Kufar Monitor')).toBe(
      join('/profile/Kufar Monitor', 'raw-responses'),
    )
  })

  it('serializes the worker journal argument and combines it with private database env', () => {
    const argument = rawResponseJournalArg('/profile/Kufar Monitor')

    expect(
      readWorkerConfig(['electron', 'worker.js', argument], {
        DATABASE_URL: 'postgresql://worker-db',
      }),
    ).toEqual({
      rawResponseJournalDir: join('/profile/Kufar Monitor', 'raw-responses'),
      databaseUrl: 'postgresql://worker-db',
      monitorMaxPages: DEFAULT_MONITOR_MAX_PAGES,
    })
    expect(DEFAULT_MONITOR_MAX_PAGES).toBe(5)
  })

  it('rejects startup when the journal directory argument is missing', () => {
    expect(() =>
      readWorkerConfig(['electron', 'worker.js'], { DATABASE_URL: 'postgresql://worker-db' }),
    ).toThrow(/raw response journal/i)
  })

  it('rejects startup when the database URL is missing', () => {
    const argument = rawResponseJournalArg('/profile/Kufar Monitor')

    expect(() => readWorkerConfig(['electron', 'worker.js', argument], {})).toThrow(/database_url/i)
  })

  it('validates worker journal configuration at startup', async () => {
    const source = await readFile(new URL('../electron/worker/index.ts', import.meta.url), 'utf8')

    expect(source).toMatch(/readWorkerConfig\(process\.argv/)
  })
})
