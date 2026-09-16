<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { BootState, MonitorListItem } from '../../shared/ipc'
import { isAllowedKufarListingUrl } from '../../shared/kufar-external-link'
import type { TelegramDesktopState } from '../../shared/telegram'
import { useDesktopApi } from '../composables/use-desktop-api'
import { parseMonitorTerms, previewMonitorUrl } from '../lib/monitor-create-model'

const monitors = ref<MonitorListItem[]>([])
const archivedMonitors = ref<MonitorListItem[]>([])
const archiveCandidateId = ref<number | null>(null)
const bootState = ref<BootState | null>(null)
const telegramState = ref<TelegramDesktopState | null>(null)
const listError = ref('')
const stateChangingId = ref<number | null>(null)
const showCreate = ref(false)
let monitorListRequest = 0
let unsubscribeMonitors: (() => void) | undefined
let unsubscribeBootState: (() => void) | undefined
let unsubscribeTelegramState: (() => void) | undefined

const name = ref('')
const sourceUrl = ref('')
const intervalSec = ref(300)
const includeTerms = ref('')
const excludeTerms = ref('')
const saving = ref(false)
const submitError = ref('')
const createdMonitorId = ref<number | null>(null)

const preview = computed(() => {
  const value = sourceUrl.value.trim()
  return value ? previewMonitorUrl(value) : null
})

const canSubmit = computed(
  () => name.value.trim().length > 0 && preview.value?.state === 'valid' && !saving.value,
)

const activeCount = computed(
  () => monitors.value.filter((monitor) => monitor.state === 'active').length,
)
const pausedCount = computed(
  () => monitors.value.filter((monitor) => monitor.state === 'paused').length,
)

const databaseStatus = computed(() => {
  const database = bootState.value?.steps.find((step) => step.id === 'database')
  if (database?.state === 'success') return { tone: 'ok', label: 'подключена' }
  if (database?.state === 'error' || bootState.value?.phase === 'error') {
    return { tone: 'error', label: 'ошибка' }
  }
  if (database?.state === 'running') return { tone: 'pending', label: 'подключение…' }
  return { tone: 'muted', label: 'ожидание' }
})

const telegramStatus = computed(() => {
  switch (telegramState.value?.channel) {
    case 'connected':
      return { tone: 'ok', label: 'подключён' }
    case 'reconnecting':
      return { tone: 'pending', label: 'переподключение…' }
    case 'error':
      return { tone: 'error', label: 'ошибка' }
    case 'disconnected':
      return { tone: 'muted', label: 'отключён' }
    default:
      return { tone: 'muted', label: 'ожидание' }
  }
})

const runDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function intervalLabel(seconds: number): string {
  if (seconds === 60) return '1 минута'
  if (seconds < 3600 && seconds % 60 === 0) return `${seconds / 60} мин.`
  if (seconds === 3600) return '1 час'
  if (seconds % 3600 === 0) return `${seconds / 3600} ч.`
  return `${seconds} сек.`
}

function lastRunTime(monitor: MonitorListItem): string {
  const run = monitor.lastRun
  if (!run) return 'ещё не было'
  const timestamp = run.finishedAt ?? run.startedAt
  return runDateFormatter.format(new Date(timestamp))
}

function lastRunReason(monitor: MonitorListItem): string {
  if (!monitor.lastRun) return 'причина не указана'
  const code = monitor.lastRun.errorCode
  switch (code) {
    case 'network':
      return 'сетевая ошибка'
    case 'timeout':
      return 'тайм-аут запроса'
    case 'http-4xx':
      return 'Kufar отклонил запрос'
    case 'http-5xx':
      return 'ошибка на стороне Kufar'
    case 'unexpected-http':
      return 'неожиданный ответ Kufar'
    case 'rate-limited':
      return 'Kufar ограничил частоту запросов'
    case 'description-budget-exhausted':
      return 'исчерпан лимит загрузки описаний'
    case 'unexpected':
      return 'внутренняя ошибка обхода'
    default:
      if (code?.startsWith('resilient-')) return 'источники Kufar недоступны'
      if (monitor.lastRun.errorCategory === 'source') return 'ошибка источника'
      if (monitor.lastRun.errorCategory === 'policy') return 'ограничение обхода'
      if (monitor.lastRun.errorCategory === 'internal') return 'внутренняя ошибка обхода'
      return 'причина не указана'
  }
}

