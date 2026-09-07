import type { ContainerHealth, DockerPostgresRuntime } from './docker-postgres'

interface DockerodeError extends Error {
  statusCode?: number
}

interface DockerodeContainerInfo {
  State?: {
    Running?: boolean
    Health?: {
      Status?: string
    }
  }
}

interface DockerodeContainerLike {
  inspect(): Promise<DockerodeContainerInfo>
  start(): Promise<unknown>
}

interface DockerodeImageLike {
  inspect(): Promise<unknown>
}

interface DockerodeModemLike {
  followProgress(stream: unknown, callback: (error?: Error | null) => void): void
}

export interface DockerodeLike {
  ping(): Promise<unknown>
  getContainer(name: string): DockerodeContainerLike
  getImage(image: string): DockerodeImageLike
  createVolume(options: { Name: string }): Promise<unknown>
  createContainer(options: Record<string, unknown>): Promise<unknown>
  pull?(image: string): Promise<unknown>
  modem?: DockerodeModemLike
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as DockerodeError).statusCode === 404
}

function normalizeHealth(status: string | undefined): ContainerHealth {
  if (status === 'healthy' || status === 'starting' || status === 'unhealthy') return status
  return 'none'
}

async function ensureImageAvailable(docker: DockerodeLike, image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect()
    return
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  if (!docker.pull || !docker.modem) {
    throw new Error(`Docker image ${image} is missing and cannot be pulled`)
  }

  const stream = await docker.pull(image)
  await new Promise<void>((resolve, reject) => {
    docker.modem?.followProgress(stream, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export function createDockerodePostgresRuntime(docker: DockerodeLike): DockerPostgresRuntime {
  return {
    async ping(): Promise<void> {
      await docker.ping()
    },
    async inspectContainer(name): Promise<{ running: boolean } | null> {
      try {
        const info = await docker.getContainer(name).inspect()
        return { running: info.State?.Running === true }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    async ensureImage(image): Promise<void> {
      await ensureImageAvailable(docker, image)
    },
    async createContainer(config): Promise<void> {
      await docker.createVolume({ Name: config.volumeName })
      await docker.createContainer({
        name: config.containerName,
        Image: config.image,
        Env: [
          `POSTGRES_USER=${config.user}`,
          `POSTGRES_PASSWORD=${config.password}`,
          `POSTGRES_DB=${config.database}`,
        ],
        ExposedPorts: { '5432/tcp': {} },
        Volumes: { '/var/lib/postgresql/data': {} },
        HostConfig: {
          Binds: [`${config.volumeName}:/var/lib/postgresql/data:rw`],
          PortBindings: {
            '5432/tcp': [{ HostIp: config.host, HostPort: String(config.port) }],
          },
        },
        Healthcheck: {
          Test: ['CMD-SHELL', 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
          Interval: 2_000_000_000,
          Timeout: 3_000_000_000,
          Retries: 15,
          StartPeriod: 5_000_000_000,
        },
      })
    },
    async startContainer(name): Promise<void> {
      await docker.getContainer(name).start()
    },
    async inspectHealth(name): Promise<ContainerHealth> {
      const info = await docker.getContainer(name).inspect()
      return normalizeHealth(info.State?.Health?.Status)
    },
  }
}
