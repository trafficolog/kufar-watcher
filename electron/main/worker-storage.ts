import { join } from 'node:path'

import { RAW_RESPONSE_JOURNAL_ARG } from '../../shared/worker-config'

export function rawResponseJournalDir(userDataDir: string): string {
  return join(userDataDir, 'raw-responses')
}

export function rawResponseJournalArg(userDataDir: string): string {
  return `${RAW_RESPONSE_JOURNAL_ARG}${rawResponseJournalDir(userDataDir)}`
}
