<script setup lang="ts">
import type { BootScreenModel, BootScreenStep } from '../lib/boot-screen-model'

const { model } = defineProps<{ model: BootScreenModel }>()
const emit = defineEmits<{
  retry: []
  openJournal: []
  exit: []
}>()

function stepClass(step: BootScreenStep): string[] {
  return [
    'stepline',
    {
      done: step.tone === 'success' || step.tone === 'skipped',
      now: step.tone === 'running',
      warn: step.tone === 'degraded',
      fail: step.tone === 'error',
    },
  ]
}

function retry(): void {
  emit('retry')
}

function openJournal(): void {
  emit('openJournal')
}

function exit(): void {
  emit('exit')
}
</script>

<template>
  <main class="boot" aria-labelledby="boot-heading">
    <div class="boot-in">
      <div class="boot-mark">
        <span class="boot-led" :class="{ bad: Boolean(model.error) }" aria-hidden="true" />
        <span class="boot-name">Kufar Monitor</span>
      </div>

      <h1 id="boot-heading" class="boot-h">{{ model.title }}</h1>

      <div class="boot-steps" aria-label="Состояние запуска">
        <div v-for="step in model.steps" :key="step.id" :class="stepClass(step)">
          <span class="mk" aria-hidden="true">{{ step.marker }}</span>
          <span class="nm">{{ step.label }}</span>
          <span class="ms">{{ step.status }}</span>
        </div>
      </div>

      <section v-if="model.error" class="boot-err" role="alert">
        <strong>{{ model.error.heading }}</strong>
        <p>{{ model.error.message }}</p>
        <div class="acts">
          <button class="act act-key" type="button" @click="retry">Повторить</button>
          <button class="act" type="button" @click="openJournal">Открыть журнал</button>
          <button class="act act-off" type="button" @click="exit">Выйти</button>
        </div>
      </section>

      <p class="boot-foot">// локальный режим // окно откроется автоматически</p>
    </div>
  </main>
</template>

<style scoped>
.boot {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 40px 20px;
  background: var(--bg, #080c11);
  color: var(--fg, #c9d6dc);
}

.boot-in {
  width: 100%;
  max-width: 440px;
}

.boot-mark {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 48px;
}

.boot-led {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--acc, #4fd8c4);
  box-shadow: 0 0 10px var(--acc-glow, rgba(79, 216, 196, 0.35));
}

.boot-led.bad {
  background: var(--bad, #e2705f);
  box-shadow: none;
}

.boot-name {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.boot-h {
  margin: 0 0 20px;
  color: var(--fg-3, #71858f);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}

.stepline {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--rule-soft, rgba(139, 188, 180, 0.09));
  font-size: 12px;
}

.stepline:last-child {
  border-bottom: 0;
}

.stepline .nm {
  flex: 1;
}

.stepline .mk {
  width: 16px;
  color: var(--fg-3, #71858f);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.stepline .ms {
  color: var(--fg-3, #71858f);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  text-align: end;
}

.stepline.done .mk,
.stepline.done .ms {
  color: var(--acc, #4fd8c4);
}

.stepline.done .nm {
  color: var(--fg-2, #8fa3ac);
}

.stepline.now .mk {
  color: var(--fg, #c9d6dc);
}

.stepline.warn .mk,
.stepline.warn .ms {
  color: var(--warn, #e0a94f);
}

.stepline.fail .mk,
.stepline.fail .nm,
.stepline.fail .ms {
  color: var(--bad, #e2705f);
}

.boot-err {
  margin-top: 32px;
  padding: 14px 15px;
  background: var(--panel, #0d141a);
  border-inline-start: 2px solid var(--bad, #e2705f);
}

.boot-err strong {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.boot-err p {
  margin: 0;
  color: var(--fg-2, #8fa3ac);
  font-size: 11.5px;
  line-height: 1.55;
}

.acts {
  display: flex;
  gap: 8px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.act {
  padding: 7px 12px;
  border: 1px solid var(--rule, rgba(139, 188, 180, 0.16));
  background: none;
  color: var(--fg-2, #8fa3ac);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
}

.act:hover {
  color: var(--fg, #c9d6dc);
  border-color: var(--fg-3, #71858f);
}

.act-key {
  color: var(--acc, #4fd8c4);
  border-color: var(--acc, #4fd8c4);
}

.act-key:hover {
  color: var(--acc, #4fd8c4);
  border-color: var(--acc, #4fd8c4);
  background: var(--panel, #0d141a);
}

.act-off {
  color: var(--bad, #e2705f);
  border-color: rgba(226, 112, 95, 0.35);
}

.act-off:hover {
  color: var(--bad, #e2705f);
  border-color: var(--bad, #e2705f);
}

.boot-foot {
  margin: 48px 0 0;
  color: var(--fg-3, #71858f);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}

@media (max-width: 520px) {
  .stepline {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .stepline .ms {
    width: 100%;
    padding-inline-start: 28px;
    text-align: start;
  }
}
</style>
