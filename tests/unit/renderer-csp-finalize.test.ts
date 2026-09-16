import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const paths: string[] = []
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

function hash(body: string): string {
  return `'sha256-${createHash('sha256').update(body).digest('base64')}'`
}

function finalize(html: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kufar-renderer-csp-'))
  paths.push(dir)
  const filename = join(dir, 'index.html')
  writeFileSync(filename, html)
  execFileSync(process.execPath, ['scripts/finalize-renderer-csp.mjs', dir], { cwd: process.cwd() })
  return readFileSync(filename, 'utf8')
}

const meta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'">`

describe('production renderer CSP finalization', () => {
  it('hashes importmap and changing Nuxt bootstrap instead of allowing every inline script', () => {
    const importmap = '{"imports":{"#entry":"/_nuxt/entry.js"}}'
    const bootstrap = 'window.__NUXT__={};window.__NUXT__.config={app:{buildId:"unique-build-42"}}'
    const json = '[{"data":"not executable"}]'
    const html = `<html><head>${meta}<script type="importmap">${importmap}</script></head><body><script>${bootstrap}</script><script type="application/json">${json}</script><script type="module" src="/_nuxt/entry.js"></script></body></html>`
    const result = finalize(html)
    expect(result).toContain(`script-src 'self' ${hash(importmap)} ${hash(bootstrap)}`)
    expect(result).not.toContain(hash(json))
    expect(result).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(result).toContain("object-src 'none'")
    expect(result).toContain(bootstrap)
    expect(result).toContain(importmap)
  })

  it('rejects HTML with no CSP rather than silently producing an unprotected renderer', () => {
    expect(() => finalize('<html><script>alert(1)</script></html>')).toThrow()
  })

  it('derives different hashes when the Nuxt build ID changes', () => {
    const first = finalize(`<html><head>${meta}</head><body><script>window.__NUXT__={buildId:'a'}</script></body></html>`)
    const second = finalize(`<html><head>${meta}</head><body><script>window.__NUXT__={buildId:'b'}</script></body></html>`)
    expect(first).toContain(hash("window.__NUXT__={buildId:'a'}"))
    expect(second).toContain(hash("window.__NUXT__={buildId:'b'}"))
    expect(first).not.toContain(hash("window.__NUXT__={buildId:'b'}"))
  })
})
