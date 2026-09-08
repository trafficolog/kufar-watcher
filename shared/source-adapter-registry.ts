import type { KufarAdapterKind } from './kufar-routing'
import type { SourceAdapter } from './source-adapter'

export interface SourceAdapterRegistry {
  get(kind: KufarAdapterKind): SourceAdapter
}

export function createSourceAdapterRegistry(
  adapters: Record<KufarAdapterKind, SourceAdapter>,
): SourceAdapterRegistry {
  return {
    get(kind) {
      return adapters[kind]
    },
  }
}
