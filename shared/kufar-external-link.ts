const allowedHosts = new Set(['kufar.by', 'www.kufar.by', 're.kufar.by'])

/** Only listing-result URLs from explicitly supported Kufar web hosts may open outside Electron. */
export function isAllowedKufarListingUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'https:' &&
      allowedHosts.has(url.hostname) &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.pathname.startsWith('/l/')
    )
  } catch {
    return false
  }
}
