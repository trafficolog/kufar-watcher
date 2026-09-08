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

function normalizeRealEstatePrice(ad: KufarSearchAd, path: string): KufarNormalizedPrice {
  const rawCurrency = requiredNonEmptyString(ad, 'currency', `${path}.currency`)

  if (rawCurrency === 'USD') {
    const rawPrice = requiredNonEmptyString(ad, 'price_usd', `${path}.price_usd`)
    return {
      priceKind: 'fixed',
      priceAmount: minorUnitsToDecimal(rawPrice, `${path}.price_usd`),
      currency: 'USD',
    }
  }

  if (rawCurrency === 'BYR' || rawCurrency === 'BYN') {
    const rawPrice = requiredNonEmptyString(ad, 'price_byn', `${path}.price_byn`)
    return {
      priceKind: 'fixed',
      priceAmount: minorUnitsToDecimal(rawPrice, `${path}.price_byn`),
      currency: 'BYN',
    }
  }

  invalid(`${path}.currency`, 'Expected USD, BYR, or BYN currency marker')
}

export function normalizeRealEstateSearchPage(body: Uint8Array): SourcePage {
  return normalizeKufarSearchPage(body, {
    fallbackUrl: (adId) => `https://re.kufar.by/vi/${adId}`,
    normalizePrice: normalizeRealEstatePrice,
  })
}