function lastRunResult(monitor: MonitorListItem): { tone: string; label: string } {
  const outcome = monitor.lastRun?.outcome
  switch (outcome) {
    case 'success':
      return { tone: 'ok', label: 'успешно' }
    case 'catchup':
      return { tone: 'ok', label: 'догоняющий обход завершён' }
    case 'running':
      return { tone: 'pending', label: 'идёт сейчас' }
    case 'skipped':
      return { tone: 'pending', label: 'пропущен — предыдущий обход ещё выполнялся' }
    case 'interrupted':
      return { tone: 'error', label: 'прерван при остановке приложения' }
    case 'error':
      return { tone: 'error', label: `ошибка — ${lastRunReason(monitor)}` }
    case null:
    case undefined:
      return { tone: 'muted', label: 'ещё не запускался' }
    default:
      return { tone: 'muted', label: 'завершён' }
  }
}

async function refreshMonitors(): Promise<void> {
  const request = ++monitorListRequest
  try {
    const [next, archived] = await Promise.all([
      useDesktopApi().monitors.list(),
      useDesktopApi().monitors.list(true),
    ])
    if (request !== monitorListRequest) return
    monitors.value = next
    archivedMonitors.value = archived
    listError.value = ''
  } catch {
    if (request !== monitorListRequest) return
    listError.value = 'Не удалось получить список мониторов.'
  }
}

async function toggleMonitorState(monitor: MonitorListItem): Promise<void> {
  if (stateChangingId.value !== null || monitor.state === 'archived') return

  const nextState = monitor.state === 'active' ? 'paused' : 'active'
  stateChangingId.value = monitor.id
  listError.value = ''
  try {
    await useDesktopApi().monitors.setState(monitor.id, nextState)
    await refreshMonitors()
  } catch {
    listError.value =
      nextState === 'paused'
        ? 'Не удалось приостановить монитор.'
        : 'Не удалось возобновить монитор.'
  } finally {
    stateChangingId.value = null
  }
}

async function archiveMonitor(monitor: MonitorListItem): Promise<void> {
  if (stateChangingId.value !== null || archiveCandidateId.value !== monitor.id) return
  stateChangingId.value = monitor.id
  listError.value = ''
  try {
    await useDesktopApi().monitors.setState(monitor.id, 'archived')
    archiveCandidateId.value = null
    await refreshMonitors()
  } catch (error) {
    listError.value = error instanceof Error ? error.message : 'Не удалось архивировать монитор.'
  } finally {
    stateChangingId.value = null
  }
}

