import { RAW_RESPONSE_JOURNAL_ARG } from '../../shared/worker-config'

export interface WorkerConfig {
  rawResponseJournalDir: string
}

export function readWorkerConfig(argv: readonly string[]): WorkerConfig {
  const argument = argv.find((value) => value.startsWith(RAW_RESPONSE_JOURNAL_ARG))
  const rawResponseJournalDir = argument?.slice(RAW_RESPONSE_JOURNAL_ARG.length)

  if (!rawResponseJournalDir) {
    throw new Error('Utility worker requires a raw response journal directory')
  }

  return { rawResponseJournalDir }
}
