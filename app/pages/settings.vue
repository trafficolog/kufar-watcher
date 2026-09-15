<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { TelegramDesktopState } from '../../shared/telegram'
import { useDesktopApi } from '../composables/use-desktop-api'

const telegramState = ref<TelegramDesktopState | null>(null)
const token = ref('')
const verifiedUsername = ref('')
const consentRequired = ref(false)
const busy = ref<'idle' | 'verify' | 'save' | 'bind' | 'test'>('idle')
const errorText = ref('')
const noticeText = ref('')
let verifiedToken = ''
let unsubscribeState: (() => void) | undefined

const candidate = computed(() => telegramState.value?.candidate ?? null)
const isBound = computed(
  () => telegramState.value?.runtime === 'ready' && telegramState.value.boundChatId !== null,
)
const secretStatus = computed(() => {
  switch (telegramState.value?.secret) {
    case 'protected':
      return 'Токен хранится в защищённом системном хранилище.'
    case 'unprotected':
      return 'Токен хранится без системной защиты по вашему явному подтверждению.'
    case 'unavailable':
      return 'Защищённое хранилище сейчас недоступно.'
    default:
      return 'Токен ещё не сохранён.'
  }
})

function clearFeedback(): void {
  errorText.value = ''
  noticeText.value = ''
}

function setSaveSuccess(protection: 'protected' | 'unprotected'): void {
  consentRequired.value = false
  token.value = ''
  verifiedToken = ''
  noticeText.value =
    protection === 'protected'
      ? 'Токен проверен и сохранён в защищённом хранилище.'
      : 'Токен сохранён без защиты по вашему явному подтверждению.'
}

async function saveVerifiedToken(allowUnprotected: boolean): Promise<void> {
  const api = useDesktopApi()
  const result = await api.telegram.saveToken(verifiedToken, allowUnprotected)

  if (result.state === 'confirmation-required') {
    consentRequired.value = true
    noticeText.value = ''
    return
  }

  if (result.state === 'protected' || result.state === 'unprotected') {
    setSaveSuccess(result.state)
    return
  }

  verifiedToken = ''
  errorText.value = 'Не удалось сохранить токен. Проверьте системное хранилище и повторите попытку.'
}

async function verifyAndSave(): Promise<void> {
  const value = token.value.trim()
  clearFeedback()
  consentRequired.value = false
  verifiedToken = ''

  if (!value) {
    errorText.value = 'Введите токен, который выдал @BotFather.'
    return
  }

  busy.value = 'verify'
  try {
    const api = useDesktopApi()
    const verification = await api.telegram.verifyToken(value)
    verifiedUsername.value = verification.username
    verifiedToken = value
    busy.value = 'save'
    await saveVerifiedToken(false)
  } catch {
    verifiedToken = ''
    errorText.value = 'Не удалось проверить токен в Telegram. Проверьте значение и соединение.'
  } finally {
    busy.value = 'idle'
  }
}

async function confirmUnprotectedSave(): Promise<void> {
  if (!consentRequired.value || !verifiedToken) return

  clearFeedback()
  busy.value = 'save'
  try {
    await saveVerifiedToken(true)
  } catch {
    verifiedToken = ''
    consentRequired.value = false
    errorText.value = 'Не удалось сохранить токен без защиты. Повторите проверку токена.'
  } finally {
    busy.value = 'idle'
  }
}

function cancelUnprotectedSave(): void {
  consentRequired.value = false
  verifiedToken = ''
  noticeText.value = 'Токен не сохранён.'
}

async function bindCandidate(): Promise<void> {
  if (!candidate.value || busy.value !== 'idle') return

  clearFeedback()
  busy.value = 'bind'
  try {
    const api = useDesktopApi()
    const result = await api.telegram.bindCandidate()
    if (result === 'bound') {
      noticeText.value = 'Чат привязан. Уведомления будут отправляться только в него.'
    } else if (result === 'candidate-mismatch') {
      errorText.value = 'Кандидат изменился. Проверьте найденный чат и подтвердите ещё раз.'
    } else {
      errorText.value = 'Кандидат больше не доступен. Напишите боту ещё одно сообщение.'
    }
  } catch {
    errorText.value = 'Не удалось привязать чат. Повторите попытку.'
  } finally {
    busy.value = 'idle'
  }
}

async function sendTestMessage(): Promise<void> {
  if (!isBound.value || busy.value !== 'idle') return

  clearFeedback()
  busy.value = 'test'
  try {
    const api = useDesktopApi()
    await api.telegram.sendTestMessage()
    noticeText.value = 'Сообщение отправлено. Проверьте привязанный чат.'
  } catch {
    errorText.value = 'Не удалось отправить тестовое сообщение. Проверьте соединение с Telegram.'
  } finally {
    busy.value = 'idle'
  }
}

