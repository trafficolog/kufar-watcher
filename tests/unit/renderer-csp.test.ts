import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildRendererContentSecurityPolicy } from '../../shared/renderer-csp'

const config = readFileSync(new URL('../../nuxt.config.ts', import.meta.url), 'utf8')

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name} `))
}

describe('renderer CSP source policy', () => {
  it('does not hard-code a renderer development port or introduce a second CSP', () => {
    expect(config).not.toContain('127.0.0.1:3000')
    expect(config.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(config).not.toContain("'unsafe-eval'")
  })

  it('allows dev Nuxt bootstrap and loopback HMR without remote scripts', () => {
    const dev = buildRendererContentSecurityPolicy(true)
    expect(directive(dev, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
    expect(directive(dev, 'connect-src')).toBe("connect-src 'self' ws://127.0.0.1:*")
    expect(dev).not.toContain("'unsafe-eval'")
    expect(dev).not.toMatch(/https?:\/\//)
  })

  it('keeps production script sources strict with same-origin connections', () => {
    const production = buildRendererContentSecurityPolicy(false)
    expect(directive(production, 'script-src')).toBe("script-src 'self'")
    expect(directive(production, 'connect-src')).toBe("connect-src 'self'")
    expect(directive(production, 'object-src')).toBe("object-src 'none'")
    expect(directive(production, 'font-src')).toBe("font-src 'self'")
    expect(production).not.toContain("'unsafe-eval'")
    expect(production).not.toContain('ws://')
  })
})
