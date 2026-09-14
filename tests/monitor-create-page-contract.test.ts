import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(): Promise<string> {
  return readFile(new URL('../app/pages/monitors.vue', import.meta.url), 'utf8')
}

describe('monitor quick-create page', () => {
  it('renders the MVP form, URL preview, term guidance, and desktop create action', async () => {
    const vue = await source()

    expect(vue).toContain('previewMonitorUrl')
    expect(vue).toContain('parseMonitorTerms')
    expect(vue).toContain('useDesktopApi')
    expect(vue).toContain('.monitors.create(')
    expect(vue).toContain('Название')
    expect(vue).toContain('Ссылка Kufar')
    expect(vue).toContain('Интервал')
    expect(vue).toContain('Включающие термы')
    expect(vue).toContain('Исключающие термы')
    expect(vue).toContain('Категория')
    expect(vue).toContain('Регион')
    expect(vue).toContain('Поисковая строка')
    expect(vue).toContain('*')
    expect(vue).toMatch(/словоформ/i)
    expect(vue).toContain('@submit.prevent')
  })
})
