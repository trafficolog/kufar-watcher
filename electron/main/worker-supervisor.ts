export type RestartDecision = 'restart' | 'fatal'

export interface RestartPolicy {
  recordCrash(): RestartDecision
  reset(): void
}

export function createRestartPolicy(maxRestarts: number): RestartPolicy {
  let crashes = 0

  return {
    recordCrash(): RestartDecision {
      crashes += 1
      return crashes <= maxRestarts ? 'restart' : 'fatal'
    },
    reset(): void {
      crashes = 0
    },
  }
}
