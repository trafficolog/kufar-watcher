import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import { buildKufarApiUrl } from '../../shared/kufar-url'
import type { KufarHttpClient, KufarHttpResult } from './kufar-http-client'
import { normalizeRealEstateSearchPage } from './kufar-realestate-normalizer'

export type KufarRealEstateHttpGetter = Pick<KufarHttpClient, 'get'>

export class KufarRealEstateAdapterRequestError extends Error {
  constructor(readonly result: Extract<KufarHttpResult, { ok: false }>) {
    super(`Kufar real-estate request failed: ${result.code}`)
    this.name = 'KufarRealEstateAdapterRequestError'
  }
}

export class KufarRealEstateAdapter implements SourceAdapter {
  constructor(private readonly httpClient: KufarRealEstateHttpGetter) {}

  async fetchPage(request: SourcePageRequest): Promise<SourcePage> {
    const url = new URL(buildKufarApiUrl(request.query))
    url.searchParams.set('size', '30')

    if (request.cursor !== null) {
      url.searchParams.set('cursor', request.cursor)
    }

    const result = await this.httpClient.get(url)
    if (!result.ok) {
      throw new KufarRealEstateAdapterRequestError(result)
    }

    return normalizeRealEstateSearchPage(result.body)
  }
}
