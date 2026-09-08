import type { KufarHttpResult } from './kufar-http-client'

export class KufarSourceRequestError extends Error {
  constructor(
    message: string,
    readonly result: Extract<KufarHttpResult, { ok: false }>,
  ) {
    super(message)
    this.name = 'KufarSourceRequestError'
  }
}
