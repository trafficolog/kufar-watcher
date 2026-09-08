import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import { KufarEmbeddedStateError } from './kufar-embedded-search-state'
import { KufarNormalizationError } from './kufar-search-normalizer'
import { KufarSourceRequestError } from './kufar-source-request-error'

export type SourceChannel = 'primary' | 'html-fallback'

export interface SourceFetchResult {
  page: SourcePage
  channel: SourceChannel
}

export interface ResilientSource {
  fetchPage(request: SourcePageRequest): Promise<SourceFetchResult>
}

export interface SourceDegradationEvent {
  kind: 'source-degraded'
  channel: 'html-fallback'
  primaryFailureCode: 'network' | 'timeout' | 'http-5xx'
  primaryStatus: number | null
}

export type SourceDegradationSink = (
  event: SourceDegradationEvent,
) => void | Promise<void>

export type SourceFailureAction = 'fail-run' | 'pause-required'
export type SourceFailureStage = 'primary' | 'html-fallback' | 'degradation-event'

export class KufarResilientSourceError extends Error {
  constructor(
    readonly action: SourceFailureAction,
    readonly stage: SourceFailureStage,
    readonly primaryCause: unknown,
    readonly fallbackCause?: unknown,
  ) {
    super(`Kufar resilient source requires ${action} at ${stage}`)
    this.name = 'KufarResilientSourceError'
  }
}

function isFallbackEligible(
  error: KufarSourceRequestError,
): error is KufarSourceRequestError & {
  result: KufarSourceRequestError['result'] & {
    code: SourceDegradationEvent['primaryFailureCode']
  }
} {
  return (
    error.result.code === 'network' ||
    error.result.code === 'timeout' ||
    error.result.code === 'http-5xx'
  )
}

export class KufarResilientSource implements ResilientSource {
  constructor(
    private readonly primary: SourceAdapter,
    private readonly fallback: SourceAdapter,
    private readonly onDegradation: SourceDegradationSink,
  ) {}

  async fetchPage(request: SourcePageRequest): Promise<SourceFetchResult> {
    let primaryError: KufarSourceRequestError

    try {
      const page = await this.primary.fetchPage(request)
      return { page, channel: 'primary' }
    } catch (error) {
      if (error instanceof KufarNormalizationError) {
        throw new KufarResilientSourceError('pause-required', 'primary', error)
      }
      if (!(error instanceof KufarSourceRequestError) || !isFallbackEligible(error)) {
        throw error
      }
      primaryError = error
    }

    let page: SourcePage
    try {
      page = await this.fallback.fetchPage(request)
    } catch (error) {
      const action =
        error instanceof KufarEmbeddedStateError || error instanceof KufarNormalizationError
          ? 'pause-required'
          : 'fail-run'
      throw new KufarResilientSourceError(action, 'html-fallback', primaryError, error)
    }

    const event: SourceDegradationEvent = {
      kind: 'source-degraded',
      channel: 'html-fallback',
      primaryFailureCode: primaryError.result.code,
      primaryStatus: primaryError.result.status,
    }

    try {
      await this.onDegradation(event)
    } catch (error) {
      throw new KufarResilientSourceError(
        'fail-run',
        'degradation-event',
        primaryError,
        error,
      )
    }

    return { page, channel: 'html-fallback' }
  }
}
