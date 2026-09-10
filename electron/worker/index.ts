import { startWorkerRuntime } from './runtime'
import { readWorkerConfig } from './config'

const workerConfig = readWorkerConfig(process.argv)
// Traversal ownership will consume this directory when it constructs the HTTP client journal.
void workerConfig.rawResponseJournalDir

const parentPort = process.parentPort

if (!parentPort) {
  throw new Error('Utility worker requires an Electron parent port')
}

void startWorkerRuntime(
  parentPort,
  {
    start: async () => undefined,
    stop: async () => undefined,
  },
  (code) => {
    setImmediate(() => process.exit(code))
  },
)
