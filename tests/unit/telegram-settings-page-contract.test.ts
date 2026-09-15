import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(): Promise<string> {
  return readFile(new URL('../../app/pages/settings.vue', import.meta.url), 'utf8')
}

describe('Telegram settings page contract', () => {
  it('verifies the bot token before saving and requires explicit consent for unprotected storage', async () => {
    const vue = await source()

    expect(vue).toContain('useDesktopApi')
    expect(vue).toContain('.telegram.verifyToken(')
    expect(vue).toContain('.telegram.saveToken(')
    expect(vue).toContain("result.state === 'confirmation-required'")
    expect(vue).toContain('allowUnprotected')
    expect(vue).toContain('Сохранить без защиты')
    expect(vue).toContain('type="password"')
  })

  it('shows the discovered candidate and binds it without renderer-owned chat id input', async () => {
    const vue = await source()

    expect(vue).toMatch(/\.telegram\s*\.getState\(\)/)
    expect(vue).toContain('.telegram.onState(')
    expect(vue).toContain('candidate.displayName')
    expect(vue).toContain('candidate.chatType')
    expect(vue).toContain('.telegram.bindCandidate()')
    expect(vue).toContain('Привязать')
    expect(vue).not.toMatch(/v-model[^\n]*chatId/i)
    expect(vue).not.toContain('.telegram.bindCandidate(' + 'candidate.chatId')
  })

  it('sends a fixed test message only through the no-argument desktop API and hides raw errors', async () => {
    const vue = await source()

    expect(vue).toContain('.telegram.sendTestMessage()')
    expect(vue).toContain('Тестовое')
    expect(vue).toContain('Сообщение отправлено')
    expect(vue).not.toContain('error.message')
    expect(vue).not.toContain('String(error)')
  })
})
