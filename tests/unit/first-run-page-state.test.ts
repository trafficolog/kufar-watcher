import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('first-run page state', () => {
  it('shows onboarding only after a confirmed empty monitor snapshot and exposes retry on failure', () => {
    const source = readFileSync('app/pages/index.vue', 'utf8')

    expect(source).toMatch(
      /const\s+monitorLoadState\s*=\s*ref<[^>]*'loading'[^>]*'ready'[^>]*'error'[^>]*>/,
    )
    expect(source).toContain("monitorLoadState.value = 'ready'")
    expect(source).toContain("monitorLoadState.value = 'error'")

    expect(source).toContain('v-if="monitorLoadState === \'loading\'"')
    expect(source).toContain('v-else-if="monitorLoadState === \'error\'"')
    expect(source).toContain('v-else class="first-run-shell"')

    expect(source).toContain('Не удалось загрузить правила')
    expect(source).toContain('@click="refreshMonitors"')
    expect(source).toContain('Повторить')
  })
})
