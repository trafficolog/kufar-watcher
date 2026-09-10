import { readWorkerConfig } from './config'
import { startWorkerRuntime } from './runtime'
import { createWorkerApplication, formatWorkerError } from './worker-application'

const config = readWorkerConfig(process.argv, process.env)
const parentPort = process.parentPort

if (!parentPort) {
  throw new Error('Utility worker requires an Electron parent port')
}

const application = createWorkerApplication(config, (event) => parentPort.postMessage(event))

void startWorkerRuntime(parentPort, application, (code) => {
  setImmediate(() => process.exit(code))
}).catch((error) => {
  parentPort.postMessage({
    type: 'journal',
    level: 'error',
    message: formatWorkerError(error),
  })
  setImmediate(() => process.exit(1))
})
