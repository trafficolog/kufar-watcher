import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import { buildKufarListingUrl } from '../../shared/kufar-url'
import type { KufarHttpGetter } from './kufar-electronics-adapter'
import {
  extractKufarEmbeddedState,
  kufarSearchPayloadFromEmbeddedState,
} from './kufar-embedded-search-state'
import type { KufarHttpResult } from './kufar-http-client'
import { KufarSourceRequestError } from './kufar-source-request-error'

export type KufarHtmlPageNormalizer = (body: Uint8Array) => SourcePage

export class KufarHtmlFallbackRequestError extends KufarSourceRequestError {
  constructor(result: Extract<KufarHttpResult, { ok: false }>) {
    super(`Kufar HTML fallback request failed: ${result.code}`, result)
    this.name = 'KufarHtmlFallbackRequestError'
  }
}

export class KufarHtmlFallbackAdapter implements SourceAdapter {
  constructor(
    private readonly httpClient: KufarHttpGetter,
    private readonly normalizePage: KufarHtmlPageNormalizer,
  ) {}

  async fetchPage(request: SourcePageRequest): Promise<SourcePage> {
    const url = new URL(buildKufarListingUrl(request.query))
    url.searchParams.set('size', '30')

    if (request.cursor !== null) {
      url.searchParams.set('cursor', request.cursor)
    }

    const result = await this.httpClient.get(url)
    if (!result.ok) {
      throw new KufarHtmlFallbackRequestError(result)
    }

    const embedded = extractKufarEmbeddedState(result.body)
    const payload = kufarSearchPayloadFromEmbeddedState(embedded.value)
    return this.normalizePage(payload)
  }
}
