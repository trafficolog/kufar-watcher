import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('first-run page content', () => {
  it('shows the two MVP setup steps and zero-count future sections', () => {
    const source = readFileSync('app/pages/index.vue', 'utf8')

    expect(source).toContain("import { computed, onMounted, onUnmounted, ref } from 'vue'")
    expect(source).toContain('const telegramConfigured = computed(')
    expect(source).toContain("telegramState.value?.secret === 'protected'")
    expect(source).toContain("telegramState.value?.secret === 'unprotected'")
    expect(source).toContain('telegramState.value?.boundChatId !== null')

    expect(source).toContain('Первый запуск')
    expect(source).toContain('Kufar Monitor готов к работе')
    expect(source).toContain('Телеграм настроен')
    expect(source).toContain('Настройте Telegram')
    expect(source).toContain('Создайте первое правило')
    expect(source).toContain('Первый обход не пришлёт уведомлений')
    expect(source).toContain('Избранное')
    expect(source).toContain('Архив')
    expect(source).toContain('>00<')

    expect(source).toContain('to="/settings"')
    expect(source).toContain('to="/monitors"')
    expect(source).not.toContain('to="/feed"')
    expect(source).not.toContain('to="/favorites"')
    expect(source).not.toContain('to="/archive"')
    expect(source).not.toContain('to="/onboarding"')
  })
})
