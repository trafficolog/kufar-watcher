import type { PrismaClient } from '../../generated/prisma/client'
import {
  createSourceAdapterRegistry,
  type SourceAdapterRegistry,
} from '../../shared/source-adapter-registry'
import type { SourceAdapter } from '../../shared/source-adapter'
import { KufarElectronicsAdapter } from './kufar-electronics-adapter'
import { KufarHtmlFallbackAdapter } from './kufar-html-fallback-adapter'
import { KufarHttpClient, type KufarHttpClientOptions } from './kufar-http-client'
import { normalizeElectronicsSearchPage } from './kufar-electronics-normalizer'
import {
  FileKufarRawResponseJournal,
  type KufarRawResponseJournal,
} from './kufar-raw-response-journal'
import { KufarRealEstateAdapter } from './kufar-realestate-adapter'
import { normalizeRealEstateSearchPage } from './kufar-realestate-normalizer'
import { KufarResilientSource, type SourceDegradationSink } from './kufar-resilient-source'
import { ListingDescriptionCache } from './listing-description-cache'
import type { DescriptionLoader } from './incremental-monitor-run'

export interface WorkerSourceRuntime {
  createRunAdapters(onDegradation: SourceDegradationSink): SourceAdapterRegistry
  descriptionLoader: DescriptionLoader
  close(): Promise<void>
}

export interface WorkerSourceRuntimeOptions {
  prisma: PrismaClient
  rawResponseJournalDir: string
}

type SharedHttpClient = Pick<KufarHttpClient, 'get' | 'close'>
type SharedJournal = Pick<KufarRawResponseJournal, 'record'>

export interface WorkerSourceRuntimeDependencies {
  createJournal(rootDir: string): SharedJournal
  createHttpClient(options: KufarHttpClientOptions): SharedHttpClient
}

const defaultDependencies: WorkerSourceRuntimeDependencies = {
  createJournal(rootDir) {
    return new FileKufarRawResponseJournal({ rootDir })
  },
  createHttpClient(options) {
    return new KufarHttpClient(options)
  },
}

function resilientAdapter(
  primary: SourceAdapter,
  fallback: SourceAdapter,
  onDegradation: SourceDegradationSink,
): SourceAdapter {
  const resilient = new KufarResilientSource(primary, fallback, onDegradation)

  return {
    async fetchPage(request) {
      const result = await resilient.fetchPage(request)
      return result.page
    },
  }
}

export function createWorkerSourceRuntime(
  options: WorkerSourceRuntimeOptions,
  dependencies: WorkerSourceRuntimeDependencies = defaultDependencies,
): WorkerSourceRuntime {
  const journal = dependencies.createJournal(options.rawResponseJournalDir)
  const httpClient = dependencies.createHttpClient({ journal })
  const electronicsPrimary = new KufarElectronicsAdapter(httpClient)
  const electronicsFallback = new KufarHtmlFallbackAdapter(
    httpClient,
    normalizeElectronicsSearchPage,
  )
  const realEstatePrimary = new KufarRealEstateAdapter(httpClient)
  const realEstateFallback = new KufarHtmlFallbackAdapter(httpClient, normalizeRealEstateSearchPage)
  const descriptionLoader = new ListingDescriptionCache(options.prisma, httpClient)
  let closePromise: Promise<void> | null = null

  return {
    createRunAdapters(onDegradation) {
      return createSourceAdapterRegistry({
        electronics: resilientAdapter(electronicsPrimary, electronicsFallback, onDegradation),
        'real-estate': resilientAdapter(realEstatePrimary, realEstateFallback, onDegradation),
      })
    },
    descriptionLoader,
    close() {
      closePromise ??= httpClient.close()
      return closePromise
    },
  }
}
