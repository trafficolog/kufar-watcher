export type TelegramSendFailureKind = 'transient' | 'permanent'

export class TelegramSendFailure extends Error {
  constructor(readonly kind: TelegramSendFailureKind) {
    super('Telegram send failed')
    this.name = 'TelegramSendFailure'
  }
}
