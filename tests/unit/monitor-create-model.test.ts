import { describe, expect, it } from 'vitest'

interface MonitorCreateModelModule {
  previewMonitorUrl?: (sourceUrl: string) => unknown
}

describe('monitor create model', () => {
  it('shows parsed category, region, and search query before save', async () => {
    const module = (await import('../../app/lib/monitor-create-model')) as MonitorCreateModelModule

    expect(module.previewMonitorUrl).toBeTypeOf('function')
    expect(
      module.previewMonitorUrl!(
        'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~playstation',
      ),
    ).toEqual({
      state: 'valid',
      category: 'Электроника',
      region: 'minsk',
      query: 'playstation',
    })
  })
})
