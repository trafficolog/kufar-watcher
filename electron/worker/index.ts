import { startWorkerRuntime } from './runtime'

const parentPort = process.parentPort

if (!parentPort) {
  throw new Error('Utility worker requires an Electron parent port')
}

startWorkerRuntime(parentPort, (code) => {
  setImmediate(() => process.exit(code))
})
