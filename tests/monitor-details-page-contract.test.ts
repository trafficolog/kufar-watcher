import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function read(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

describe('monitor parameters navigation', () => {
  it('offers an accessible per-monitor parameters disclosure without triggering pause or archive', async () => {
    const vue = await read('../app/pages/monitors.vue')
    expect(vue).toContain('Параметры')
    expect(vue).toMatch(/<details[^>]*>/)
    expect(vue).toContain('monitor.sourceUrl')
    expect(vue).toContain('Открыть выдачу Kufar')
    expect(vue).toContain('monitor.include')
    expect(vue).toContain('monitor.exclude')
    expect(vue).toContain('NuxtLink')
  })

  it('supplies saved URL and filters from the database instead of guessing URLs from monitor names', async () => {
    const worker = await read('../electron/worker/worker-application.ts')
    const contract = await read('../shared/ipc.ts')
    expect(worker).toContain('sourceUrl: true')
    expect(worker).toContain('keywords: true')
    expect(contract).toContain('sourceUrl: string')
    expect(contract).toContain('include: string[]')
    expect(contract).toContain('exclude: string[]')
  })

  it('opens external URLs only via a host-validated Electron path', async () => {
    const main = await read('../electron/main/index.ts')
    expect(main).toContain('isAllowedKufarListingUrl')
    expect(main).toContain('shell.openExternal')
    expect(main).toContain('setWindowOpenHandler')
  })
})
