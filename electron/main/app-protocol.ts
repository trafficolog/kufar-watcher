import { existsSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const APP_SCHEME = 'app'
export const APP_HOST = 'kufar'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !rel.startsWith('\\'))
}

export function resolveRendererPath(publicRoot: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }

  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }

  if (pathname.includes('\0')) return null

  const root = resolve(publicRoot)
  const requested = resolve(root, `.${pathname}`)
  if (!isInside(root, requested)) return null

  if (existsSync(requested) && statSync(requested).isFile()) return requested

  if (extname(pathname) !== '') return null

  const entry = resolve(root, 'index.html')
  return existsSync(entry) && statSync(entry).isFile() ? entry : null
}

export async function registerRendererProtocol(publicRoot: string): Promise<void> {
  const { net, protocol } = await import('electron')

  await protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveRendererPath(publicRoot, request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
