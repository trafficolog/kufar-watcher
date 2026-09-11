import type { BootState, BootStep, BootStepId, BootStepState } from '../../shared/ipc'

export type BootUiPlatform = 'linux' | 'win32' | 'other'
export type BootStepTone = 'idle' | 'running' | 'success' | 'skipped' | 'degraded' | 'error'

export interface BootScreenStep {
  id: BootStepId
  label: string
  marker: string
  status: string
  tone: BootStepTone
}

export interface BootScreenError {
  heading: string
  message: string
}

export interface BootScreenModel {
  title: string
  steps: BootScreenStep[]
  error?: BootScreenError
}

const STEP_IDS: BootStepId[] = ['docker', 'database', 'migrations', 'scheduler', 'telegram']

const STEP_LABELS: Record<BootStepId, string> = {
  docker: 'Docker',
  database: 'Postgres',
  migrations: 'Схема данных',
  scheduler: 'Планировщик',
  telegram: 'Telegram',
}

const MARKERS: Record<BootStepState, string> = {
  pending: '·',
  running: '◴',
  success: '✓',
  skipped: '—',
  degraded: '!',
  error: '✕',
}

const TONES: Record<BootStepState, BootStepTone> = {
  pending: 'idle',
  running: 'running',
  success: 'success',
  skipped: 'skipped',
  degraded: 'degraded',
  error: 'error',
}

function statusFor(step: BootStep): string {
  if (step.id === 'docker') {
    if (step.state === 'running') return 'проверяю демон'
    if (step.state === 'success') return 'демон отвечает'
    if (step.state === 'error') return 'демон недоступен'
  }

  if (step.id === 'database') {
    if (step.state === 'running') {
      return step.detail.includes('healthcheck') ? 'жду готовности' : 'поднимаю контейнер'
    }
    if (step.state === 'success') return 'контейнер поднят'
    if (step.state === 'error') return 'не удалось'
  }

  if (step.id === 'migrations') {
    if (step.state === 'running') return 'применяю миграции'
    if (step.state === 'success') return 'миграции применены'
    if (step.state === 'error') return 'не удалось'
  }

  if (step.id === 'scheduler') {
    if (step.state === 'running') return 'запускаю'
    if (step.state === 'success') return 'готов'
    if (step.state === 'error') return 'не удалось'
  }

  if (step.id === 'telegram') {
    if (step.state === 'skipped') return 'не настроен · шаг пропущен'
    if (step.state === 'degraded') return 'сеть недоступна · уведомления в очереди'
    if (step.state === 'success') return 'подключён'
    if (step.state === 'running') return 'проверяю'
    if (step.state === 'error') return 'не удалось'
  }

  return step.state === 'pending' ? 'ожидает' : step.detail
}

function pendingStep(id: BootStepId): BootStep {
  return { id, state: id === 'telegram' ? 'skipped' : 'pending', detail: '' }
}

function platformDockerHint(platform: BootUiPlatform): string {
  if (platform === 'linux') {
    return 'Проверьте, запущена ли служба docker и есть ли у вашего пользователя доступ к сокету.'
  }
  if (platform === 'win32') return 'Запустите или перезапустите Docker Desktop и повторите попытку.'
  return 'Проверьте, что Docker запущен, и повторите попытку.'
}

function errorFor(state: BootState, platform: BootUiPlatform): BootScreenError | undefined {
  if (state.phase !== 'error') return undefined

  if (state.errorCode === 'docker-unavailable') {
    return {
      heading: 'Docker недоступен',
      message: `Локальная база не может запуститься, пока недоступен Docker. ${platformDockerHint(platform)}`,
    }
  }

  if (state.errorCode === 'database-timeout') {
    return {
      heading: 'Не удалось поднять локальную базу',
      message: `Docker отвечает, но контейнер Postgres не перешёл в рабочее состояние вовремя. Мониторинг не запущен: писать находки некуда. ${platformDockerHint(platform)}`,
    }
  }

  if (state.errorCode === 'migration-failed') {
    return {
      heading: 'Не удалось применить схему данных',
      message:
        'Postgres запущен, но миграции завершились ошибкой. Мониторинг не запущен, чтобы не работать с неизвестной схемой данных.',
    }
  }

  if (state.errorCode === 'worker-failed') {
    return {
      heading: 'Не удалось запустить планировщик',
      message:
        'Локальная база готова, но рабочий процесс завершался аварийно. Повторите запуск или откройте журнал для диагностики.',
    }
  }

  if (state.errorCode === 'configuration-invalid') {
    return {
      heading: 'Не удалось подготовить локальную базу',
      message:
        'Параметры локального Postgres недоступны, повреждены или не совпадают с конфигурацией существующего контейнера. Контейнер не изменён. Проверьте настройки или откройте журнал для диагностики.',
    }
  }

  if (state.errorCode === 'unexpected-failure') {
    return {
      heading: 'Непредвиденная ошибка запуска',
      message:
        'Инициализация завершилась неожиданной ошибкой. Мониторинг не запущен. Повторите попытку или откройте журнал для диагностики.',
    }
  }

  return {
    heading: 'Запуск не завершён',
    message: 'Не удалось завершить инициализацию. Повторите попытку или откройте журнал.',
  }
}

export function buildBootScreenModel(state: BootState, platform: BootUiPlatform): BootScreenModel {
  const steps = STEP_IDS.map((id) => {
    const step = state.steps.find((candidate) => candidate.id === id) ?? pendingStep(id)
    return {
      id,
      label: STEP_LABELS[id],
      marker: MARKERS[step.state],
      status: statusFor(step),
      tone: TONES[step.state],
    }
  })

  return {
    title:
      state.phase === 'ready'
        ? 'Готово'
        : state.phase === 'error'
          ? 'Запуск прерван'
          : 'Инициализация',
    steps,
    error: errorFor(state, platform),
  }
}
