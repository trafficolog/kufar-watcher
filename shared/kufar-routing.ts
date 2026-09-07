import type { CanonicalQuery } from './canonical-query'

export type KufarAdapterKind = 'electronics' | 'real-estate'

export type KufarRoutingErrorCode = 'out-of-scope-category' | 'unknown-category'

export class KufarRoutingError extends Error {
  readonly code: KufarRoutingErrorCode

  constructor(code: KufarRoutingErrorCode, message: string) {
    super(message)
    this.name = 'KufarRoutingError'
    this.code = code
  }
}

export function routeKufarQuery(query: CanonicalQuery): KufarAdapterKind {
  if (query.host === 'auto.kufar.by') {
    throw new KufarRoutingError(
      'out-of-scope-category',
      'Auto listings are outside the supported Kufar Monitor scope',
    )
  }

  if (
    (query.host === 'www.kufar.by' || query.host === 'kufar.by') &&
    query.category === 'igry-i-pristavki'
  ) {
    return 'electronics'
  }

  if (query.host === 're.kufar.by' && query.category === 'kvartiru') {
    return 'real-estate'
  }

  throw new KufarRoutingError(
    'unknown-category',
    `No supported Kufar adapter mapping for host "${query.host}" and category "${query.category ?? ''}"`,
  )
}
