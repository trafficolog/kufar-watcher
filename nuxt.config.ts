import { buildRendererContentSecurityPolicy } from './shared/renderer-csp'

const isDevelopment = process.env.NODE_ENV === 'development'

export default defineNuxtConfig({
  ssr: false,
  modules: ['@pinia/nuxt', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Kufar Monitor',
      meta: [
        {
          'http-equiv': 'Content-Security-Policy',
          content: buildRendererContentSecurityPolicy(isDevelopment),
        },
      ],
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
})
