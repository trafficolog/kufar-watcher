import type { SourcePage } from '../../shared/source-adapter'
import {
  invalid,
  minorUnitsToDecimal,
  normalizeKufarSearchPage,
  requiredNonEmptyString,
  type KufarNormalizedPrice,
  type KufarSearchAd,
} from './kufar-search-normalizer'

export {
  KufarNormalizationError,
  type KufarNormalizationErrorCode,
} from './kufar-search-normalizer'

function normalizeElectronicsPrice(ad: KufarSearchAd, path: string): KufarNormalizedPrice {
  const priceByn = requiredNonEmptyString(ad, 'price_byn', `${path}.price_byn`)
  const rawCurrency = requiredNonEmptyString(ad, 'currency', `${path}.currency`)

  if (!/^\d+$/.test(priceByn)) invalid(`${path}.price_byn`, 'Expected digit-only BYN minor units')
  if (rawCurrency !== 'BYR' && rawCurrency !== 'BYN') {
    invalid(`${path}.currency`, 'Expected BYR or BYN currency marker')
  }

  const negotiable = priceByn === '0'
  return {
    priceKind: negotiable ? 'negotiable' : 'fixed',
    priceAmount: negotiable ? null : minorUnitsToDecimal(priceByn, `${path}.price_byn`),
    currency: negotiable ? null : 'BYN',
  }
}

export function normalizeElectronicsSearchPage(body: Uint8Array): SourcePage {
  return normalizeKufarSearchPage(body, {
    fallbackUrl: (adId) => `https://www.kufar.by/item/${adId}`,
    normalizePrice: normalizeElectronicsPrice,
  })
}
