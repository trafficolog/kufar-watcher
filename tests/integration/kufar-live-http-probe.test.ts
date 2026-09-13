import { afterAll, describe, expect, it } from 'vitest'

import { normalizeElectronicsSearchPage } from '../../electron/worker/kufar-electronics-normalizer'
import {
  extractKufarEmbeddedState,
  type EmbeddedState,
} from '../../electron/worker/kufar-embedded-search-state'
import { KufarHtmlFallbackAdapter } from '../../electron/worker/kufar-html-fallback-adapter'
import {
  KUFAR_HTTP_DEFAULTS,
  KufarHttpClient,
  type KufarHttpResult,
} from '../../electron/worker/kufar-http-client'
import { parseKufarListingUrl } from '../../shared/kufar-url'

const integration = process.env.KUFAR_LIVE_HTTP_PROBE === '1' ? describe : describe.skip
const listingUrl = 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5'
const maxPages = 100

interface PaginationEntrySummary {
  label: string | null
  tokenKind: string
}

interface ResponseEvidence {
  status: number | null
  attempts: number
  scriptId: EmbeddedState['scriptId'] | null
  pagination: PaginationEntrySummary[] | null
  failureCode: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function paginationSummary(value: unknown): PaginationEntrySummary[] | null {
  if (!isRecord(value)) return null
  if (!isRecord(value.props)) return null
  if (!isRecord(value.props.initialState)) return null
  if (!isRecord(value.props.initialState.listing)) return null

  const pagination = value.props.initialState.listing.pagination
  if (!Array.isArray(pagination)) return null

  return pagination.map((entry) => {
    if (!isRecord(entry)) return { label: null, tokenKind: typeof entry }

    return {
      label: typeof entry.label === 'string' ? entry.label : null,
      tokenKind: entry.token === null ? 'null' : typeof entry.token,
    }
  })
}

integration('live Kufar production HTTP client probe', () => {
  const httpClient = new KufarHttpClient()

  afterAll(async () => {
    await httpClient.close()
  })

  it(
    'records HTML embedded-state and terminal pagination evidence without spoofing',
    async () => {
      const query = parseKufarListingUrl(listingUrl)
      let evidence: ResponseEvidence | null = null

      const getter = {
        async get(url: string | URL): Promise<KufarHttpResult> {
          const result = await httpClient.get(url)

          if (!result.ok) {
            evidence = {
              status: result.status,
              attempts: result.attempts,
              scriptId: null,
              pagination: null,
              failureCode: result.code,
            }
            console.log(
              `KUFAR_LIVE_PROBE ${JSON.stringify({
                event: 'http-failure',
                status: result.status,
                attempts: result.attempts,
                code: result.code,
              })}`,
            )
            return result
          }

          const embedded = extractKufarEmbeddedState(result.body)
          evidence = {
            status: result.status,
            attempts: result.attempts,
            scriptId: embedded.scriptId,
            pagination: paginationSummary(embedded.value),
            failureCode: null,
          }
          return result
        },
      }

      const adapter = new KufarHtmlFallbackAdapter(getter, normalizeElectronicsSearchPage)
      let cursor: string | null = null
      let terminalPage: number | null = null

      console.log(
        `KUFAR_LIVE_PROBE ${JSON.stringify({
          event: 'start',
          userAgent: KUFAR_HTTP_DEFAULTS.userAgent,
          listing: 'electronics-minsk-ps5',
          maxPages,
        })}`,
      )

      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
        const page = await adapter.fetchPage({ query, cursor })
        expect(evidence).not.toBeNull()

        console.log(
          `KUFAR_LIVE_PROBE ${JSON.stringify({
            event: 'page',
            page: pageNumber,
            status: evidence?.status,
            attempts: evidence?.attempts,
            scriptId: evidence?.scriptId,
            listings: page.listings.length,
            nextCursor: page.nextCursor === null ? 'null' : 'string',
            pagination: evidence?.pagination,
          })}`,
        )

        if (page.nextCursor === null) {
          terminalPage = pageNumber
          console.log(
            `KUFAR_LIVE_PROBE ${JSON.stringify({
              event: 'terminal',
              page: pageNumber,
              status: evidence?.status,
              scriptId: evidence?.scriptId,
              listings: page.listings.length,
              pagination: evidence?.pagination,
            })}`,
          )
          break
        }

        cursor = page.nextCursor
      }

      expect(terminalPage, `No terminal page reached within ${maxPages} bounded requests`).not.toBeNull()
    },
    12 * 60 * 1000,
  )
})
