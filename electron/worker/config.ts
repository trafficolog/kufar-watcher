import { RAW_RESPONSE_JOURNAL_ARG } from '../../shared/worker-config'

const MONITOR_MAX_PAGES_ENV = 'KUFAR_MONITOR_MAX_PAGES'

export const DEFAULT_MONITOR_MAX_PAGES = 5
export const MAX_MONITOR_MAX_PAGES = 100

export interface WorkerConfig {
  rawResponseJournalDir: string
  databaseUrl: string
  monitorMaxPages: number
}

function readMonitorMaxPages(env: NodeJS.ProcessEnv): number {
  const rawValue = env[MONITOR_MAX_PAGES_ENV]
  if (rawValue === undefined) return DEFAULT_MONITOR_MAX_PAGES

  const parsed = Number(rawValue)
  if (
    !/^\d+$/u.test(rawValue) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_MONITOR_MAX_PAGES
  ) {
    throw new Error(
      `${MONITOR_MAX_PAGES_ENV} must be an integer between 1 and ${MAX_MONITOR_MAX_PAGES}`,
    )
  }

  return parsed
}

export function readWorkerConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const argument = argv.find((value) => value.startsWith(RAW_RESPONSE_JOURNAL_ARG))
  const rawResponseJournalDir = argument?.slice(RAW_RESPONSE_JOURNAL_ARG.length)

  if (!rawResponseJournalDir) {
    throw new Error('Utility worker requires a raw response journal directory')
  }

  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('Utility worker requires DATABASE_URL')
  }

  return {
    rawResponseJournalDir,
    databaseUrl,
    monitorMaxPages: readMonitorMaxPages(env),
  }
}
