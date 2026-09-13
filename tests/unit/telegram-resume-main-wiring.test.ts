import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readMainSource(): Promise<string> {
  return readFile(new URL('../../electron/main/index.ts', import.meta.url), 'utf8')
}

describe('Telegram Electron resume wiring', () => {
  it('forwards system resume to the supervisor without retransmitting a token', async () => {
    const source = await readMainSource()

    expect(source).toContain('powerMonitor')
    expect(source).toContain("powerMonitor.on('resume'")
    expect(source).toContain('supervisor.resumeTelegram()')
    expect(source).not.toContain("powerMonitor.on('resume', () => supervisor.configureTelegram")
  })
})