onMounted(() => {
  const api = useDesktopApi()
  unsubscribeState = api.telegram.onState((next) => {
    telegramState.value = next
  })

  void api.telegram
    .getState()
    .then((state) => {
      telegramState.value = state
    })
    .catch(() => {
      errorText.value = 'Не удалось получить состояние Telegram.'
    })
})

onBeforeUnmount(() => {
  unsubscribeState?.()
})
</script>

<template>
  <main class="telegram-settings">
    <header class="page-header">
      <p class="eyebrow">Kufar Monitor / Настройки</p>
      <h1>Telegram</h1>
      <p class="lede">
        Подключите собственного бота и подтвердите единственный чат, который будет получать
        уведомления.
      </p>
    </header>

    <section class="panel" aria-labelledby="telegram-token-title">
      <div class="section-title">
        <span aria-hidden="true">———</span>
        <h2 id="telegram-token-title">Токен бота</h2>
        <span class="rule" />
      </div>

      <p class="section-note">
        Получите токен у <strong>@BotFather</strong> командой <code>/newbot</code>. Значение не
        показывается обратно после сохранения.
      </p>

      <label class="field-label" for="telegram-token">Токен</label>
      <div class="token-row">
        <input
          id="telegram-token"
          v-model="token"
          class="input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy !== 'idle'"
          @input="consentRequired = false"
        />
        <button
          class="button primary"
          type="button"
          :disabled="busy !== 'idle'"
          @click="verifyAndSave"
        >
          {{ busy === 'verify' || busy === 'save' ? 'Проверяю…' : 'Проверить и сохранить' }}
        </button>
      </div>

      <p v-if="verifiedUsername" class="status ok">Бот отвечает: @{{ verifiedUsername }}</p>
      <p class="status muted">{{ secretStatus }}</p>

      <div v-if="consentRequired" class="warning" role="alert">
        <strong>Выбранный системный backend не шифрует секреты.</strong>
        <p>
          Токен будет сохранён локально без реального шифрования. Продолжайте только если
          понимаете этот риск; приложение не будет называть такое хранение защищённым.
        </p>
        <div class="actions">
          <button
            class="button danger"
            type="button"
            :disabled="busy !== 'idle'"
            @click="confirmUnprotectedSave"
          >
            Сохранить без защиты
          </button>
          <button
            class="button"
            type="button"
            :disabled="busy !== 'idle'"
            @click="cancelUnprotectedSave"
          >
            Не сохранять
          </button>
        </div>
      </div>
    </section>

    <section class="panel" aria-labelledby="telegram-chat-title">
      <div class="section-title">
        <span aria-hidden="true">———</span>
        <h2 id="telegram-chat-title">Чат для уведомлений</h2>
        <span class="rule" />
      </div>

      <p class="section-note">
        Идентификатор чата искать не нужно. Напишите боту любое сообщение: найденный чат станет
        кандидатом и ничего не получит, пока вы явно не нажмёте «Привязать» здесь.
      </p>

      <div class="step done">
        <span class="step-number">1</span>
        <div>
          <strong>Токен</strong>
          <p>{{ verifiedUsername ? `Проверен: @${verifiedUsername}` : secretStatus }}</p>
        </div>
      </div>

      <div class="step" :class="{ done: isBound, current: !isBound }">
        <span class="step-number">2</span>
        <div class="step-body">
          <template v-if="isBound">
            <strong>Чат привязан</strong>
            <p>
              Приложение хранит идентификатор внутри worker-контура; вводить его вручную не нужно.
            </p>
          </template>
          <template v-else-if="candidate">
            <strong>Найден чат — подтвердите</strong>
            <p>
              {{ candidate.displayName }} · {{ candidate.chatType }}
              <span v-if="candidate.username"> · @{{ candidate.username }}</span>
            </p>
            <p class="muted">До подтверждения этот чат не получает находки.</p>
            <button
              class="button primary"
              type="button"
              :disabled="busy !== 'idle'"
              @click="bindCandidate"
            >
              {{ busy === 'bind' ? 'Привязываю…' : 'Привязать' }}
            </button>
          </template>
          <template v-else>
            <strong>Ждём сообщение</strong>
            <p>Откройте бота и отправьте <code>/start</code> или любое сообщение.</p>
          </template>
        </div>
      </div>

      <div class="actions">
        <button
          class="button"
          type="button"
          :disabled="!isBound || busy !== 'idle'"
          @click="sendTestMessage"
        >
          {{ busy === 'test' ? 'Отправляю…' : 'Тестовое' }}
        </button>
      </div>
    </section>

    <p v-if="errorText" class="feedback error" role="alert">{{ errorText }}</p>
    <p v-if="noticeText" class="feedback success" role="status">{{ noticeText }}</p>

    <section id="seller-blacklist" class="future-anchor" tabindex="-1">
      <h2>Чёрный список продавцов</h2>
      <p>Этот раздел появится в отдельной задаче настроек; якорь маршрута сохранён.</p>
    </section>

    <NuxtLink class="home-link" to="/">На главную</NuxtLink>
  </main>
