<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDesktopApi } from '../composables/use-desktop-api'
import { parseMonitorTerms, previewMonitorUrl } from '../lib/monitor-create-model'

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
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : 'Не удалось создать монитор.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="monitor-create">
    <header class="page-header">
      <p class="eyebrow">Kufar Monitor / Мониторы</p>
      <h1>Новое правило</h1>
      <p class="lede">Создайте монитор из ссылки на выдачу Kufar. Расписание подключится сразу после сохранения.</p>
    </header>

    <form class="editor" novalidate @submit.prevent="submit">
      <fieldset>
        <legend>Что отслеживаем</legend>

        <label for="monitor-name">Название</label>
        <p class="help">Короткое имя, по которому правило легко узнать в уведомлениях.</p>
        <input id="monitor-name" v-model="name" type="text" autocomplete="off" required />

        <label for="monitor-url">Ссылка Kufar</label>
        <p class="help">Откройте нужную выдачу на kufar.by и вставьте адрес из строки браузера.</p>
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
        <dl v-else-if="preview?.state === 'valid'" class="url-preview" aria-label="Разобранная ссылка">
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
        <p v-else class="help">Вставьте ссылку — покажем категорию, регион и поисковую строку до сохранения.</p>
      </fieldset>

      <fieldset>
        <legend>Частота</legend>

        <label for="monitor-interval">Интервал</label>
        <p class="help">Частые обходы используйте только там, где скорость действительно важна.</p>
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
        <p class="help">Оставьте поля пустыми, чтобы получать всё, что попадает под фильтры ссылки.</p>

        <label for="monitor-include">Включающие термы</label>
        <p class="help">
          Через запятую. <strong>*</strong> заменяет часть одного слова: <code>playstation*</code>
          совпадёт с playstation5. Словоформы автоматически не ищутся.
        </p>
        <input id="monitor-include" v-model="includeTerms" type="text" autocomplete="off" />

        <label for="monitor-exclude">Исключающие термы</label>
        <p class="help">Через запятую. Совпадение здесь исключит объявление.</p>
        <input id="monitor-exclude" v-model="excludeTerms" type="text" autocomplete="off" />
      </fieldset>

      <div class="actions">
        <button type="submit" :disabled="!canSubmit">
          {{ saving ? 'Создаю…' : 'Создать монитор' }}
        </button>
        <NuxtLink to="/">На главную</NuxtLink>
      </div>

      <p v-if="submitError" class="message error" role="alert">{{ submitError }}</p>
      <p v-if="createdMonitorId !== null" class="message success" role="status">
        Монитор #{{ createdMonitorId }} создан. Первый обход начнётся по расписанию.
      </p>
    </form>
  </main>
</template>

<style scoped>
.monitor-create {
  min-height: 100vh;
  padding: 48px clamp(20px, 5vw, 72px);
  background: #080c11;
  color: #c9d6dc;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.page-header,
.editor {
  width: min(760px, 100%);
  margin: 0 auto;
}

.page-header {
  margin-bottom: 32px;
}

.eyebrow,
legend,
label,
dt {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.eyebrow,
.help,
dt,
.actions a {
  color: #8fa3ac;
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 12px;
}

h1 {
  margin: 0;
  font-size: clamp(28px, 5vw, 44px);
  font-weight: 600;
}

.lede {
  max-width: 650px;
  margin: 12px 0 0;
  color: #8fa3ac;
  line-height: 1.6;
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

dt {
  font-size: 10px;
}

dd {
  overflow: hidden;
  margin: 4px 0 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: center;
  gap: 18px;
}

button {
  padding: 11px 18px;
  border: 1px solid #4fd8c4;
  border-radius: 4px;
  background: #4fd8c4;
  color: #080c11;
  font-weight: 800;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
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

@media (max-width: 640px) {
  .monitor-create {
    padding: 28px 16px;
  }

  fieldset {
    padding: 18px;
  }

  .url-preview {
    grid-template-columns: 1fr;
  }
}
</style>
