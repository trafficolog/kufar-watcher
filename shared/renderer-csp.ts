const BASE_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
] as const

export function buildRendererContentSecurityPolicy(isDevelopment: boolean): string {
  const script = isDevelopment ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
  // Chromium does not consistently include WebSocket in connect-src 'self'.
  // The wildcard is constrained to the app's loopback host and only in development.
  const connect = isDevelopment ? "connect-src 'self' ws://127.0.0.1:*" : "connect-src 'self'"
  return [
    BASE_DIRECTIVES[0],
    script,
    BASE_DIRECTIVES[1],
    BASE_DIRECTIVES[2],
    BASE_DIRECTIVES[3],
    connect,
    ...BASE_DIRECTIVES.slice(4),
  ].join('; ')
}
