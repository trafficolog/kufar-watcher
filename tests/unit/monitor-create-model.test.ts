import { describe, expect, it } from 'vitest'

interface MonitorCreateModelModule {
  previewMonitorUrl?: (sourceUrl: string) => unknown
}

describe('monitor create model', () => {
  it('shows parsed category, region, and search query before save', async () => {
    const module: MonitorCreateModelModule = await import('../../app/lib/monitor-create-model')

    expect(module.previewMonitorUrl).toBeTypeOf('function')
    const preview = module.previewMonitorUrl!(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~playstation',
    )

    expect(preview).toEqual({
      state: 'valid',
      category: 'Электроника',
      region: 'minsk',
      query: 'playstation',
    })
  })

  it('returns clear inline errors for out-of-scope and invalid URLs', async () => {
    const module: MonitorCreateModelModule = await import('../../app/lib/monitor-create-model')

    expect(module.previewMonitorUrl!('https://auto.kufar.by/l/avtomobili')).toEqual({
      state: 'error',
      message: 'Авто пока не поддерживается. Вставьте ссылку из поддерживаемой категории Kufar.',
    })
    expect(module.previewMonitorUrl!('https://www.kufar.by/l/mebel')).toEqual({
      state: 'error',
      message: 'Эта категория Kufar пока не поддерживается.',
    })
    expect(module.previewMonitorUrl!('https://example.com/l/igry-i-pristavki')).toEqual({
      state: 'error',
      message: 'Нужна ссылка с kufar.by.',
    })
  })
})
