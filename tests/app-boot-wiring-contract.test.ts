import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(): Promise<string> {
  return readFile(new URL('../app/app.vue', import.meta.url), 'utf8')
}

describe('root boot screen wiring', () => {
  it('gates NuxtPage behind the boot controller and disposes renderer side effects', async () => {
    const vue = await source()

    expect(vue).toContain('createBootScreenController')
    expect(vue).toContain('useDesktopApi')
    expect(vue).toContain('delayMs: 150')
    expect(vue).toContain('onMounted')
    expect(vue).toContain('onBeforeUnmount')
    expect(vue).toContain('controller.dispose()')
    expect(vue).toContain("snapshot.view === 'pending'")
    expect(vue).toContain("snapshot.view === 'boot'")
    expect(vue).toContain("snapshot.view === 'app'")
    expect(vue).toContain('<AppBootScreen')
    expect(vue).toContain('@retry="retry"')
    expect(vue).toContain('@open-journal="openJournal"')
    expect(vue).toContain('@exit="exit"')
    expect(vue).toContain('<NuxtPage')
  })
})
