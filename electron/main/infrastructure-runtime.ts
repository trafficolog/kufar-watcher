import type { BootState } from '../../shared/ipc'
import {
  ensurePostgresContainer,
  waitForPostgresHealthy,
  type DockerPostgresRuntime,
} from './docker-postgres'
import type { InfrastructureBootstrapDependencies } from './infrastructure-bootstrap'
import type { PostgresRuntimeConfig } from './postgres-config'
import { createPrismaMigrationRunner } from './prisma-migrations'

export interface InfrastructureRuntimeOptions {
  runtime: DockerPostgresRuntime
  config: PostgresRuntimeConfig
  applyMigrations?: () => Promise<void>
  startWorker(): void
  publishBootState(state: BootState): void
  sleep?: (ms: number) => Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createInfrastructureBootstrapDependencies(
  options: InfrastructureRuntimeOptions,
): InfrastructureBootstrapDependencies {
  const applyMigrations =
    options.applyMigrations ?? createPrismaMigrationRunner({ databaseUrl: options.config.databaseUrl })

  return {
    pingDocker: async () => {
      await options.runtime.ping()
    },
    ensureDatabaseContainer: async () => {
      await ensurePostgresContainer(options.runtime, options.config.container)
    },
    waitForDatabase: async () => {
      await waitForPostgresHealthy(options.runtime, options.config.container.containerName, {
        timeoutMs: 30_000,
        pollIntervalMs: 1_000,
        sleep: options.sleep ?? sleep,
      })
    },
    applyMigrations,
    startWorker: options.startWorker,
    publishBootState: options.publishBootState,
  }
}
