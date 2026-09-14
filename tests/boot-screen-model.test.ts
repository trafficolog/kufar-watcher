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

function incompatibleContainerState(
  mismatches: string[] = ['host', 'port'],
): BootState {
  return {
    phase: 'error',
    steps: [
      { id: 'docker', state: 'success', detail: 'Docker daemon is available' },
      { id: 'database', state: 'error', detail: 'Existing PostgreSQL container configuration is incompatible' },
      { id: 'migrations', state: 'pending', detail: 'Waiting for database' },
      { id: 'scheduler', state: 'pending', detail: 'Waiting for migrations' },
      { id: 'telegram', state: 'skipped', detail: 'Telegram is not configured yet' },
    ],
    errorCode: 'database-container-incompatible',
    postgresContainerMismatches: mismatches,
  } as unknown as BootState
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

  it('shows reversible Linux stop-rename-retry guidance for binding-only mismatch', () => {
    const model = buildBootScreenModel(incompatibleContainerState(['host', 'port']), 'linux')

    expect(model.error?.heading).toBe('Конфликт локального Postgres')
    expect(model.error?.message).toContain('kufar-watcher-postgres')
    expect(model.error?.message).toContain('адрес')
    expect(model.error?.message).toContain('порт')
    expect(model.error?.message).toContain('docker stop')
    expect(model.error?.message).toContain('docker rename')
    expect(model.error?.message).toContain('Повторить')
    expect(model.error?.message).toContain('volume')
    expect(model.error?.message).not.toContain('docker rm')
  })

  it('mentions Docker Desktop for the reversible binding-only recovery path on Windows', () => {
    const model = buildBootScreenModel(incompatibleContainerState(['port']), 'win32')

    expect(model.error?.message).toContain('Docker Desktop')
    expect(model.error?.message).toContain('порт')
    expect(model.error?.message).toContain('docker rename')
    expect(model.error?.message).not.toContain('docker rm')
  })

  it('blocks simple rename-and-retry for data-sensitive container mismatch', () => {
    const model = buildBootScreenModel(
      incompatibleContainerState(['image', 'password', 'database']),
      'linux',
    )

    expect(model.error?.message).toContain('образ')
    expect(model.error?.message).toContain('пароль')
    expect(model.error?.message).toContain('база данных')
    expect(model.error?.message).toContain('не нажимайте «Повторить»')
    expect(model.error?.message).toContain('резервную копию')
    expect(model.error?.message).toContain('docker inspect')
    expect(model.error?.message).not.toContain('docker rm')
  })

  it('keeps generic configuration-invalid guidance separate from Docker container recovery', () => {
    const model = buildBootScreenModel(
      state({ phase: 'error', errorCode: 'configuration-invalid' }),
      'linux',
    )

    expect(model.error?.heading).toBe('Не удалось подготовить локальную базу')
    expect(model.error?.message).not.toContain('kufar-watcher-postgres')
    expect(model.error?.message).not.toContain('docker rename')
    expect(model.error?.message).not.toContain('существующего контейнера')
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
