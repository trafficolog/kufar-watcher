import { describe, expect, it } from 'vitest'

import { createSourceAdapterRegistry } from '../../shared/source-adapter-registry'
import type { SourceAdapter } from '../../shared/source-adapter'

function stub(): SourceAdapter {
  return {
    async fetchPage() {
      return { listings: [], nextCursor: null }
    },
  }
}

describe('createSourceAdapterRegistry', () => {
  it('returns the injected electronics adapter', () => {
    const electronics = stub()
    const realEstate = stub()
    const registry = createSourceAdapterRegistry({ electronics, 'real-estate': realEstate })

    expect(registry.get('electronics')).toBe(electronics)
  })

  it('returns the injected real-estate adapter', () => {
    const electronics = stub()
    const realEstate = stub()
    const registry = createSourceAdapterRegistry({ electronics, 'real-estate': realEstate })

    expect(registry.get('real-estate')).toBe(realEstate)
  })
})
