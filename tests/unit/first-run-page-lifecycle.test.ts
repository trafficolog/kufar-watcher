import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('first-run route lifecycle', () => {
  it('subscribes before initial reads, redirects once monitors exist, and cleans up', () => {
    const source = readFileSync('app/pages/index.vue', 'utf8')

    expect(source).toContain("import { onMounted, onUnmounted, ref } from 'vue'")
    expect(source).toContain('api.monitors.onChanged(')
    expect(source).toContain('api.telegram.onState(')
    expect(source).toContain('api.monitors.list()')
    expect(source).toContain('api.telegram.getState()')
    expect(source).toContain("navigateTo('/monitors')")
    expect(source).toContain('onUnmounted(() => {')
    expect(source).not.toContain('setInterval(')

    const monitorSubscribe = source.indexOf('api.monitors.onChanged(')
    const telegramSubscribe = source.indexOf('api.telegram.onState(')
    const monitorRead = source.indexOf('api.monitors.list()')
    const telegramRead = source.indexOf('api.telegram.getState()')

    expect(monitorSubscribe).toBeGreaterThan(-1)
    expect(telegramSubscribe).toBeGreaterThan(-1)
    expect(monitorSubscribe).toBeLessThan(monitorRead)
    expect(telegramSubscribe).toBeLessThan(telegramRead)

    expect(source).toMatch(/unsubscribeMonitors\?\.\(\)/)
    expect(source).toMatch(/unsubscribeTelegram\?\.\(\)/)
  })
})