async function restoreMonitor(monitor: MonitorListItem): Promise<void> {
  if (stateChangingId.value !== null) return
  stateChangingId.value = monitor.id
  listError.value = ''
  try {
    await useDesktopApi().monitors.setState(monitor.id, 'active')
    await refreshMonitors()
  } catch (error) {
    listError.value = error instanceof Error ? error.message : 'Не удалось восстановить монитор.'
  } finally {
    stateChangingId.value = null
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return

  saving.value = true
  submitError.value = ''
  createdMonitorId.value = null

  try {
    const result = await useDesktopApi().monitors.create({
      name: name.value.trim(),
      sourceUrl: sourceUrl.value.trim(),
      intervalSec: intervalSec.value,
      include: parseMonitorTerms(includeTerms.value),
      exclude: parseMonitorTerms(excludeTerms.value),
    })
    createdMonitorId.value = result.monitorId
    await refreshMonitors()
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : 'Не удалось создать монитор.'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  const api = useDesktopApi()

  unsubscribeMonitors = api.monitors.onChanged(() => {
    void refreshMonitors()
  })
  unsubscribeBootState = api.system.onBootState((next) => {
    bootState.value = next
  })
  unsubscribeTelegramState = api.telegram.onState((next) => {
    telegramState.value = next
  })

  void refreshMonitors()
  void api.system
    .getBootState()
    .then((next) => {
      bootState.value = next
    })
    .catch(() => {
      bootState.value = null
    })
  void api.telegram
    .getState()
    .then((next) => {
      telegramState.value = next
    })
    .catch(() => {
      telegramState.value = null
    })
})

onUnmounted(() => {
  unsubscribeMonitors?.()
  unsubscribeBootState?.()
  unsubscribeTelegramState?.()
})
</script>

<template>
  <main class="monitor-page">
    <div class="page-shell">
      <header class="page-header">
        <div>
          <nav class="eyebrow page-navigation" aria-label="Разделы приложения">
            <span aria-current="page">Мониторы</span>
            <NuxtLink to="/settings">Настройки</NuxtLink>
          </nav>
          <h1>Мониторы</h1>
          <p class="lede">Состояние правил и последнего обхода — без открытия базы данных.</p>
        </div>
        <button class="primary" type="button" @click="showCreate = !showCreate">
          {{ showCreate ? 'Скрыть форму' : 'Новое правило' }}
        </button>
      </header>

      <section class="system-strip" aria-label="Состояние подключений">
        <article class="system-card">
          <span class="status-dot" :class="databaseStatus.tone" aria-hidden="true"></span>
          <div>
            <span class="system-label">PostgreSQL</span>
            <strong>{{ databaseStatus.label }}</strong>
          </div>
        </article>
        <article class="system-card">
          <span class="status-dot" :class="telegramStatus.tone" aria-hidden="true"></span>
          <div>
            <span class="system-label">Telegram</span>
            <strong>{{ telegramStatus.label }}</strong>
          </div>
        </article>
      </section>

      <section class="monitor-section" aria-labelledby="monitor-list-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Правила</p>
            <h2 id="monitor-list-heading">{{ monitors.length }} мониторов</h2>
          </div>
          <p class="summary">{{ activeCount }} в работе · {{ pausedCount }} остановлено</p>
        </div>

        <p v-if="listError" class="message error" role="alert">{{ listError }}</p>
        <p v-if="monitors.length === 0 && !listError" class="empty-state">
          Мониторов пока нет. Создайте первое правило, чтобы начать обходы Kufar.
        </p>

        <div v-else class="monitor-list">
          <article v-for="monitor in monitors" :key="monitor.id" class="monitor-row">
            <div class="monitor-main">
              <div class="monitor-title-row">
                <h3>{{ monitor.name }}</h3>
                <span class="state-pill" :class="monitor.state">
                  {{ monitor.state === 'active' ? 'работает' : 'стоп' }}
                </span>
              </div>
              <p class="monitor-meta">Интервал {{ intervalLabel(monitor.intervalSec) }}</p>
            </div>

            <dl class="run-summary">
              <div>
                <dt>Последний обход</dt>
                <dd>{{ lastRunTime(monitor) }}</dd>
              </div>
              <div>
                <dt>Результат</dt>
                <dd :class="lastRunResult(monitor).tone">{{ lastRunResult(monitor).label }}</dd>
              </div>
            </dl>

            <div class="monitor-actions">
              <button
                class="secondary"
                type="button"
                :disabled="stateChangingId !== null"
                @click="toggleMonitorState(monitor)"
              >
                {{
                  stateChangingId === monitor.id
                    ? 'Сохраняю…'
                    : monitor.state === 'active'
                      ? 'Приостановить'
                      : 'Возобновить'
                }}
              </button>
              <div>
                <button
                  class="secondary"
                  type="button"
                  :disabled="stateChangingId !== null"
                  @click="archiveCandidateId = monitor.id"
                >
                  В архив
                </button>
                <div
                  v-if="archiveCandidateId === monitor.id"
                  class="archive-confirmation"
                  role="group"
                  :aria-label="`Подтверждение архивирования ${monitor.name}`"
                >
                  <p>Монитор «{{ monitor.name }}» перестанет отслеживаться. История останется.</p>
                  <button
                    class="secondary"
                    type="button"
                    :disabled="stateChangingId !== null"
                    @click="archiveMonitor(monitor)"
                  >
                    {{
                      stateChangingId === monitor.id ? 'Архивирую…' : 'Подтвердить архивирование'
                    }}
                  </button>
                  <button
                    class="link-button"
                    type="button"
                    :disabled="stateChangingId !== null"
                    @click="archiveCandidateId = null"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>

            <details class="monitor-details">
              <summary>Параметры — {{ monitor.name }}</summary>
              <dl class="monitor-parameters">
                <div>
                  <dt>Сохранённая ссылка Kufar</dt>
                  <dd class="source-url">{{ monitor.sourceUrl }}</dd>
                </div>
                <div>
                  <dt>Интервал</dt>
                  <dd>{{ intervalLabel(monitor.intervalSec) }}</dd>
                </div>
                <div>
                  <dt>Включающие слова</dt>
                  <dd>
                    {{ monitor.include.length ? monitor.include.join(', ') : 'Все объявления выдачи' }}
                  </dd>
                </div>
                <div>
                  <dt>Исключающие слова</dt>
                  <dd>{{ monitor.exclude.length ? monitor.exclude.join(', ') : 'Нет' }}</dd>
                </div>
                <div>
                  <dt>Последний обход</dt>
                  <dd>{{ lastRunTime(monitor) }} · {{ lastRunResult(monitor).label }}</dd>
                </div>
              </dl>
              <a
                v-if="isAllowedKufarListingUrl(monitor.sourceUrl)"
                class="source-link"
                :href="monitor.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
              >Открыть выдачу Kufar</a>
              <p v-else class="message error">Ссылка не поддерживается для внешнего открытия.</p>
            </details>
          </article>
        </div>
      </section>

      <section class="monitor-section" aria-labelledby="archive-list-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">История</p>
            <h2 id="archive-list-heading">Архив · {{ archivedMonitors.length }}</h2>
          </div>
        </div>
        <p v-if="archivedMonitors.length === 0" class="empty-state">Архив пока пуст.</p>
        <div v-else class="monitor-list">
          <article v-for="monitor in archivedMonitors" :key="monitor.id" class="monitor-row">
            <div class="monitor-main">
              <h3>{{ monitor.name }}</h3>
              <p class="monitor-meta">В архиве · обходы остановлены; история сохранена.</p>
            </div>
            <dl class="run-summary">
              <div>
                <dt>Последний обход</dt>
                <dd>{{ lastRunTime(monitor) }}</dd>
              </div>
              <div>
                <dt>Результат</dt>
                <dd :class="lastRunResult(monitor).tone">{{ lastRunResult(monitor).label }}</dd>
              </div>
            </dl>
            <button
              class="secondary"
              type="button"
              :disabled="stateChangingId !== null"
              @click="restoreMonitor(monitor)"
            >
              {{ stateChangingId === monitor.id ? 'Восстанавливаю…' : 'Вернуть в работу' }}
            </button>

            <details class="monitor-details">
              <summary>Параметры — {{ monitor.name }}</summary>
              <dl class="monitor-parameters">
                <div>
                  <dt>Сохранённая ссылка Kufar</dt>
                  <dd class="source-url">{{ monitor.sourceUrl }}</dd>
                </div>
                <div>
                  <dt>Интервал</dt>
                  <dd>{{ intervalLabel(monitor.intervalSec) }}</dd>
                </div>
                <div>
                  <dt>Включающие слова</dt>
                  <dd>
                    {{ monitor.include.length ? monitor.include.join(', ') : 'Все объявления выдачи' }}
                  </dd>
                </div>
                <div>
                  <dt>Исключающие слова</dt>
                  <dd>{{ monitor.exclude.length ? monitor.exclude.join(', ') : 'Нет' }}</dd>
                </div>
                <div>
                  <dt>Последний обход</dt>
                  <dd>{{ lastRunTime(monitor) }} · {{ lastRunResult(monitor).label }}</dd>
                </div>
              </dl>
              <a
                v-if="isAllowedKufarListingUrl(monitor.sourceUrl)"
                class="source-link"
                :href="monitor.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
              >Открыть выдачу Kufar</a>
              <p v-else class="message error">Ссылка не поддерживается для внешнего открытия.</p>
            </details>
          </article>
        </div>
      </section>

      <section v-if="showCreate" class="create-section" aria-labelledby="create-monitor-heading">
        <header class="create-header">
          <p class="eyebrow">Новое правило</p>
          <h2 id="create-monitor-heading">Добавить монитор</h2>
          <p class="lede">
            Создайте монитор из ссылки на выдачу Kufar. Расписание подключится сразу после
            сохранения.
          </p>
        </header>

        <form class="editor" novalidate @submit.prevent="submit">
          <fieldset>
            <legend>Что отслеживаем</legend>

            <label for="monitor-name">Название</label>
            <p class="help">Короткое имя, по которому правило легко узнать в уведомлениях.</p>
            <input id="monitor-name" v-model="name" type="text" autocomplete="off" required />

            <label for="monitor-url">Ссылка Kufar</label>
            <p class="help">
              Откройте нужную выдачу на kufar.by и вставьте адрес из строки браузера.
            </p>
            <input
              id="monitor-url"
              v-model="sourceUrl"
              type="url"
              inputmode="url"
              spellcheck="false"
              required
              :aria-invalid="preview?.state === 'error' ? 'true' : undefined"
            />

            <p v-if="preview?.state === 'error'" class="message error" role="alert">
              {{ preview.message }}
            </p>
            <dl
              v-else-if="preview?.state === 'valid'"
              class="url-preview"
              aria-label="Разобранная ссылка"
            >
              <div>
                <dt>Категория</dt>
                <dd>{{ preview.category }}</dd>
              </div>
              <div>
                <dt>Регион</dt>
                <dd>{{ preview.region }}</dd>
              </div>
              <div>
                <dt>Поисковая строка</dt>
                <dd>{{ preview.query }}</dd>
              </div>
            </dl>
            <p v-else class="help">
              Вставьте ссылку — покажем категорию, регион и поисковую строку до сохранения.
            </p>
          </fieldset>

          <fieldset>
            <legend>Частота</legend>

            <label for="monitor-interval">Интервал</label>
            <p class="help">
              Частые обходы используйте только там, где скорость действительно важна.
            </p>
            <select id="monitor-interval" v-model.number="intervalSec">
              <option :value="60">Каждую минуту</option>
              <option :value="120">Каждые 2 минуты</option>
              <option :value="300">Каждые 5 минут</option>
              <option :value="600">Каждые 10 минут</option>
              <option :value="900">Каждые 15 минут</option>
              <option :value="3600">Каждый час</option>
            </select>
          </fieldset>

          <fieldset>
            <legend>Ключевые слова</legend>
            <p class="help">
              Оставьте поля пустыми, чтобы получать всё, что попадает под фильтры ссылки.
            </p>

            <label for="monitor-include">Включающие термы</label>
            <p class="help">
              Через запятую. <strong>*</strong> заменяет часть одного слова:
              <code>playstation*</code> совпадёт с playstation5. Словоформы автоматически не ищутся.
            </p>
            <input id="monitor-include" v-model="includeTerms" type="text" autocomplete="off" />

            <label for="monitor-exclude">Исключающие термы</label>
            <p class="help">Через запятую. Совпадение здесь исключит объявление.</p>
            <input id="monitor-exclude" v-model="excludeTerms" type="text" autocomplete="off" />
          </fieldset>

          <div class="actions">
            <button class="primary" type="submit" :disabled="!canSubmit">
              {{ saving ? 'Создаю…' : 'Создать монитор' }}
            </button>
            <button class="link-button" type="button" @click="showCreate = false">Отмена</button>
            <NuxtLink to="/">На главную</NuxtLink>
          </div>

          <p v-if="submitError" class="message error" role="alert">{{ submitError }}</p>
          <p v-if="createdMonitorId !== null" class="message success" role="status">
            Монитор #{{ createdMonitorId }} создан. Первый обход начнётся по расписанию.
          </p>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.monitor-page {
  min-height: 100vh;
  padding: 40px clamp(18px, 4vw, 56px) 64px;
  background: #080c11;
  color: #c9d6dc;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.page-shell {
  width: min(1120px, 100%);
  margin: 0 auto;
}

.page-header,
.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.page-header {
  margin-bottom: 24px;
}

.eyebrow,
legend,
label,
dt,
.system-label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.eyebrow,
.help,
dt,
.summary,
.monitor-meta,
.actions a,
.empty-state,
.system-label {
  color: #8fa3ac;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 11px;
}

.page-navigation {
  display: flex;
  align-items: center;
  gap: 24px;
}

.page-navigation a,
.source-link {
  color: #4fd8c4;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.page-navigation a:focus-visible,
.source-link:focus-visible,
.monitor-details summary:focus-visible {
  outline: 2px solid #4fd8c4;
  outline-offset: 4px;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: clamp(30px, 5vw, 46px);
  font-weight: 600;
}

h2 {
  margin-bottom: 0;
  font-size: 22px;
  font-weight: 600;
}

h3 {
  margin-bottom: 0;
  font-size: 18px;
  font-weight: 600;
}

.lede {
  max-width: 700px;
  margin: 10px 0 0;
  color: #8fa3ac;
  line-height: 1.6;
}

.system-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 32px;
}

.system-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgb(139 188 180 / 16%);
  background: #0d141a;
}

