import { parseKufarListingUrl } from '../../shared/kufar-url'
import { routeKufarQuery } from '../../shared/kufar-routing'

export interface ValidMonitorUrlPreview {
  state: 'valid'
  category: 'Электроника' | 'Недвижимость'
  region: string
  query: string
}

export function previewMonitorUrl(sourceUrl: string): ValidMonitorUrlPreview {
  const query = parseKufarListingUrl(sourceUrl)
  const adapter = routeKufarQuery(query)

  return {
    state: 'valid',
    category: adapter === 'electronics' ? 'Электроника' : 'Недвижимость',
    region: query.region ?? 'Вся Беларусь',
    query: query.query ?? '—',
  }
}
