import type {
  BootState,
  BootStep,
  BootStepId,
  BootStepState,
  PostgresContainerMismatchField,
} from '../../shared/ipc'

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

const POSTGRES_MISMATCH_LABELS: Record<PostgresContainerMismatchField, string> = {
  image: 'образ',
  volumeName: 'volume данных',
  host: 'адрес',
  port: 'порт',
  user: 'пользователь',
  password: 'пароль',
  database: 'база данных',
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

function incompatibleContainerError(state: BootState, platform: BootUiPlatform): BootScreenError {
  const containerName = 'kufar-watcher-postgres'
  const backupName = 'kufar-watcher-postgres-backup'
  const mismatches = state.postgresContainerMismatches ?? []
  const mismatchText =
    mismatches.length > 0
      ? mismatches.map((field) => POSTGRES_MISMATCH_LABELS[field]).join(', ')
      : 'неизвестные параметры'
  const bindingOnly =
    mismatches.length > 0 && mismatches.every((field) => field === 'host' || field === 'port')

  if (!bindingOnly) {
    const inspectionHint =
      platform === 'win32'
        ? `В Docker Desktop просмотрите контейнер и его volumes; для дополнительной диагностики можно выполнить \`docker inspect ${containerName}\`.`
        : platform === 'linux'
          ? `Для безопасной диагностики выполните \`docker inspect ${containerName}\` и \`docker volume inspect kufar-watcher-postgres-data\`.`
          : `Для безопасной диагностики выполните \`docker inspect ${containerName}\`.`

    return {
      heading: 'Конфликт локального Postgres',
      message: `Контейнер ${containerName} несовместим: ${mismatchText}. Эти параметры могут затрагивать формат или содержимое data volume, поэтому не нажимайте «Повторить» после одного только переименования. Не удаляйте контейнер или volume. Сначала сделайте резервную копию и вручную спланируйте перенос или миграцию данных. ${inspectionHint}`,
    }
  }

  const recovery =
    platform === 'win32'
      ? `В Docker Desktop остановите контейнер, затем переименуйте его там или через docker CLI: \`docker rename ${containerName} ${backupName}\`. Оставьте резервный контейнер остановленным и нажмите «Повторить».`
      : `Выполните \`docker stop ${containerName}\`, затем \`docker rename ${containerName} ${backupName}\`. Оставьте резервный контейнер остановленным и нажмите «Повторить».`

  return {
    heading: 'Конфликт локального Postgres',
    message: `Контейнер ${containerName} несовместим: ${mismatchText}. Конфликт затрагивает только сетевую привязку. ${recovery} Data volume не удаляется и остаётся сохранённым.`,
  }
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

  if (state.errorCode === 'database-container-incompatible') {
    return incompatibleContainerError(state, platform)
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
        'Параметры локального Postgres недоступны или повреждены. Проверьте локальную конфигурацию и credentials либо откройте журнал для диагностики.',
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
