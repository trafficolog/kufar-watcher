import { describe, expect, it } from 'vitest'
import type { BootState } from '../shared/ipc'
import { buildBootScreenModel } from '../app/lib/boot-screen-model'

function state(overrides: Partial<BootState> = {}): BootState {
  return {
    phase: 'starting',
    steps: [
      { id: 'docker', state: 'success', detail: 'Docker daemon is available' },
      { id: 'database', state: 'running', detail: 'Waiting for PostgreSQL healthcheck' },
      { id: 'migrations', state: 'pending', detail: 'Waiting for database' },
      { id: 'scheduler', state: 'pending', detail: 'Waiting for migrations' },
      { id: 'telegram', state: 'skipped', detail: 'Telegram is not configured yet' },
    ],
    ...overrides,
  }
}

describe('buildBootScreenModel', () => {
  it('maps infrastructure steps to the prototype order and presentation states', () => {
    const model = buildBootScreenModel(state(), 'linux')

    expect(model.title).toBe('Инициализация')
    expect(model.steps.map((step) => step.label)).toEqual([
      'Docker',
      'Postgres',
      'Схема данных',
      'Планировщик',
      'Telegram',
    ])
    expect(model.steps.map((step) => [step.marker, step.status, step.tone])).toEqual([
      ['✓', 'демон отвечает', 'success'],
      ['◴', 'жду готовности', 'running'],
      ['·', 'ожидает', 'idle'],
      ['·', 'ожидает', 'idle'],
      ['—', 'не настроен · шаг пропущен', 'skipped'],
    ])
  })

  it('shows a Linux-specific Docker recovery hint for a fatal daemon error', () => {
    const model = buildBootScreenModel(
      state({
        phase: 'error',
        errorCode: 'docker-unavailable',
        steps: [
          { id: 'docker', state: 'error', detail: 'Docker daemon is unavailable' },
          { id: 'database', state: 'pending', detail: 'Waiting for Docker' },
          { id: 'migrations', state: 'pending', detail: 'Waiting for database' },
          { id: 'scheduler', state: 'pending', detail: 'Waiting for migrations' },
          { id: 'telegram', state: 'skipped', detail: 'Telegram is not configured yet' },
        ],
      }),
      'linux',
    )

    expect(model.title).toBe('Запуск прерван')
    expect(model.error?.heading).toBe('Docker недоступен')
    expect(model.error?.message).toContain('служба docker')
    expect(model.error?.message).toContain('доступ к сокету')
  })

  it('shows a Windows Docker Desktop hint on Windows', () => {
    const model = buildBootScreenModel(
      state({ phase: 'error', errorCode: 'docker-unavailable' }),
      'win32',
    )

    expect(model.error?.message).toContain('Docker Desktop')
  })

  it('explains that an incompatible existing Postgres container is left unchanged', () => {
    const model = buildBootScreenModel(
      state({ phase: 'error', errorCode: 'configuration-invalid' }),
      'linux',
    )

    expect(model.error?.heading).toBe('Не удалось подготовить локальную базу')
    expect(model.error?.message).toContain('существующего контейнера')
    expect(model.error?.message).toContain('Контейнер не изменён')
  })

  it('does not treat skipped or degraded Telegram as a fatal launch error', () => {
    const ready = state({
      phase: 'ready',
      steps: [
        { id: 'docker', state: 'success', detail: 'Docker daemon is available' },
        { id: 'database', state: 'success', detail: 'PostgreSQL is healthy' },
        { id: 'migrations', state: 'success', detail: 'Database migrations applied' },
        { id: 'scheduler', state: 'success', detail: 'Worker started' },
        { id: 'telegram', state: 'degraded', detail: 'Telegram network is unavailable' },
      ],
    })

    const model = buildBootScreenModel(ready, 'linux')

    expect(model.title).toBe('Готово')
    expect(model.error).toBeUndefined()
    expect(model.steps.at(-1)).toMatchObject({
      marker: '!',
      status: 'сеть недоступна · уведомления в очереди',
      tone: 'degraded',
    })
  })
})
