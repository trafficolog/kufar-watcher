export const RUN_OUTCOME = {
  RUNNING: 'running',
  SUCCESS: 'success',
  CATCHUP: 'catchup',
  SKIPPED: 'skipped',
  ERROR: 'error',
  INTERRUPTED: 'interrupted',
} as const

export type RunOutcome = (typeof RUN_OUTCOME)[keyof typeof RUN_OUTCOME]

export const RUN_OUTCOMES = Object.values(RUN_OUTCOME) as readonly RunOutcome[]
