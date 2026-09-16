import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executableTypes = new Set([
  '',
  'module',
  'importmap',
  'text/javascript',
  'application/javascript',
])

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return htmlFiles(path)
    return entry.isFile() && entry.name.endsWith('.html') ? [path] : []
  })
}

export function finalizeRendererHtml(html) {
  const metaPattern = /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'])[^>]*>/gi
  const metas = [...html.matchAll(metaPattern)]
  if (metas.length !== 1) throw new Error(`Expected one renderer CSP meta, found ${metas.length}`)
  const meta = metas[0][0]
  const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(meta)
  if (!content) throw new Error('Renderer CSP meta is missing a content attribute')
  const policy = content[2]
  if (!/(?:^|;\s*)script-src\s+'self'(?=;|$)/.test(policy)) {
    throw new Error('Expected strict production script-src self before finalization')
  }

  const hashes = new Set()
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  for (const [, attributes, body] of html.matchAll(scriptPattern)) {
    if (/\bsrc\s*=/.test(attributes) || !body.trim()) continue
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]?.toLowerCase() ?? ''
    if (!executableTypes.has(type)) continue
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }

  const nextPolicy = policy.replace(
    /(^|;\s*)script-src\s+'self'(?=;|$)/,
    (_, prefix) => `${prefix}script-src 'self'${hashes.size ? ` ${[...hashes].join(' ')}` : ''}`,
  )
  return html.replace(
    meta,
    meta.replace(content[0], `content=${content[1]}${nextPolicy}${content[1]}`),
  )
}

export function finalizeRendererDirectory(root) {
  const files = htmlFiles(root)
  if (files.length === 0) throw new Error(`No generated renderer HTML found in ${root}`)
  for (const path of files) {
    const original = readFileSync(path, 'utf8')
    writeFileSync(path, finalizeRendererHtml(original), 'utf8')
  }
  return files.length
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const root = resolve(process.argv[2] ?? '.output/public')
  console.log(`Finalized CSP for ${finalizeRendererDirectory(root)} renderer HTML files`)
}
