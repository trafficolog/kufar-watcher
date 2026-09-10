export function workerProcessEnvironment(
  parentEnv: NodeJS.ProcessEnv,
  databaseUrl: string,
): NodeJS.ProcessEnv {
  if (!databaseUrl) {
    throw new Error('Worker database URL is required')
  }

  return {
    ...parentEnv,
    DATABASE_URL: databaseUrl,
  }
}