.system-card div {
  display: grid;
  gap: 2px;
}

.system-label {
  font-size: 10px;
}

.system-card strong {
  font-size: 13px;
  font-weight: 600;
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #62727a;
}

.status-dot.ok,
.ok {
  color: #4fd8c4;
}

.status-dot.ok {
  background: #4fd8c4;
}

.status-dot.pending,
.pending {
  color: #e5b567;
}

.status-dot.pending {
  background: #e5b567;
}

.status-dot.error,
.error {
  color: #e2705f;
}

.status-dot.error {
  background: #e2705f;
}

.monitor-section,
.create-section {
  border-top: 1px solid rgb(139 188 180 / 16%);
  padding-top: 24px;
}

.section-heading {
  margin-bottom: 14px;
}

.monitor-section + .monitor-section {
  margin-top: 32px;
}

.summary {
  margin-bottom: 2px;
  font-size: 12px;
}

.monitor-list {
  border-top: 1px solid rgb(139 188 180 / 16%);
}

.monitor-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.15fr) minmax(320px, 1.6fr) auto;
  gap: 24px;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid rgb(139 188 180 / 16%);
}

.monitor-details {
  grid-column: 1 / -1;
  min-width: 0;
  border-top: 1px solid rgb(139 188 180 / 16%);
  padding-top: 12px;
}

