import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('utility worker database wiring', () => {
  it('passes the resolved bootstrap database URL through the worker environment', async () => {
    const source = await readFile(new URL('../electron/main/index.ts', import.meta.url), 'utf8')

    expect(source).toContain("import { workerProcessEnvironment } from './worker-process-env'")
    expect(source).toContain('let resolvedDatabaseUrl: string | undefined')
    expect(source).toContain('resolvedDatabaseUrl = undefined')
    expect(source).toContain('resolvedDatabaseUrl = config.databaseUrl')
    expect(source).toContain('workerProcessEnvironment(process.env, resolvedDatabaseUrl)')
  })
})
