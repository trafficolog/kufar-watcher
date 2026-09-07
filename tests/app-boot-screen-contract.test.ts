import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(): Promise<string> {
  return readFile(new URL('../app/components/AppBootScreen.vue', import.meta.url), 'utf8')
}

describe('AppBootScreen', () => {
  it('renders the boot model and exposes only the three fatal recovery actions', async () => {
    const vue = await source()

    expect(vue).toContain('BootScreenModel')
    expect(vue).toContain('model.steps')
    expect(vue).toContain('model.error')
    expect(vue).toContain("emit('retry')")
    expect(vue).toContain("emit('openJournal')")
    expect(vue).toContain("emit('exit')")
    expect(vue).toContain('Повторить')
    expect(vue).toContain('Открыть журнал')
    expect(vue).toContain('Выйти')
    expect(vue).not.toContain('Успешный запуск')
    expect(vue).not.toContain('Светлая тема')
  })
})
