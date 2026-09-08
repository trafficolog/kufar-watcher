import type { SourcePage } from '../../shared/source-adapter'
import {
  invalid,
  isRecord,
  minorUnitsToDecimal,
  missing,
  normalizeKufarSearchPage,
  requiredNonEmptyString,
  type KufarNormalizedPrice,
  type KufarSearchAd,
} from './kufar-search-normalizer'

export {
  KufarNormalizationError,
  type KufarNormalizationErrorCode,
} from './kufar-search-normalizer'

function normalizeRealEstateEuroPrice(ad: KufarSearchAd, path: string): KufarNormalizedPrice {
  const calculator = ad.calculator
  if (calculator === undefined) missing(`${path}.calculator`)
  if (!Array.isArray(calculator)) invalid(`${path}.calculator`, 'Expected calculator array')

  const entry = calculator.find((value) => isRecord(value) && value.currency === 'EUR')
  if (!isRecord(entry)) missing(`${path}.calculator[EUR]`)

  const pricePath = `${path}.calculator[EUR].price`
  const rawPrice = requiredNonEmptyString(entry, 'price', pricePath)

  return {
    priceKind: 'fixed',
    priceAmount: minorUnitsToDecimal(rawPrice, pricePath),
    currency: 'EUR',
  }
}

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

  if (rawCurrency === 'EUR') {
    return normalizeRealEstateEuroPrice(ad, path)
  }

  invalid(`${path}.currency`, 'Expected USD, EUR, BYR, or BYN currency marker')
}

export function normalizeRealEstateSearchPage(body: Uint8Array): SourcePage {
  return normalizeKufarSearchPage(body, {
    fallbackUrl: (adId) => `https://re.kufar.by/vi/${adId}`,
    normalizePrice: normalizeRealEstatePrice,
  })
}
