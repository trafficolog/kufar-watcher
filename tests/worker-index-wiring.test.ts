import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('utility worker application wiring', () => {
  it('runs the composed worker application and reports startup failures through the parent port', async () => {
    const source = await readFile(new URL('../electron/worker/index.ts', import.meta.url), 'utf8')

    expect(source).toContain(
      "import { createWorkerApplication, formatWorkerError } from './worker-application'",
    )
    expect(source).toContain('const config = readWorkerConfig(process.argv, process.env)')
    expect(source).toContain(
      'const application = createWorkerApplication(config, (event) => parentPort.postMessage(event))',
    )
    expect(source).toContain('void startWorkerRuntime(parentPort, application, (code) => {')
    expect(source).toContain('message: formatWorkerError(error)')
    expect(source).toContain('setImmediate(() => process.exit(1))')
    expect(source).not.toContain('start: async () => undefined')
    expect(source).not.toContain("postMessage({ type: 'ready'")
  })
})
