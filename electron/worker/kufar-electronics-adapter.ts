import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import { buildKufarApiUrl } from '../../shared/kufar-url'
import type { KufarHttpClient, KufarHttpResult } from './kufar-http-client'
import { normalizeElectronicsSearchPage } from './kufar-electronics-normalizer'
import { KufarSourceRequestError } from './kufar-source-request-error'

export type KufarHttpGetter = Pick<KufarHttpClient, 'get'>

export class KufarAdapterRequestError extends KufarSourceRequestError {
  constructor(result: Extract<KufarHttpResult, { ok: false }>) {
    super(`Kufar electronics request failed: ${result.code}`, result)
    this.name = 'KufarAdapterRequestError'
  }
}

export class KufarElectronicsAdapter implements SourceAdapter {
  constructor(private readonly httpClient: KufarHttpGetter) {}

  async fetchPage(request: SourcePageRequest): Promise<SourcePage> {
    const url = new URL(buildKufarApiUrl(request.query))
    url.searchParams.set('size', '30')

    if (request.cursor !== null) {
      url.searchParams.set('cursor', request.cursor)
    }

    const result = await this.httpClient.get(url)
    if (!result.ok) {
      throw new KufarAdapterRequestError(result)
    }

    return normalizeElectronicsSearchPage(result.body)
  }
}
