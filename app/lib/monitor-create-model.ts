import { KufarRoutingError, routeKufarQuery } from '../../shared/kufar-routing'
import { KufarUrlParseError, parseKufarListingUrl } from '../../shared/kufar-url'

const AUTO_UNSUPPORTED_MESSAGE =
  'Авто пока не поддерживается. Вставьте ссылку из поддерживаемой категории Kufar.'
const CATEGORY_UNSUPPORTED_MESSAGE = 'Эта категория Kufar пока не поддерживается.'
const FOREIGN_HOST_MESSAGE = 'Нужна ссылка с kufar.by.'
const INVALID_LISTING_MESSAGE = 'Не удалось распознать ссылку на список объявлений Kufar.'

export interface ValidMonitorUrlPreview {
  state: 'valid'
  category: 'Электроника' | 'Недвижимость'
  region: string
  query: string
}

export interface MonitorUrlPreviewError {
  state: 'error'
  message: string
}

export type MonitorUrlPreview = ValidMonitorUrlPreview | MonitorUrlPreviewError

export function previewMonitorUrl(sourceUrl: string): MonitorUrlPreview {
  try {
    const query = parseKufarListingUrl(sourceUrl)
    const adapter = routeKufarQuery(query)

    return {
      state: 'valid',
      category: adapter === 'electronics' ? 'Электроника' : 'Недвижимость',
      region: query.region ?? 'Вся Беларусь',
      query: query.query ?? '—',
    }
  } catch (error) {
    if (error instanceof KufarRoutingError) {
      return {
        state: 'error',
        message:
          error.code === 'out-of-scope-category'
            ? AUTO_UNSUPPORTED_MESSAGE
            : CATEGORY_UNSUPPORTED_MESSAGE,
      }
    }

    if (error instanceof KufarUrlParseError) {
      return {
        state: 'error',
        message: error.code === 'foreign-host' ? FOREIGN_HOST_MESSAGE : INVALID_LISTING_MESSAGE,
      }
    }

    throw error
  }
}

export function parseMonitorTerms(raw: string): string[] {
  return raw
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
}
