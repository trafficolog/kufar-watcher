import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRendererPath } from '../electron/main/app-protocol'

const root = join(process.cwd(), '.tmp-protocol-test')

beforeEach(() => {
  mkdirSync(join(root, '_nuxt'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html>')
  writeFileSync(join(root, '_nuxt', 'app.js'), 'export {}')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('resolveRendererPath', () => {
  it('serves the SPA entry for the origin root', () => {
    expect(resolveRendererPath(root, 'app://kufar/')).toBe(join(root, 'index.html'))
  })

  it('serves an existing generated asset directly', () => {
    expect(resolveRendererPath(root, 'app://kufar/_nuxt/app.js')).toBe(join(root, '_nuxt', 'app.js'))
  })

  it.each(['/monitors', '/settings'])('falls back to the SPA entry for route %s', (route) => {
    expect(resolveRendererPath(root, `app://kufar${route}`)).toBe(join(root, 'index.html'))
  })

  it('returns null for a missing asset-like path', () => {
    expect(resolveRendererPath(root, 'app://kufar/_nuxt/missing.js')).toBeNull()
  })

  it('rejects requests for another host', () => {
    expect(resolveRendererPath(root, 'app://evil/monitors')).toBeNull()
  })

  it('keeps the settings fragment out of filesystem resolution', () => {
    expect(resolveRendererPath(root, 'app://kufar/settings#seller-blacklist')).toBe(
      join(root, 'index.html'),
    )
  })

  it('does not allow encoded parent traversal outside the renderer root', () => {
    expect(resolveRendererPath(root, 'app://kufar/..%2Fsecret.txt')).toBeNull()
  })
})
