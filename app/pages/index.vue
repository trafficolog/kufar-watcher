<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { TelegramDesktopState } from '../../shared/telegram'
import { useDesktopApi } from '../composables/use-desktop-api'

const telegramState = ref<TelegramDesktopState | null>(null)
let monitorRequest = 0
let unsubscribeMonitors: (() => void) | undefined
let unsubscribeTelegram: (() => void) | undefined

onMounted(() => {
  const api = useDesktopApi()

  unsubscribeMonitors = api.monitors.onChanged(() => {
    void refreshMonitors()
  })
  unsubscribeTelegram = api.telegram.onState((next) => {
    telegramState.value = next
  })

  void refreshMonitors()
  void api.telegram
    .getState()
    .then((next) => {
      telegramState.value = next
    })
    .catch(() => {
      telegramState.value = null
    })

  async function refreshMonitors(): Promise<void> {
    const request = ++monitorRequest
    try {
      const monitors = await api.monitors.list()
      if (request !== monitorRequest) return
      if (monitors.length > 0) await navigateTo('/monitors')
    } catch {
      return
    }
  }
})

onUnmounted(() => {
  unsubscribeMonitors?.()
  unsubscribeTelegram?.()
})
</script>

<template>
  <main class="route-check">
    <p class="eyebrow">Kufar Monitor</p>
    <h1>Toolchain ready</h1>
    <p>
      Минимальный renderer для проверки Electron + Nuxt. Полный интерфейс появится в своих
      карточках.
    </p>
    <nav aria-label="Проверочные маршруты">
      <NuxtLink to="/monitors">Мониторы</NuxtLink>
      <NuxtLink to="/settings#seller-blacklist">Настройки · продавцы</NuxtLink>
    </nav>
  </main>
</template>
