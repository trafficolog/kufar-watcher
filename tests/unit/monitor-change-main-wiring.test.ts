import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readMainSource(): Promise<string> {
  return readFile(new URL('../../electron/main/index.ts', import.meta.url), 'utf8')
}

describe('monitor change Electron main wiring', () => {
  it('broadcasts worker monitor changes to renderer windows on the typed IPC event', async () => {
    const source = await readMainSource()

    expect(source).toContain('window.webContents.send(IPC.monitorChangedEvent, monitorId)')
    expect(source).toContain(
      "if (event.type === 'monitor-changed') broadcastMonitorChanged(event.monitorId)",
    )
  })
})
