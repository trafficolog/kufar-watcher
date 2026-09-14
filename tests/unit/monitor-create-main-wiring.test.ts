import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readMainSource(): Promise<string> {
  return readFile(new URL('../../electron/main/index.ts', import.meta.url), 'utf8')
}

describe('monitor create Electron main wiring', () => {
  it('registers monitor creation and delegates it to the worker supervisor', async () => {
    const source = await readMainSource()

    expect(source).toContain('registerMonitorIpcHandlers')
    expect(source).toContain('createMonitor: (input) => supervisor.createMonitor(input)')
  })
})
