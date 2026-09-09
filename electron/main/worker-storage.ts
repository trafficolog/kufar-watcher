import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { RAW_RESPONSE_JOURNAL_ARG } from '../../shared/worker-config'

export interface ShellPathOpener {
  openPath(path: string): Promise<string>
}

export function rawResponseJournalDir(userDataDir: string): string {
  return join(userDataDir, 'raw-responses')
}

export function rawResponseJournalArg(userDataDir: string): string {
  return `${RAW_RESPONSE_JOURNAL_ARG}${rawResponseJournalDir(userDataDir)}`
}

export async function openRawResponseJournal(
  shell: ShellPathOpener,
  userDataDir: string,
): Promise<void> {
  const path = rawResponseJournalDir(userDataDir)
  mkdirSync(path, { recursive: true })
  const error = await shell.openPath(path)
  if (error) throw new Error(`Failed to open raw-response journal: ${error}`)
}
