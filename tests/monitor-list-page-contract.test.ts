import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(): Promise<string> {
  return readFile(new URL('../app/pages/monitors.vue', import.meta.url), 'utf8')
}

describe('monitor list page', () => {
  it('shows monitor/runtime state and refreshes from desktop events without timer polling', async () => {
    const vue = await source()

    expect(vue).toContain('onMounted')
    expect(vue).toContain('onUnmounted')
    expect(vue).toContain('.monitors.list(')
    expect(vue).toContain('.monitors.onChanged(')
    expect(vue).toContain('.monitors.setState(')
    expect(vue).toContain('.system.getBootState(')
    expect(vue).toContain('.system.onBootState(')
    expect(vue).toContain('.telegram.getState(')
    expect(vue).toContain('.telegram.onState(')
    expect(vue).toContain('Последний обход')
    expect(vue).toContain('Приостановить')
    expect(vue).toContain('Возобновить')
    expect(vue).toContain('PostgreSQL')
    expect(vue).toContain('Telegram')
    expect(vue).toContain('lastRun.errorCode')
    expect(vue).toContain('.monitors.create(')
    expect(vue).not.toContain('setInterval(')
  })
})
