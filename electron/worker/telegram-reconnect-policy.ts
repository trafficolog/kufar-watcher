export interface TelegramReconnectPolicy {
  nextDelayMs(): number
  reset(): void
}

export function createTelegramReconnectPolicy(): TelegramReconnectPolicy {
  let attempt = 0

  return {
    nextDelayMs(): number {
      const delayMs = Math.min(1_000 * 2 ** attempt, 30_000)
      attempt += 1
      return delayMs
    },
    reset(): void {
      attempt = 0
    },
  }
}