.monitor-details summary {
  width: fit-content;
  cursor: pointer;
  color: #4fd8c4;
  font-size: 12px;
  font-weight: 700;
}

.monitor-parameters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 18px 0;
}

.monitor-parameters div {
  min-width: 0;
}

.monitor-parameters dd {
  overflow-wrap: anywhere;
}

.source-url {
  user-select: text;
}

.source-link {
  font-size: 12px;
}

.monitor-actions {
  display: grid;
  gap: 8px;
  justify-items: start;
}

.archive-confirmation {
  max-width: 250px;
  overflow-wrap: anywhere;
}

.monitor-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.monitor-meta {
  margin: 7px 0 0;
  font-size: 12px;
}

.state-pill {
  padding: 3px 7px;
  border: 1px solid rgb(79 216 196 / 40%);
  border-radius: 999px;
  color: #4fd8c4;
  font-size: 10px;
  text-transform: uppercase;
}

.state-pill.paused {
  border-color: rgb(143 163 172 / 32%);
  color: #8fa3ac;
}

.run-summary {
  display: grid;
  grid-template-columns: minmax(130px, 0.8fr) minmax(180px, 1.2fr);
  gap: 18px;
  margin: 0;
}

.run-summary div {
  min-width: 0;
}

dt {
  font-size: 9px;
}

