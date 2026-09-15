import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('first-run route lifecycle', () => {
  it('subscribes before initial reads, redirects once monitors exist, and cleans up', () => {
    const source = readFileSync('app/pages/index.vue', 'utf8')
    const telegramReadPattern = /api\.telegram\s*\.getState\(\)/
    const subscriptionsBeforeInitialRefresh =
      /unsubscribeMonitors = api\.monitors\.onChanged\([\s\S]*unsubscribeTelegram = api\.telegram\.onState\([\s\S]*\n\s*void refreshMonitors\(\)/

    expect(source).toMatch(/import \{[^}]*onMounted[^}]*onUnmounted[^}]*ref[^}]*\} from 'vue'/)
    expect(source).toContain('api.monitors.onChanged(')
    expect(source).toContain('api.telegram.onState(')
    expect(source).toContain('api.monitors.list()')
    expect(source).toMatch(telegramReadPattern)
    expect(source).toMatch(subscriptionsBeforeInitialRefresh)
    expect(source).toContain("navigateTo('/monitors')")
    expect(source).toContain('onUnmounted(() => {')
    expect(source).not.toContain('setInterval(')

    const telegramSubscribe = source.indexOf('api.telegram.onState(')
    const telegramRead = source.search(telegramReadPattern)

    expect(telegramSubscribe).toBeGreaterThan(-1)
    expect(telegramSubscribe).toBeLessThan(telegramRead)

    expect(source).toMatch(/unsubscribeMonitors\?\.\(\)/)
    expect(source).toMatch(/unsubscribeTelegram\?\.\(\)/)
  })
})
