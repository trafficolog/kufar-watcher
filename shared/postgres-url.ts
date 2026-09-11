export interface PostgresDatabaseUrlConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export function createPostgresDatabaseUrl(config: PostgresDatabaseUrlConfig): string {
  const url = new URL(`postgresql://${config.host}:${config.port}`)
  url.username = config.user
  url.password = config.password
  url.pathname = `/${config.database}`
  url.searchParams.set('schema', 'public')
  return url.toString()
}
