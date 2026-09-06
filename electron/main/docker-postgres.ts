export interface PostgresContainerConfig {
  image: string
  containerName: string
  volumeName: string
  host: string
  port: number
  user: string
  password: string
  database: string
}

export type ContainerHealth = 'healthy' | 'starting' | 'unhealthy' | 'none'

export interface DockerPostgresRuntime {
  ping(): Promise<void>
  inspectContainer(name: string): Promise<{ running: boolean } | null>
  ensureImage(image: string): Promise<void>
  createContainer(config: PostgresContainerConfig): Promise<void>
  startContainer(name: string): Promise<void>
  inspectHealth(name: string): Promise<ContainerHealth>
}

export interface HealthWaitOptions {
  timeoutMs: number
  pollIntervalMs: number
  sleep(ms: number): Promise<void>
}

export async function ensurePostgresContainer(
  runtime: DockerPostgresRuntime,
  config: PostgresContainerConfig,
): Promise<void> {
  const existing = await runtime.inspectContainer(config.containerName)

  if (existing?.running) return

  if (existing) {
    await runtime.startContainer(config.containerName)
    return
  }

  await runtime.ensureImage(config.image)
  await runtime.createContainer(config)
  await runtime.startContainer(config.containerName)
}

export async function waitForPostgresHealthy(
  runtime: DockerPostgresRuntime,
  containerName: string,
  options: HealthWaitOptions,
): Promise<void> {
  const pollCount = Math.floor(options.timeoutMs / options.pollIntervalMs) + 1

  for (let attempt = 0; attempt < pollCount; attempt += 1) {
    if ((await runtime.inspectHealth(containerName)) === 'healthy') return
    if (attempt < pollCount - 1) await options.sleep(options.pollIntervalMs)
  }

  throw new Error('PostgreSQL healthcheck timed out')
}
