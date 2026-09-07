<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useDesktopApi } from './composables/use-desktop-api'
import AppBootScreen from './components/AppBootScreen.vue'
import {
  createBootScreenController,
  type BootScreenController,
  type BootScreenSnapshot,
} from './lib/boot-screen-controller'
import type { BootUiPlatform } from './lib/boot-screen-model'

const snapshot = ref<BootScreenSnapshot>({ view: 'pending' })
let controller: BootScreenController | undefined

function bootPlatform(): BootUiPlatform {
  const userAgent = navigator.userAgent
  if (/Windows/i.test(userAgent)) return 'win32'
  if (/Linux|X11/i.test(userAgent) && !/Android/i.test(userAgent)) return 'linux'
  return 'other'
}

onMounted(() => {
  controller = createBootScreenController({
    system: useDesktopApi().system,
    platform: bootPlatform(),
    delayMs: 150,
    schedule: (run, delayMs) => window.setTimeout(run, delayMs),
    cancel: (handle) => window.clearTimeout(handle),
    onChange: (next) => {
      snapshot.value = next
    },
  })
  void controller.start()
})

onBeforeUnmount(() => {
  if (controller) controller.dispose()
})

function retry(): void {
  void controller?.retry()
}

function openJournal(): void {
  void controller?.openJournal()
}

function exit(): void {
  void controller?.exit()
}
</script>

<template>
  <div v-if="snapshot.view === 'pending'" class="boot-pending" aria-hidden="true" />
  <AppBootScreen
    v-else-if="snapshot.view === 'boot' && snapshot.model"
    :model="snapshot.model"
    @retry="retry"
    @open-journal="openJournal"
    @exit="exit"
  />
  <NuxtPage v-else-if="snapshot.view === 'app'" />
</template>

<style scoped>
.boot-pending {
  min-height: 100vh;
  background: #080c11;
}
</style>
