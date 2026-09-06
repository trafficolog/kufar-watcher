import type { BootState, BootStep, BootStepId, BootStepState } from '../../shared/ipc'

export interface InfrastructureBootstrapDependencies {
  pingDocker(): Promise<void>
  ensureDatabaseContainer(): Promise<void>
  waitForDatabase(): Promise<void>
  applyMigrations(): Promise<void>
  startWorker(): void
  publishBootState(state: BootState): void
}

function createBootState(): BootState {
  return {
    phase: 'starting',
    steps: [
      { id: 'docker', state: 'running', detail: 'Checking Docker daemon' },
      { id: 'database', state: 'pending', detail: 'Waiting for Docker' },
      { id: 'migrations', state: 'pending', detail: 'Waiting for database' },
      { id: 'scheduler', state: 'pending', detail: 'Waiting for migrations' },
      { id: 'telegram', state: 'skipped', detail: 'Telegram is not configured yet' },
    ],
  }
}

function updateStep(
  state: BootState,
  id: BootStepId,
  stepState: BootStepState,
  detail: string,
): BootState {
  const steps = state.steps.map<BootStep>((step) =>
    step.id === id ? { ...step, state: stepState, detail } : step,
  )
  return { ...state, steps }
}

function publish(deps: InfrastructureBootstrapDependencies, state: BootState): BootState {
  deps.publishBootState(state)
  return state
}

function fail(
  deps: InfrastructureBootstrapDependencies,
  state: BootState,
  id: BootStepId,
  errorCode: NonNullable<BootState['errorCode']>,
  detail: string,
): BootState {
  const failed = {
    ...updateStep(state, id, 'error', detail),
    phase: 'error' as const,
    errorCode,
  }
  return publish(deps, failed)
}

export async function runInfrastructureBootstrap(
  deps: InfrastructureBootstrapDependencies,
): Promise<BootState> {
  let state = publish(deps, createBootState())

  try {
    await deps.pingDocker()
  } catch {
    return fail(deps, state, 'docker', 'docker-unavailable', 'Docker daemon is unavailable')
  }

  state = publish(
    deps,
    updateStep(state, 'docker', 'success', 'Docker daemon is available'),
  )
  state = publish(
    deps,
    updateStep(state, 'database', 'running', 'Ensuring PostgreSQL container'),
  )

  try {
    await deps.ensureDatabaseContainer()
    state = publish(
      deps,
      updateStep(state, 'database', 'running', 'Waiting for PostgreSQL healthcheck'),
    )
    await deps.waitForDatabase()
  } catch {
    return fail(deps, state, 'database', 'database-timeout', 'PostgreSQL did not become healthy')
  }

  state = publish(deps, updateStep(state, 'database', 'success', 'PostgreSQL is healthy'))
  state = publish(deps, updateStep(state, 'migrations', 'running', 'Applying database migrations'))

  try {
    await deps.applyMigrations()
  } catch {
    return fail(deps, state, 'migrations', 'migration-failed', 'Database migrations failed')
  }

  state = publish(
    deps,
    updateStep(state, 'migrations', 'success', 'Database migrations applied'),
  )
  state = publish(deps, updateStep(state, 'scheduler', 'running', 'Starting worker'))
  deps.startWorker()
  state = updateStep(state, 'scheduler', 'success', 'Worker started')
  state = { ...state, phase: 'ready' }
  return publish(deps, state)
}
