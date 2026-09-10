import { RAW_RESPONSE_JOURNAL_ARG } from '../../shared/worker-config'

export const DEFAULT_MONITOR_MAX_PAGES = 5

export interface WorkerConfig {
  rawResponseJournalDir: string
  databaseUrl: string
  monitorMaxPages: number
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
    monitorMaxPages: DEFAULT_MONITOR_MAX_PAGES,
  }
}
