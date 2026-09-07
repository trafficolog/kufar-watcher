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
          content:
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://127.0.0.1:3000 ws://127.0.0.1:3000; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        },
      ],
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
})
