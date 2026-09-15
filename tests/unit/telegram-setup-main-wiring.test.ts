import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readMainSource(): Promise<string> {
  return readFile(new URL('../../electron/main/index.ts', import.meta.url), 'utf8')
}

describe('Telegram setup Electron main wiring', () => {
  it('connects writable secret storage and token verify/save services to trusted IPC', async () => {
    const source = await readMainSource()

    expect(source).toContain("import { readFile, writeFile } from 'node:fs/promises'")
    expect(source).toContain('writeFile,\n    safeStorage,')
    expect(source).toContain('verifyTelegramToken(supervisor, token)')
    expect(source).toContain('saveTelegramToken(')
    expect(source).toContain('telegramSecretStore,')
    expect(source).toContain('allowUnprotected,')
  })
})
