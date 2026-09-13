import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readMainSource(): Promise<string> {
  return readFile(new URL('../electron/main/index.ts', import.meta.url), 'utf8')
}

describe('utility worker database wiring', () => {
  it('passes the resolved bootstrap database URL through the worker environment', async () => {
    const source = await readMainSource()

    expect(source).toContain("import { workerProcessEnvironment } from './worker-process-env'")
    expect(source).toContain('let resolvedDatabaseUrl: string | undefined')
    expect(source).toContain('resolvedDatabaseUrl = undefined')
    expect(source).toContain('resolvedDatabaseUrl = config.databaseUrl')
    expect(source).toContain('workerProcessEnvironment(process.env, resolvedDatabaseUrl)')
  })
})

describe('Telegram worker secret wiring', () => {
  it('decrypts the Telegram secret in Electron main and configures the supervisor in memory', async () => {
    const source = await readMainSource()

    expect(source).toContain("import { readFile } from 'node:fs/promises'")
    expect(source).toContain('safeStorage')
    expect(source).toContain(
      "import { configureTelegramFromSecret } from './telegram-main-runtime'",
    )
    expect(source).toContain("import { createTelegramSecretStore } from './telegram-secret-store'")
    expect(source).toContain('const telegramSecretStore = createTelegramSecretStore(userDataDir, {')
    expect(source).toContain('platform: process.platform')
    expect(source).toContain('readFile')
    expect(source).toContain('safeStorage')
    expect(source).toContain('await configureTelegramFromSecret(telegramSecretStore, supervisor)')
  })

  it('keeps Telegram token plaintext out of worker argv and environment', async () => {
    const source = await readMainSource()

    expect(source).toContain('utilityProcess.fork(workerPath, [workerJournalArg], {')
    expect(source).toContain('env: workerProcessEnvironment(process.env, resolvedDatabaseUrl)')
    expect(source).not.toContain('TELEGRAM_BOT_TOKEN')
    expect(source).not.toContain('telegramToken:')
  })

  it('projects Telegram worker state and binds only the current main-process candidate', async () => {
    const source = await readMainSource()

    expect(source).toContain('let telegramState: TelegramDesktopState = {')
    expect(source).toContain(
      'routeWorkerTelegramEvent(event, telegramState, broadcastTelegramState)',
    )
    expect(source).toContain('registerTelegramIpcHandlers(')
    expect(source).toContain('getTelegramState: () => telegramState')
    expect(source).toContain('const candidate = telegramState.candidate')
    expect(source).toContain("if (!candidate) return 'no-candidate'")
    expect(source).toContain('return supervisor.bindTelegramCandidate(candidate.chatId)')
    expect(source).not.toContain('bindTelegramCandidate(chatId')
  })
})
