import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = readFileSync(new URL('../../nuxt.config.ts', import.meta.url), 'utf8')

describe('renderer CSP source policy', () => {
  it('does not hard-code a renderer development port or introduce a second CSP', () => {
    expect(config).not.toContain('127.0.0.1:3000')
    expect(config.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(config).not.toContain("'unsafe-eval'")
  })

  it('keeps the developer inline Nuxt bootstrap without opening remote script origins', async () => {
    const { buildRendererContentSecurityPolicy } = await import('../../shared/renderer-csp')
    const dev = buildRendererContentSecurityPolicy(true)
    expect(dev).toContain("script-src 'self' 'unsafe-inline'")
    expect(dev).toContain('ws://127.0.0.1:*')
    expect(dev).not.toContain("'unsafe-eval'")
    expect(dev).not.toMatch(/https?:\/\//)
  })

  it('keeps production script sources strict while allowing only same-origin connections', async () => {
    const { buildRendererContentSecurityPolicy } = await import('../../shared/renderer-csp')
    const production = buildRendererContentSecurityPolicy(false)
    expect(production).toContain("script-src 'self'")
    expect(production).not.toContain("'unsafe-inline'")
    expect(production).not.toContain("'unsafe-eval'")
    expect(production).toContain("connect-src 'self'")
    expect(production).toContain("object-src 'none'")
    expect(production).not.toContain('ws://')
  })
})
