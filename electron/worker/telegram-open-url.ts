export function isHumanKufarUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.hostname === 'api.kufar.by') return false
  return url.hostname === 'kufar.by' || url.hostname.endsWith('.kufar.by')
}