dd {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.4;
}

.empty-state {
  padding: 28px 0;
  border-top: 1px solid rgb(139 188 180 / 16%);
  border-bottom: 1px solid rgb(139 188 180 / 16%);
  font-size: 13px;
  line-height: 1.6;
}

.create-section {
  margin-top: 44px;
}

.create-header,
.editor {
  width: min(760px, 100%);
}

.create-header {
  margin-bottom: 24px;
}

.editor {
  display: grid;
  gap: 20px;
}

fieldset {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 24px;
  border: 1px solid rgb(139 188 180 / 16%);
  background: #0d141a;
}

legend {
  padding: 0 10px;
  color: #4fd8c4;
  font-size: 12px;
  font-weight: 700;
}

label {
  margin-top: 10px;
  font-size: 12px;
  font-weight: 700;
}

.help,
.message {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
}

input,
select,
button {
  font: inherit;
}

input,
select {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 12px;
  border: 1px solid rgb(139 188 180 / 24%);
  border-radius: 4px;
  outline: none;
  background: #111a21;
  color: #c9d6dc;
}

input:focus,
select:focus {
  border-color: #c9d6dc;
  box-shadow: 0 0 0 2px rgb(201 214 220 / 10%);
}

input[aria-invalid='true'] {
  border-color: #e2705f;
}

