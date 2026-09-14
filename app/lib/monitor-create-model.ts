import { KufarRoutingError, routeKufarQuery } from '../../shared/kufar-routing'
import { KufarUrlParseError, parseKufarListingUrl } from '../../shared/kufar-url'

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
      if (error.code === 'out-of-scope-category') {
        return {
          state: 'error',
          message: 'Авто пока не поддерживается. Вставьте ссылку из поддерживаемой категории Kufar.',
        }
      }

      return {
        state: 'error',
        message: 'Эта категория Kufar пока не поддерживается.',
      }
    }

    if (error instanceof KufarUrlParseError) {
      if (error.code === 'foreign-host') {
        return {
          state: 'error',
          message: 'Нужна ссылка с kufar.by.',
        }
      }

      return {
        state: 'error',
        message: 'Не удалось распознать ссылку на список объявлений Kufar.',
      }
    }

    throw error
  }
}
