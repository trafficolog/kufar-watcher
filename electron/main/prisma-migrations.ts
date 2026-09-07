import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

export interface ProcessResult {
  exitCode: number
  stderr: string
}

export type RunProcess = (
  executablePath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<ProcessResult>

export interface PrismaMigrationRunnerOptions {
  databaseUrl: string
  prismaCliPath?: string
  executablePath?: string
  env?: NodeJS.ProcessEnv
  runProcess?: RunProcess
}

const require = createRequire(import.meta.url)

async function runProcess(
  executablePath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executablePath, args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stderr })
    })
  })
}

export function createPrismaMigrationRunner(
  options: PrismaMigrationRunnerOptions,
): () => Promise<void> {
  const prismaCliPath = options.prismaCliPath ?? require.resolve('prisma/build/index.js')
  const executablePath = options.executablePath ?? process.execPath
  const execute = options.runProcess ?? runProcess

  return async () => {
    const result = await execute(executablePath, [prismaCliPath, 'migrate', 'deploy'], {
      ...(options.env ?? process.env),
      DATABASE_URL: options.databaseUrl,
      ELECTRON_RUN_AS_NODE: '1',
    })

    if (result.exitCode === 0) return

    const detail = result.stderr.trim() || `exit code ${result.exitCode}`
    throw new Error(`Prisma migrate deploy failed: ${detail}`)
  }
}