</template>

<style scoped>
.telegram-settings {
  min-height: 100vh;
  padding: 48px clamp(20px, 5vw, 72px) 80px;
  background: #080c11;
  color: #c9d6dc;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.page-header,
.panel,
.feedback,
.future-anchor,
.home-link {
  width: min(760px, 100%);
  margin-inline: auto;
}

.page-header {
  margin-bottom: 32px;
}

.eyebrow,
.section-title h2,
.field-label {
  text-transform: uppercase;
  letter-spacing: 0.09em;
}

.eyebrow,
.lede,
.section-note,
.status.muted,
.muted,
.home-link,
.step p {
  color: #8fa3ac;
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 12px;
}

h1 {
  margin: 0;
  font-size: clamp(30px, 5vw, 48px);
  line-height: 1;
}

.lede {
  max-width: 680px;
  margin: 12px 0 0;
  line-height: 1.6;
}

.panel {
  margin-bottom: 28px;
  padding: 24px;
  border: 1px solid rgb(139 188 180 / 16%);
  background: #0d141a;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  color: rgb(139 188 180 / 28%);
}

.section-title h2 {
  margin: 0;
  color: #8fa3ac;
  font-size: 12px;
  white-space: nowrap;
}

.rule {
  height: 1px;
  flex: 1;
  background: rgb(139 188 180 / 9%);
}

.section-note {
  margin: 0 0 20px;
  font-size: 12px;
  line-height: 1.6;
}

.section-note strong,
code {
  color: #c9d6dc;
}

.field-label {
  display: block;
  margin-bottom: 7px;
  font-size: 12px;
  font-weight: 700;
}

.token-row,
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.input,
.button {
  font: inherit;
}

.input {
  min-width: 260px;
  flex: 1;
  padding: 10px 12px;
  border: 1px solid rgb(139 188 180 / 24%);
  border-radius: 0;
  outline: none;
  background: #111a21;
  color: #c9d6dc;
}

.input:focus {
  border-color: #4fd8c4;
}

.button {
  padding: 9px 13px;
  border: 1px solid rgb(139 188 180 / 28%);
  background: transparent;
  color: #c9d6dc;
  cursor: pointer;
}

.button.primary {
  border-color: #4fd8c4;
  color: #4fd8c4;
}

.button.danger {
  border-color: rgb(226 112 95 / 55%);
  color: #e2705f;
}

.button:disabled,
.input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.status,
.feedback,
.step p,
.warning p {
  font-size: 12px;
  line-height: 1.55;
}

.status {
  margin: 10px 0 0;
}

.status.ok,
.feedback.success {
  color: #4fd8c4;
}

.warning {
  margin-top: 18px;
  padding: 14px;
  border-left: 2px solid #e0a94f;
  background: #111a21;
}

.warning strong {
  color: #e0a94f;
}

.warning p {
  margin: 7px 0 12px;
  color: #8fa3ac;
}

.step {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  padding: 14px;
  border: 1px solid rgb(139 188 180 / 14%);
  background: #111a21;
}

.step.current {
  border-color: rgb(79 216 196 / 35%);
}

.step-number {
  display: grid;
  width: 24px;
  height: 24px;
  flex: none;
  place-items: center;
  border: 1px solid rgb(139 188 180 / 28%);
  color: #8fa3ac;
  font-size: 11px;
}

.step.done .step-number {
  border-color: #4fd8c4;
  color: #4fd8c4;
}

.step-body {
  min-width: 0;
}

.step strong {
  font-size: 12px;
}

.step p {
  margin: 4px 0 0;
}

.step .button {
  margin-top: 12px;
}

.actions {
  margin-top: 16px;
}

.feedback {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid currentcolor;
}

.feedback.error {
  color: #e2705f;
}

.future-anchor {
  margin-top: 72px;
  padding: 20px;
  border: 1px dashed rgb(139 188 180 / 16%);
  color: #71858f;
  scroll-margin-top: 24px;
}

.future-anchor h2 {
  margin: 0 0 8px;
  font-size: 13px;
}

.future-anchor p {
  margin: 0;
  font-size: 12px;
}

.home-link {
  display: block;
  margin-top: 24px;
  font-size: 12px;
}

@media (max-width: 640px) {
  .telegram-settings {
    padding: 28px 16px 56px;
  }

  .panel {
    padding: 18px;
  }

  .token-row {
    align-items: stretch;
  }

  .input,
  .token-row .button {
    width: 100%;
    min-width: 0;
  }
}
</style>