.url-preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 4px 0 0;
  background: rgb(139 188 180 / 16%);
}

.url-preview div {
  min-width: 0;
  padding: 12px;
  background: #111a21;
}

.url-preview dd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

button {
  border-radius: 4px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.primary,
.secondary {
  padding: 10px 16px;
  border: 1px solid #4fd8c4;
  font-weight: 800;
}

.primary {
  background: #4fd8c4;
  color: #080c11;
}

.secondary {
  background: transparent;
  color: #4fd8c4;
  font-size: 11px;
}

.link-button {
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: #8fa3ac;
  font-size: 12px;
}

.actions a {
  font-size: 12px;
}

.message.error {
  color: #e2705f;
}

.message.success {
  color: #4fd8c4;
}

code {
  color: #c9d6dc;
}

@media (max-width: 820px) {
  .monitor-row {
    grid-template-columns: 1fr auto;
  }

  .run-summary {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}

@media (max-width: 640px) {
  .monitor-page {
    padding: 28px 16px 48px;
  }

  .page-header,
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .system-strip,
  .run-summary,
  .monitor-parameters {
    grid-template-columns: 1fr;
  }

  .monitor-row {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .run-summary {
    grid-column: auto;
    grid-row: auto;
  }

  .secondary {
    justify-self: start;
  }

  fieldset {
    padding: 18px;
  }

  .url-preview {
    grid-template-columns: 1fr;
  }
}
</style>
