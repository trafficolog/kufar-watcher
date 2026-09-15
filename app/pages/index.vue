<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { TelegramDesktopState } from '../../shared/telegram'
import { useDesktopApi } from '../composables/use-desktop-api'

const telegramState = ref<TelegramDesktopState | null>(null)
let monitorRequest = 0
let unsubscribeMonitors: (() => void) | undefined
let unsubscribeTelegram: (() => void) | undefined

const telegramConfigured = computed(
  () =>
    (telegramState.value?.secret === 'protected' ||
      telegramState.value?.secret === 'unprotected') &&
    telegramState.value?.boundChatId !== null,
)

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
  <div class="first-run-shell">
    <aside class="rail" aria-label="Разделы приложения">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">KM</span>
        <div>
          <strong>Kufar Monitor</strong>
          <span>MVP-1</span>
        </div>
      </div>

      <nav class="rail-nav">
        <span class="rail-item active">Главная</span>
        <NuxtLink class="rail-item" to="/monitors">
          <span>Мониторы</span>
          <span class="count">00</span>
        </NuxtLink>
        <span class="rail-item muted">
          <span>Лента</span>
          <span class="count">00</span>
        </span>
        <span class="rail-item muted">
          <span>Избранное</span>
          <span class="count">00</span>
        </span>
        <span class="rail-item muted">
          <span>Архив</span>
          <span class="count">00</span>
        </span>
        <NuxtLink class="rail-item" to="/settings">Настройки</NuxtLink>
      </nav>

      <div class="rail-status">
        <span class="status-dot" aria-hidden="true" />
        База и планировщик готовы
      </div>
    </aside>

    <main class="first-run-main">
      <header class="readout" aria-label="Сводка">
        <div>
          <strong>000</strong>
          <span>находок</span>
        </div>
        <p>мониторинг ещё не настроен</p>
      </header>

      <section class="intro">
        <p class="eyebrow">Первый запуск</p>
        <h1>Kufar Monitor готов к работе</h1>
        <p class="lede">
          Инфраструктура уже поднята. До первого уведомления осталось два шага: настроить Telegram и
          создать первое правило мониторинга.
        </p>
      </section>

      <section class="steps" aria-label="Шаги первого запуска">
        <article class="step-card" :class="{ complete: telegramConfigured }">
          <div class="step-number">01</div>
          <div class="step-body">
            <p class="step-state">{{ telegramConfigured ? 'Готово' : 'Нужно сделать' }}</p>
            <h2>{{ telegramConfigured ? 'Телеграм настроен' : 'Настройте Telegram' }}</h2>
            <p>
              Добавьте токен бота и привяжите чат. Идентификатор чата искать вручную не нужно —
              приложение найдёт его после сообщения боту.
            </p>
            <NuxtLink class="action-link" to="/settings">
              {{ telegramConfigured ? 'Проверить настройку' : 'Настроить Telegram' }}
            </NuxtLink>
          </div>
          <span class="step-mark" aria-hidden="true">
            {{ telegramConfigured ? '✓' : '→' }}
          </span>
        </article>

        <article class="step-card">
          <div class="step-number">02</div>
          <div class="step-body">
            <p class="step-state">Следующий шаг</p>
            <h2>Создайте первое правило</h2>
            <p>
              Вставьте ссылку на нужную выдачу Kufar, задайте интервал и ключевые слова. Первый
              обход не пришлёт уведомлений: он только запомнит текущую выдачу как точку отсчёта.
            </p>
            <NuxtLink class="action-link primary" to="/monitors">Создать правило</NuxtLink>
          </div>
          <span class="step-mark" aria-hidden="true">→</span>
        </article>
      </section>

      <aside class="note">
        <strong>Что будет дальше</strong>
        <p>
          После появления первого правила главная приведёт вас в список мониторов. Избранное и Архив
          до первых находок остаются пустыми — это нормальное состояние новой базы.
        </p>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.first-run-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  background: #080c11;
  color: #c9d6dc;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.rail {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  padding: 28px 18px;
  border-right: 1px solid #1a2931;
  background: #0d141a;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 8px 28px;
}

.brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid #4fd8c4;
  color: #4fd8c4;
  font-size: 12px;
}

.brand strong,
.brand span {
  display: block;
}

.brand strong {
  font-size: 13px;
}

.brand div > span {
  margin-top: 4px;
  color: #647982;
  font-size: 10px;
  letter-spacing: 0.1em;
}

.rail-nav {
  display: grid;
  gap: 6px;
}

.rail-item {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-left: 2px solid transparent;
  color: #8fa3ac;
  font-size: 12px;
  text-decoration: none;
}

.rail-item.active {
  border-left-color: #4fd8c4;
  background: #111a21;
  color: #c9d6dc;
}

.rail-item.muted {
  color: #566971;
}

.count {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.rail-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding: 18px 8px 0;
  border-top: 1px solid #1a2931;
  color: #8fa3ac;
  font-size: 10px;
  line-height: 1.5;
}

.status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #4fd8c4;
  box-shadow: 0 0 10px rgb(79 216 196 / 40%);
}

.first-run-main {
  width: min(880px, calc(100% - 48px));
  margin: 0 auto;
  padding: 42px 0 64px;
}

.readout {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 26px;
  border-bottom: 1px solid #1a2931;
}

.readout div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.readout strong {
  color: #4fd8c4;
  font-size: 28px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.readout span,
.readout p,
.eyebrow,
.step-state {
  color: #8fa3ac;
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.readout p {
  margin: 0;
}

.intro {
  padding: 72px 0 34px;
}

.eyebrow {
  margin: 0 0 12px;
  color: #4fd8c4;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  max-width: 680px;
  margin-bottom: 18px;
  font-size: clamp(32px, 5vw, 52px);
  font-weight: 500;
  line-height: 1.12;
}

.lede {
  max-width: 680px;
  margin-bottom: 0;
  color: #8fa3ac;
  font-size: 14px;
  line-height: 1.7;
}

.steps {
  display: grid;
  gap: 14px;
}

.step-card {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
  padding: 24px;
  border: 1px solid #1a2931;
  background: #0d141a;
}

.step-card.complete {
  border-color: rgb(79 216 196 / 36%);
}

.step-number {
  color: #4fd8c4;
  font-size: 12px;
}

.step-state {
  margin-bottom: 8px;
}

.step-body h2 {
  margin-bottom: 10px;
  font-size: 18px;
  font-weight: 500;
}

.step-body > p:not(.step-state) {
  max-width: 620px;
  margin-bottom: 16px;
  color: #8fa3ac;
  font-size: 12px;
  line-height: 1.65;
}

.action-link {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  padding: 0 12px;
  border: 1px solid #30434b;
  color: #c9d6dc;
  font-size: 11px;
  text-decoration: none;
}

.action-link.primary {
  border-color: #4fd8c4;
  color: #4fd8c4;
}

.step-mark {
  color: #4fd8c4;
  font-size: 18px;
}

.note {
  margin-top: 22px;
  padding: 20px 22px;
  border-left: 2px solid #30434b;
  background: #0b1116;
}

.note strong {
  font-size: 12px;
}

.note p {
  margin: 8px 0 0;
  color: #8fa3ac;
  font-size: 11px;
  line-height: 1.65;
}

@media (max-width: 760px) {
  .first-run-shell {
    grid-template-columns: 1fr;
  }

  .rail {
    min-height: auto;
    padding: 16px;
    border-right: 0;
    border-bottom: 1px solid #1a2931;
  }

  .brand,
  .rail-status,
  .rail-item.muted {
    display: none;
  }

  .rail-nav {
    grid-template-columns: repeat(3, auto);
    justify-content: start;
  }

  .first-run-main {
    width: min(100% - 32px, 880px);
    padding-top: 28px;
  }

  .readout {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .intro {
    padding-top: 48px;
  }

  .step-card {
    grid-template-columns: 34px minmax(0, 1fr);
    padding: 20px;
  }

  .step-mark {
    display: none;
  }
}
</style>
