import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { rawResponseJournalArg, rawResponseJournalDir } from '../electron/main/worker-storage'
import { readWorkerConfig } from '../electron/worker/config'

describe('raw response journal worker storage config', () => {
  it('derives the journal directory from the supplied Electron userData path', () => {
    expect(rawResponseJournalDir('/profile/Kufar Monitor')).toBe(
      join('/profile/Kufar Monitor', 'raw-responses'),
    )
  })

  it('serializes and parses the worker journal argument without rebuilding OS paths', () => {
    const argument = rawResponseJournalArg('/profile/Kufar Monitor')

    expect(readWorkerConfig(['electron', 'worker.js', argument])).toEqual({
      rawResponseJournalDir: join('/profile/Kufar Monitor', 'raw-responses'),
    })
  })

  it('rejects startup when the journal directory argument is missing', () => {
    expect(() => readWorkerConfig(['electron', 'worker.js'])).toThrow(/raw response journal/i)
  })

  it('validates worker journal configuration at startup', async () => {
    const source = await readFile(new URL('../electron/worker/index.ts', import.meta.url), 'utf8')

    expect(source).toMatch(/readWorkerConfig\(process\.argv\)/)
  })
})
